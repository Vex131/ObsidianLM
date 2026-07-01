import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import type { DetectedPort, PortStatus } from "@obsidianlm/shared";
import type { CommandResult, ProcessCommandRunner } from "./process-detector.js";

const execFileAsync = promisify(execFile);

export interface PortDetectorOptions {
  commandRunner?: ProcessCommandRunner;
  connectTimeoutMs?: number;
  platform?: NodeJS.Platform;
}

async function defaultCommandRunner(file: string, args: string[]): Promise<CommandResult> {
  const result = await execFileAsync(file, args, {
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function detectPort(port: number, host = "127.0.0.1", options: PortDetectorOptions = {}): Promise<DetectedPort> {
  const warnings: string[] = [];
  const inUse = await canConnect(host, port, options.connectTimeoutMs ?? 350).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "TCP connect check failed.";
    warnings.push(message);
    return false;
  });

  let ownerPid: number | null = null;
  let ownerMethod = "owner_not_checked";
  if (inUse) {
    const owner = await detectPortOwner(port, options).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Port owner detection failed.";
      warnings.push(message);
      return null;
    });
    ownerPid = owner?.ownerPid ?? null;
    ownerMethod = owner?.method ?? "owner_unavailable";
  }

  return {
    port,
    host,
    inUse,
    ownerPid,
    detectionMethod: `tcp_connect:${ownerMethod}`,
    warnings
  };
}

export function classifyPortStatus(port: DetectedPort, currentManagedPid: number | null): PortStatus {
  const conflict = port.inUse && (!currentManagedPid || port.ownerPid !== currentManagedPid);
  return {
    port,
    conflict,
    conflictMessage: conflict ? `Port ${port.port} is already in use by another process. ObsidianLM will not start a duplicate runtime.` : null
  };
}

async function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const settle = (value: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

async function detectPortOwner(port: number, options: PortDetectorOptions): Promise<{ ownerPid: number | null; method: string } | null> {
  const platform = options.platform ?? process.platform;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;

  if (platform === "win32") {
    const { stdout } = await commandRunner("netstat.exe", ["-ano", "-p", "tcp"]);
    return { ownerPid: parseWindowsNetstat(stdout, port), method: "netstat -ano" };
  }

  const { stdout } = await commandRunner("sh", ["-c", `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null | head -n 1`]);
  const ownerPid = Number.parseInt(stdout.trim(), 10);
  return { ownerPid: Number.isInteger(ownerPid) ? ownerPid : null, method: "lsof" };
}

export function parseWindowsNetstat(stdout: string, port: number): number | null {
  for (const line of stdout.split(/\r?\n/u)) {
    const normalized = line.trim().replace(/\s+/gu, " ");
    if (!normalized.toUpperCase().startsWith("TCP ")) {
      continue;
    }

    const parts = normalized.split(" ");
    if (parts.length < 5 || parts[3].toUpperCase() !== "LISTENING") {
      continue;
    }

    if (!localAddressMatchesPort(parts[1], port)) {
      continue;
    }

    const pid = Number.parseInt(parts[4], 10);
    return Number.isInteger(pid) ? pid : null;
  }

  return null;
}

function localAddressMatchesPort(address: string, port: number): boolean {
  return address.endsWith(`:${port}`) || address.endsWith(`]:${port}`);
}
