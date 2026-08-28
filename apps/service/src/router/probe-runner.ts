import { createServer } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { createManagedRouterEnvironment } from "./environment.js";

const defaultTimeoutMs = 20_000;
const pollIntervalMs = 100;
const requestTimeoutMs = 1_000;
const cleanupTimeoutMs = 1_000;
const maxOutputBytes = 8_192;
const maxModelsResponseBytes = 128 * 1024;

export type RouterProbeClassification = "eligible" | "ineligible" | "failed";
export type RouterAutoloadFlag = "--models-autoload" | "--no-models-autoload";

export interface RouterProbeInput {
  executable: string;
  modelPath: string;
  routerAlias: string;
  autoloadFlag: RouterAutoloadFlag;
  forbiddenPorts?: readonly number[];
  timeoutMs?: number;
}

export interface RouterProbeResult {
  launchAttempted: boolean;
  presetAccepted: boolean;
  healthVerified: boolean;
  modelsVerified: boolean;
  models?: unknown;
  classification: RouterProbeClassification;
  reason: string;
  warnings: string[];
  failures: string[];
  cleanup: { childTerminated: boolean; workspaceRemoved: boolean };
}

export interface RouterProbeWorkspace {
  path: string;
  presetPath: string;
  cachePath: string;
  remove(): Promise<void>;
}

export interface RouterProbeDependencies {
  spawn?: (executable: string, args: readonly string[], options: { shell: false; windowsHide: true; stdio: ["ignore", "pipe", "pipe"]; env: NodeJS.ProcessEnv }) => ChildProcess;
  fetch?: typeof fetch;
  allocatePort?: () => Promise<number>;
  createWorkspace?: (modelPath: string, routerAlias: string) => Promise<RouterProbeWorkspace>;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

interface AttemptResult {
  launchAttempted: boolean;
  presetAccepted: boolean;
  healthVerified: boolean;
  modelsVerified: boolean;
  models?: unknown;
  reason: string;
  warnings: string[];
  failures: string[];
  portRace: boolean;
  childTerminated: boolean;
}

const wait = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function allocateLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Loopback port allocation did not return a port.")));
        return;
      }
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function createProbeWorkspace(modelPath: string, routerAlias: string): Promise<RouterProbeWorkspace> {
  const path = await mkdtemp(join(tmpdir(), "obsidianlm-router-probe-"));
  const cachePath = join(path, "cache");
  const presetPath = join(path, "probe.ini");
  await mkdir(cachePath);
  await writeFile(presetPath, `version = 1\n\n[${routerAlias}]\nmodel = ${modelPath}\n`, { encoding: "utf8", mode: 0o600 });
  return { path, cachePath, presetPath, remove: async () => rm(path, { recursive: true, force: true }) };
}

function appendOutput(current: string, chunk: Buffer, remaining: { bytes: number }): string {
  if (remaining.bytes <= 0) return current;
  const captured = chunk.subarray(0, remaining.bytes);
  remaining.bytes -= captured.byteLength;
  return current + captured.toString("utf8");
}

function outputRejectsPreset(output: string): boolean {
  return /(?:unknown|unrecognized|invalid)\s+(?:argument|option|flag)|(?:models-preset|models-autoload|no-models-autoload).*(?:unknown|invalid|unsupported|error)|(?:failed|cannot|could not).*(?:preset|ini)/iu.test(output);
}

function portIsInUse(output: string): boolean {
  return /address already in use|eaddrinuse/iu.test(output);
}

async function terminateOwnedChild(child: ChildProcess, closed: boolean): Promise<boolean> {
  if (closed || child.exitCode !== null || child.signalCode !== null) return true;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (terminated: boolean): void => { if (settled) return; settled = true; clearTimeout(timeout); resolve(terminated); };
    const timeout = setTimeout(() => finish(false), cleanupTimeoutMs);
    child.once("close", () => finish(true));
    try { if (!child.kill("SIGKILL")) finish(false); } catch { finish(false); }
  });
}

