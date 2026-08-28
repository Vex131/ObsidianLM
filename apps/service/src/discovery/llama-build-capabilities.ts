import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { DiscoveredLlamaCppBuild, DiscoveryWarning, LlamaBuildCapabilitiesManifest, LlamaBuildDeviceCapability, LlamaBuildFlagCapability } from "@obsidianlm/shared";

const probeTimeoutMs = 5_000;
const maxProbeOutputBytes = 128 * 1024;
const capabilityCache = new Map<string, LlamaBuildCapabilitiesManifest>();

export interface LlamaBuildProbeResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  truncated?: boolean;
}

export type LlamaBuildProbeRunner = (serverPath: string, args: string[]) => Promise<LlamaBuildProbeResult>;

export function parseLlamaBuildHelp(helpText: string): { flags: LlamaBuildFlagCapability[]; warnings: DiscoveryWarning[] } {
  const flags: LlamaBuildFlagCapability[] = [];
  const warnings: DiscoveryWarning[] = [];
  let current: LlamaBuildFlagCapability | undefined;
  let malformed = false;

  for (const line of helpText.split(/\r?\n/u)) {
    const aliases = [...line.matchAll(/(?<!\w)(--?[A-Za-z0-9][A-Za-z0-9-]*)/gu)].map((match) => match[1]);
    if (aliases.length > 0 && /^\s*-/u.test(line)) {
      const canonicalName = aliases.find((alias) => alias.startsWith("--")) ?? aliases[0];
      const valueMatch = line.match(/(?:\s|=)(<[^>]+>|\{[^}]+\}|\[[^\]]+\]|[A-Z][A-Z0-9_-]*)(?=\s{2,}|\t|$)/u);
      const description = line.slice((valueMatch?.index ?? line.lastIndexOf(aliases.at(-1) ?? "")) + (valueMatch?.[0].length ?? (aliases.at(-1)?.length ?? 0))).trim();
      current = {
        canonicalName,
        aliases: [...new Set(aliases)],
        ...(valueMatch ? { valuePlaceholder: valueMatch[1] } : {}),
        ...(description ? { description } : {})
      };
      flags.push(current);
      continue;
    }

    if (/^\s*-/u.test(line)) {
      malformed = true;
      current = undefined;
      continue;
    }

    if (current && /^\s+\S/u.test(line) && !/^\s*(?:usage|options?|examples?)\s*:/iu.test(line)) {
      current.description = [current.description, line.trim()].filter(Boolean).join(" ");
      continue;
    }

  }

  for (const flag of flags) {
    const text = flag.description ?? "";
    const defaultMatch = text.match(/\bdefaults?\s*(?:to|:|=)\s*([^).;]+)/iu);
    const choicesMatch = `${flag.valuePlaceholder ?? ""} ${text}`.match(/\{([^}]+)\}/u);
    const environmentMatch = text.match(/\b(?:env(?:ironment)?(?: variable)?|environment)\s*[:=]?\s*([A-Z][A-Z0-9_]+)/iu);
    if (defaultMatch) flag.defaultText = defaultMatch[1].trim();
    if (choicesMatch) {
      const choices = choicesMatch[1].split(/[|,]/u).map((choice) => choice.trim()).filter(Boolean);
      if (choices.length > 0) flag.choices = choices;
    }
    if (environmentMatch) flag.environmentAlias = environmentMatch[1];
    if (/\bdeprecated\b/iu.test(text)) flag.deprecated = true;
  }

  if (malformed || (helpText.trim().length > 0 && flags.length === 0)) {
    warnings.push({ code: "help_parse_partial", message: "Some llama.cpp help output could not be parsed." });
  }
  return { flags, warnings };
}

export function parseLlamaBuildDevices(output: string): LlamaBuildDeviceCapability[] {
  const devices: LlamaBuildDeviceCapability[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9_.-]*\d+|\d+)\s*:\s*(\S.*)\s*$/u);
    if (!match || /^available devices$/iu.test(match[2])) continue;
    devices.push({ id: match[1], label: match[2] });
  }
  return devices;
}

