import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DetectedProcess, ProcessListResponse } from "@obsidianlm/shared";

const execFileAsync = promisify(execFile);

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type ProcessCommandRunner = (file: string, args: string[]) => Promise<CommandResult>;

export interface ProcessDetectorOptions {
  commandRunner?: ProcessCommandRunner;
  now?: () => Date;
  platform?: NodeJS.Platform;
}

interface WindowsProcessRow {
  ProcessId?: number;
  Name?: string;
  ExecutablePath?: string | null;
  CommandLine?: string | null;
  CreationDate?: string | null;
}

const llamaServerPattern = /(?:^|[\\/\s"])(llama-server(?:\.exe)?)(?:$|[\s"])/iu;
const ignoredToolPattern = /(?:^|[\\/\s"])(llama-bench|llama-perplexity|llama-cli)(?:\.exe)?(?:$|[\s"])/iu;

async function defaultCommandRunner(file: string, args: string[]): Promise<CommandResult> {
  const result = await execFileAsync(file, args, {
    maxBuffer: 1024 * 1024 * 5,
    windowsHide: true
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export async function detectLlamaServerProcesses(options: ProcessDetectorOptions = {}): Promise<ProcessListResponse> {
  const platform = options.platform ?? process.platform;
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const detectedAt = (options.now ?? (() => new Date()))().toISOString();

  if (platform === "win32") {
    return detectWindowsProcesses(commandRunner, detectedAt);
  }

  return detectPosixProcesses(commandRunner, detectedAt);
}

async function detectWindowsProcesses(commandRunner: ProcessCommandRunner, detectedAt: string): Promise<ProcessListResponse> {
  const detectionMethod = "powershell:Get-CimInstance Win32_Process";
  try {
    const { stdout } = await commandRunner("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress"
    ]);
    const parsed = stdout.trim() ? (JSON.parse(stdout) as WindowsProcessRow | WindowsProcessRow[]) : [];
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return {
      processes: rows.map((row) => toDetectedProcess(row, detectedAt)).filter((process): process is DetectedProcess => process !== null),
      warnings: [],
      detectionMethod
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Process detection failed.";
    return {
      processes: [],
      warnings: [`Process detection is unavailable: ${message}`],
      detectionMethod
    };
  }
}

async function detectPosixProcesses(commandRunner: ProcessCommandRunner, detectedAt: string): Promise<ProcessListResponse> {
  const detectionMethod = "ps -axo pid=,comm=,args=";
  try {
    const { stdout } = await commandRunner("ps", ["-axo", "pid=,comm=,args="]);
    const processes = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = /^(\d+)\s+(\S+)\s+(.*)$/u.exec(line);
        if (!match) {
          return null;
        }

        return toDetectedProcess(
          {
            ProcessId: Number(match[1]),
            Name: match[2],
            ExecutablePath: null,
            CommandLine: match[3],
            CreationDate: null
          },
          detectedAt
        );
      })
      .filter((process): process is DetectedProcess => process !== null);

    return { processes, warnings: [], detectionMethod };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Process detection failed.";
    return {
      processes: [],
      warnings: [`Process detection is unavailable on this platform: ${message}`],
      detectionMethod
    };
  }
}

function toDetectedProcess(row: WindowsProcessRow, detectedAt: string): DetectedProcess | null {
  const pid = Number(row.ProcessId);
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }

  const name = row.Name ?? "unknown";
  const executablePath = row.ExecutablePath ?? null;
  const commandLine = row.CommandLine ?? null;
  const haystack = [name, executablePath, commandLine].filter(Boolean).join(" ");

  if (ignoredToolPattern.test(haystack) || !llamaServerPattern.test(haystack)) {
    return null;
  }

  const reasons = ["Process name or command line resembles llama-server."];
  if (commandLine) {
    reasons.push("Command line metadata is available for conservative classification.");
  }
  if (executablePath) {
    reasons.push("Executable path metadata is available.");
  }

  return {
    pid,
    name,
    executablePath,
    commandLine,
    startedAt: normalizeWindowsDate(row.CreationDate ?? null),
    detectedAt,
    matchedRuntimeType: "llama.cpp",
    kind: "llama_server",
    confidence: commandLine || executablePath ? "medium" : "low",
    reasons
  };
}

function normalizeWindowsDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const wmiMatch = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/u.exec(value);
  if (wmiMatch) {
    const [, year, month, day, hour, minute, second] = wmiMatch;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