function modelIncludesAlias(value: unknown, routerAlias: string): boolean {
  const entries = Array.isArray(value) ? value : value && typeof value === "object" && Array.isArray((value as { models?: unknown }).models) ? (value as { models: unknown[] }).models : value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data) ? (value as { data: unknown[] }).data : [];
  return entries.some((entry) => entry && typeof entry === "object" && ["id", "alias", "name"].some((key) => (entry as Record<string, unknown>)[key] === routerAlias));
}

async function fetchEndpoint(fetcher: typeof fetch, url: string): Promise<{ response?: Response; error?: "timeout" | "io" }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return { response: await fetcher(url, { method: "GET", signal: controller.signal }) };
  } catch (error) {
    return { error: error instanceof Error && error.name === "AbortError" ? "timeout" : "io" };
  } finally {
    clearTimeout(timeout);
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) return JSON.parse(await response.text()) as unknown;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxModelsResponseBytes) throw new Error("response_too_large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(body)) as unknown;
}

async function runAttempt(input: RouterProbeInput, workspace: RouterProbeWorkspace, port: number, deadline: number, dependencies: Required<Pick<RouterProbeDependencies, "spawn" | "fetch" | "sleep" | "now">>): Promise<AttemptResult> {
  const args = ["--host", "127.0.0.1", "--port", String(port), "--models-preset", workspace.presetPath, "--models-max", "1", input.autoloadFlag];
  const failures: string[] = [];
  const warnings: string[] = [];
  let child: ChildProcess | undefined;
  let output = "";
  const outputRemaining = { bytes: maxOutputBytes };
  let closed = false;
  let childTerminated = false;
  let result: AttemptResult | undefined;
  try {
    child = dependencies.spawn(input.executable, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: createManagedRouterEnvironment(process.env, workspace.cachePath) });
    child.stdout?.on("data", (chunk: Buffer) => { output = appendOutput(output, chunk, outputRemaining); });
    child.stderr?.on("data", (chunk: Buffer) => { output = appendOutput(output, chunk, outputRemaining); });
    child.once("close", () => { closed = true; });
    child.once("error", () => { closed = true; });
  } catch {
    return { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router executable could not be launched.", warnings, failures: ["spawn_failed"], portRace: false, childTerminated: false };
  }

  try {
    while (dependencies.now() < deadline) {
      if (closed) {
        if (outputRejectsPreset(output)) return result = { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router rejected the required model preset or autoload flag.", warnings, failures, portRace: false, childTerminated };
        return result = { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router exited before its health endpoint became available.", warnings, failures: ["router_exited"], portRace: portIsInUse(output), childTerminated };
      }
      const health = await fetchEndpoint(dependencies.fetch, `http://127.0.0.1:${port}/health`);
      if (health.response) {
        if (health.response.status === 404) return result = { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router health endpoint is incompatible.", warnings, failures, portRace: false, childTerminated };
        if (health.response.ok) {
          const models = await fetchEndpoint(dependencies.fetch, `http://127.0.0.1:${port}/models`);
          if (models.response) {
            if (models.response.status === 404) return result = { launchAttempted: true, presetAccepted: false, healthVerified: true, modelsVerified: false, reason: "Router models endpoint is incompatible.", warnings, failures, portRace: false, childTerminated };
            if (models.response.ok) {
              let raw: unknown;
              try { raw = await boundedJson(models.response); } catch { return result = { launchAttempted: true, presetAccepted: false, healthVerified: true, modelsVerified: false, reason: "Router models endpoint returned incompatible or excessive JSON.", warnings, failures, portRace: false, childTerminated }; }
              const presetAccepted = modelIncludesAlias(raw, input.routerAlias);
              await dependencies.sleep(pollIntervalMs);
              if (closed || portIsInUse(output)) return result = { launchAttempted: true, presetAccepted: false, healthVerified: true, modelsVerified: false, reason: "The validation port was claimed by another process.", warnings, failures: ["port_race"], portRace: true, childTerminated };
              return result = { launchAttempted: true, presetAccepted, healthVerified: true, modelsVerified: presetAccepted, models: raw, reason: presetAccepted ? "Router preset was accepted and model is listed." : "Router did not list the preset model alias.", warnings, failures, portRace: false, childTerminated };
            }
          }
          if (models.error === "timeout") failures.push("models_timeout");
          else if (models.error === "io") failures.push("models_io");
        }
      } else if (health.error === "timeout") failures.push("health_timeout");
      else if (health.error === "io") warnings.push("health_unavailable");
      await dependencies.sleep(pollIntervalMs);
    }
    failures.push("probe_timeout");
    return result = { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router probe timed out.", warnings, failures, portRace: false, childTerminated };
  } finally {
    if (child && !closed) {
      childTerminated = await terminateOwnedChild(child, closed);
      if (!childTerminated) failures.push("child_cleanup_failed");
    } else childTerminated = true;
    if (result) result.childTerminated = childTerminated;
  }
}

export async function runRouterProbe(input: RouterProbeInput, dependencies: RouterProbeDependencies = {}): Promise<RouterProbeResult> {
  const cleanup = { childTerminated: false, workspaceRemoved: false };
  if (/\r|\n/u.test(input.modelPath) || /\r|\n/u.test(input.routerAlias)) return { launchAttempted: false, presetAccepted: false, healthVerified: false, modelsVerified: false, classification: "failed", reason: "Model locator and router alias must not contain newlines.", warnings: [], failures: ["invalid_locator"], cleanup };
  if (input.autoloadFlag !== "--models-autoload" && input.autoloadFlag !== "--no-models-autoload") return { launchAttempted: false, presetAccepted: false, healthVerified: false, modelsVerified: false, classification: "failed", reason: "Autoload flag is invalid.", warnings: [], failures: ["invalid_autoload_flag"], cleanup };
  const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { launchAttempted: false, presetAccepted: false, healthVerified: false, modelsVerified: false, classification: "failed", reason: "Probe timeout must be a positive finite number.", warnings: [], failures: ["invalid_timeout"], cleanup };
  const spawn = dependencies.spawn ?? nodeSpawn;
  const fetcher = dependencies.fetch ?? fetch;
  const allocatePort = dependencies.allocatePort ?? allocateLoopbackPort;
  const createWorkspace = dependencies.createWorkspace ?? createProbeWorkspace;
  const sleep = dependencies.sleep ?? wait;
  const now = dependencies.now ?? Date.now;
  let workspace: RouterProbeWorkspace | undefined;
  let result: AttemptResult | undefined;
  try {
    workspace = await createWorkspace(input.modelPath, input.routerAlias);
    const deadline = now() + timeoutMs;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let port = 0;
      for (let allocation = 0; allocation < 8; allocation += 1) {
        const candidate = await allocatePort();
        if (!new Set([8085, ...(input.forbiddenPorts ?? [])]).has(candidate)) { port = candidate; break; }
      }
      if (port === 0) throw new Error("Could not allocate a validation-only port.");
      result = await runAttempt(input, workspace, port, deadline, { spawn, fetch: fetcher, sleep, now });
      cleanup.childTerminated = result.childTerminated;
      if (!result.portRace || attempt === 1) break;
    }
  } catch {
    result = { launchAttempted: Boolean(result?.launchAttempted), presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router probe setup or cleanup failed.", warnings: [], failures: ["probe_io_failed"], portRace: false, childTerminated: cleanup.childTerminated };
  } finally {
    if (workspace) {
      try { await workspace.remove(); cleanup.workspaceRemoved = true; } catch { cleanup.workspaceRemoved = false; }
    }
  }
  const final = result ?? { launchAttempted: false, presetAccepted: false, healthVerified: false, modelsVerified: false, reason: "Router probe did not run.", warnings: [], failures: ["probe_failed"], portRace: false, childTerminated: cleanup.childTerminated };
  if (!cleanup.workspaceRemoved) final.failures.push("workspace_cleanup_failed");
  const failed = final.failures.length > 0 || !cleanup.workspaceRemoved || !cleanup.childTerminated;
  return { launchAttempted: final.launchAttempted, presetAccepted: final.presetAccepted, healthVerified: final.healthVerified, modelsVerified: final.modelsVerified, ...(final.models === undefined ? {} : { models: final.models }), classification: failed ? "failed" : final.presetAccepted && final.healthVerified && final.modelsVerified ? "eligible" : "ineligible", reason: final.reason, warnings: [...new Set(final.warnings)].sort(), failures: [...new Set(final.failures)].sort(), cleanup };
}