export const runLlamaBuildProbe: LlamaBuildProbeRunner = (serverPath, args) => new Promise((resolve) => {
  let settled = false;
  let stdout = "";
  let stderr = "";
  let truncated = false;
  let outputBytes = 0;
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const finish = (result: LlamaBuildProbeResult): void => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolve(result);
  };
  let child;
  try {
    child = spawn(serverPath, args, { shell: false, windowsHide: true });
  } catch {
    resolve({ ok: false, stdout, stderr });
    return;
  }
  const append = (target: "stdout" | "stderr", chunk: Buffer): void => {
    const remaining = maxProbeOutputBytes - outputBytes;
    if (remaining <= 0) {
      truncated = true;
      child.kill("SIGKILL");
      return;
    }
    const captured = chunk.subarray(0, remaining);
    outputBytes += captured.byteLength;
    const value = captured.toString("utf8");
    if (target === "stdout") stdout += value;
    else stderr += value;
    if (captured.byteLength < chunk.byteLength) {
      truncated = true;
      child.kill("SIGKILL");
    }
  };
  child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
  child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
  timeout = setTimeout(() => {
    timedOut = true;
    if (!child.kill("SIGKILL")) finish({ ok: false, stdout, stderr, timedOut, truncated });
  }, probeTimeoutMs);
  child.once("error", () => finish({ ok: false, stdout, stderr, truncated }));
  child.once("close", (code) => finish({ ok: code === 0 && !timedOut && !truncated, stdout, stderr, timedOut, truncated }));
});

function probeWarning(name: string, result: LlamaBuildProbeResult): DiscoveryWarning | undefined {
  if (result.ok && !result.truncated) return undefined;
  if (result.timedOut) return { code: `probe_${name}_timeout`, message: `llama.cpp ${name} probe timed out.` };
  if (result.truncated) return { code: `probe_${name}_truncated`, message: `llama.cpp ${name} probe output was truncated.` };
  return { code: `probe_${name}_failed`, message: `llama.cpp ${name} probe failed.` };
}

export async function getLlamaBuildCapabilities(build: DiscoveredLlamaCppBuild, runner: LlamaBuildProbeRunner = runLlamaBuildProbe): Promise<LlamaBuildCapabilitiesManifest> {
  let fingerprint: string;
  try {
    const info = await stat(build.serverPath);
    fingerprint = `${build.serverPath}\u0000${info.size}\u0000${info.mtimeMs}`;
  } catch {
    return { buildId: build.id, serverPath: build.serverPath, status: "failed", devices: [], flags: [], warnings: [{ code: "server_unavailable", message: "The discovered llama.cpp server is no longer available." }] };
  }
  const cached = capabilityCache.get(fingerprint);
  if (cached) return cached;

  const [version, help, devices] = await Promise.all([runner(build.serverPath, ["--version"]), runner(build.serverPath, ["--help"]), runner(build.serverPath, ["--list-devices"])]);
  const warnings = [probeWarning("version", version), probeWarning("help", help), probeWarning("devices", devices)].filter((warning): warning is DiscoveryWarning => Boolean(warning));
  const parsedHelp = help.ok ? parseLlamaBuildHelp(`${help.stdout}\n${help.stderr}`) : { flags: [], warnings: [] };
  warnings.push(...parsedHelp.warnings);
  const successes = [version, help, devices].filter((result) => result.ok).length;
  const manifest: LlamaBuildCapabilitiesManifest = {
    buildId: build.id,
    serverPath: build.serverPath,
    ...(version.ok && version.stdout.trim() ? { versionText: version.stdout.trim().slice(0, 4096) } : {}),
    status: successes === 3 && warnings.length === 0 ? "ready" : successes > 0 ? "partial" : "failed",
    devices: devices.ok ? parseLlamaBuildDevices(`${devices.stdout}\n${devices.stderr}`) : [],
    flags: parsedHelp.flags,
    warnings
  };
  capabilityCache.set(fingerprint, manifest);
  if (capabilityCache.size > 32) capabilityCache.delete(capabilityCache.keys().next().value as string);
  return manifest;
}
