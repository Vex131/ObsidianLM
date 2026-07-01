import { execFile } from "node:child_process";
import type { GpuDevice, GpuMonitoringStatus, GpuProcess, GpuProcessKind, GpuSummary, GpuWarning } from "@obsidianlm/shared";

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export type GpuCommandRunner = (command: string, args: string[]) => Promise<CommandResult>;

export interface GpuMonitorOptions {
  commandRunner?: GpuCommandRunner;
}

const NVIDIA_SMI = "nvidia-smi";
const GPU_QUERY_WITH_CUDA = [
  "--query-gpu=index,uuid,name,pci.bus_id,driver_version,cuda_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw,power.limit",
  "--format=csv,noheader,nounits"
];
const GPU_QUERY_FALLBACK = [
  "--query-gpu=index,uuid,name,pci.bus_id,driver_version,memory.total,memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw,power.limit",
  "--format=csv,noheader,nounits"
];
const COMPUTE_QUERY = ["--query-compute-apps=pid,process_name,gpu_uuid,used_memory", "--format=csv,noheader,nounits"];

const emptySummary: GpuSummary = {
  gpuCount: 0,
  totalMemoryMiB: null,
  usedMemoryMiB: null,
  freeMemoryMiB: null,
  currentManagedRuntimeGpuMemoryMiB: null,
  unknownGpuProcessCount: 0,
  warningsCount: 0
};

export async function getGpuMonitoringStatus(currentManagedPid: number | null, options: GpuMonitorOptions = {}): Promise<GpuMonitoringStatus> {
  const checkedAt = new Date().toISOString();
  const warnings: GpuWarning[] = [];
  const runner = options.commandRunner ?? runNvidiaSmi;

  let gpuOutput: CommandResult;
  let usedFallback = false;
  try {
    gpuOutput = await runner(NVIDIA_SMI, GPU_QUERY_WITH_CUDA);
  } catch (error) {
    if (!isMissingExecutableError(error)) {
      try {
        gpuOutput = await runner(NVIDIA_SMI, GPU_QUERY_FALLBACK);
        usedFallback = true;
        warnings.push({ level: "warning", code: "unsupported_output", message: "nvidia-smi did not return CUDA version through the preferred query; GPU monitoring continued without CUDA version." });
      } catch (fallbackError) {
        return unavailableStatus(checkedAt, warningFromCommandError(fallbackError));
      }
    } else {
      return unavailableStatus(checkedAt, warningFromCommandError(error));
    }
  }

  const gpus = parseGpuCsv(gpuOutput.stdout, warnings, !usedFallback);
  if (!gpus.length) {
    warnings.push({ level: "warning", code: "no_nvidia_gpus_detected", message: "nvidia-smi ran, but no NVIDIA GPUs were returned." });
  }

  let rawProcesses: ParsedGpuProcess[] = [];
  try {
    rawProcesses = parseComputeProcessCsv((await runner(NVIDIA_SMI, COMPUTE_QUERY)).stdout, warnings);
  } catch (error) {
    warnings.push({ level: "warning", code: "gpu_process_owner_unknown", message: `GPU process query failed; VRAM may be used by processes ObsidianLM cannot list. ${safeErrorMessage(error)}` });
  }

  const processes = classifyGpuProcesses(rawProcesses, gpus, currentManagedPid);
  for (const gpu of gpus) {
    gpu.processes = processes.filter((process) => process.gpuIndex === gpu.index || (process.gpuIndex === null && process.gpuUuid && process.gpuUuid === gpu.uuid));
  }

  const summary = summarizeGpus(gpus, processes, warnings.length);
  return {
    available: gpus.length > 0,
    checkedAt,
    detectionMethod: "nvidia-smi",
    driverVersion: firstKnown(gpus.map((gpu) => gpu.driverVersion)),
    cudaVersion: firstKnown(gpus.map((gpu) => gpu.cudaVersion)),
    gpus,
    processes,
    warnings,
    summary
  };
}

export function parseGpuCsv(stdout: string, warnings: GpuWarning[] = [], includesCudaVersion = true): GpuDevice[] {
  return stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).map((line, rowIndex) => {
    const values = parseCsvLine(line);
    const expected = includesCudaVersion ? 13 : 12;
    if (values.length < expected) {
      warnings.push({ level: "warning", code: "parse_warning", message: `Unable to parse GPU row ${rowIndex + 1}; expected ${expected} fields and received ${values.length}.` });
    }

    const offset = includesCudaVersion ? 0 : -1;
    return {
      index: parseRequiredInt(values[0], rowIndex, warnings),
      uuid: normalizeNullable(values[1]),
      name: normalizeNullable(values[2]) ?? "Unknown NVIDIA GPU",
      pciBusId: normalizeNullable(values[3]),
      driverVersion: normalizeNullable(values[4]),
      cudaVersion: includesCudaVersion ? normalizeNullable(values[5]) : null,
      memoryTotalMiB: parseNullableNumber(values[6 + offset]),
      memoryUsedMiB: parseNullableNumber(values[7 + offset]),
      memoryFreeMiB: parseNullableNumber(values[8 + offset]),
      utilizationGpuPercent: parseNullableNumber(values[9 + offset]),
      temperatureGpuC: parseNullableNumber(values[10 + offset]),
      powerDrawW: parseNullableNumber(values[11 + offset]),
      powerLimitW: parseNullableNumber(values[12 + offset]),
      processes: []
    };
  });
}

export interface ParsedGpuProcess {
  pid: number;
  processName: string;
  gpuUuid: string | null;
  usedMemoryMiB: number | null;
}

export function parseComputeProcessCsv(stdout: string, warnings: GpuWarning[] = []): ParsedGpuProcess[] {
  return stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).flatMap((line, rowIndex) => {
    const values = parseCsvLine(line);
    if (values.length < 4) {
      warnings.push({ level: "warning", code: "parse_warning", message: `Unable to parse GPU process row ${rowIndex + 1}; expected at least 4 fields and received ${values.length}.` });
      return [];
    }

    const pid = Number.parseInt(values[0].trim(), 10);
    if (!Number.isInteger(pid) || pid < 1) {
      warnings.push({ level: "warning", code: "parse_warning", message: `Unable to parse GPU process PID on row ${rowIndex + 1}.` });
      return [];
    }

    const usedMemory = values.at(-1);
    const gpuUuid = values.at(-2);
    const processName = values.slice(1, -2).join(",").trim() || "Unknown GPU process";

    return [{ pid, processName: sanitizeProcessName(processName), gpuUuid: normalizeNullable(gpuUuid), usedMemoryMiB: parseNullableNumber(usedMemory) }];
  });
}

export function classifyGpuProcesses(rawProcesses: ParsedGpuProcess[], gpus: GpuDevice[], currentManagedPid: number | null): GpuProcess[] {
  return rawProcesses.map((rawProcess) => {
    const gpu = rawProcess.gpuUuid ? gpus.find((device) => device.uuid === rawProcess.gpuUuid) : null;
    const llamaLike = /(^|[\\/])llama-server(\.exe)?$/iu.test(rawProcess.processName) || /^llama-server(\.exe)?$/iu.test(rawProcess.processName);
    let kind: GpuProcessKind = "unknown_gpu_process";
    const reasons: string[] = [];

    if (currentManagedPid && rawProcess.pid === currentManagedPid) {
      kind = "current_managed_runtime";
      reasons.push("PID matches the current ObsidianLM-managed runtime.");
    } else if (llamaLike) {
      kind = "possible_llama_runtime";
      reasons.push("Process name resembles llama-server, but PID does not match the current managed runtime.");
    } else {
      reasons.push("GPU process is using VRAM and is not known to be managed by ObsidianLM.");
    }

    return {
      pid: rawProcess.pid,
      processName: rawProcess.processName,
      gpuIndex: gpu?.index ?? null,
      gpuUuid: rawProcess.gpuUuid,
      usedMemoryMiB: rawProcess.usedMemoryMiB,
      kind,
      matchedRuntimeType: kind === "current_managed_runtime" || kind === "possible_llama_runtime" ? "llama.cpp" : null,
      reasons
    };
  });
}

function runNvidiaSmi(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseRequiredInt(value: string | undefined, rowIndex: number, warnings: GpuWarning[]): number {
  const parsed = Number.parseInt(value?.trim() ?? "", 10);
  if (!Number.isInteger(parsed)) {
    warnings.push({ level: "warning", code: "parse_warning", message: `Unable to parse GPU index on row ${rowIndex + 1}; using ${rowIndex}.` });
    return rowIndex;
  }
  return parsed;
}

function parseNullableNumber(value: string | undefined): number | null {
  const normalized = normalizeNullable(value);
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseFloat(normalized.replace(/[^0-9.+-]/gu, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNullable(value: string | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || /^\[?N\/A\]?$/iu.test(normalized)) {
    return null;
  }
  return normalized;
}

function sanitizeProcessName(value: string): string {
  const normalized = value.replace(/^"|"$/gu, "").trim();
  const segments = normalized.split(/[\\/]/u).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function summarizeGpus(gpus: GpuDevice[], processes: GpuProcess[], warningsCount: number): GpuSummary {
  return {
    gpuCount: gpus.length,
    totalMemoryMiB: sumNullable(gpus.map((gpu) => gpu.memoryTotalMiB)),
    usedMemoryMiB: sumNullable(gpus.map((gpu) => gpu.memoryUsedMiB)),
    freeMemoryMiB: sumNullable(gpus.map((gpu) => gpu.memoryFreeMiB)),
    currentManagedRuntimeGpuMemoryMiB: sumNullable(processes.filter((process) => process.kind === "current_managed_runtime").map((process) => process.usedMemoryMiB)),
    unknownGpuProcessCount: processes.filter((process) => process.kind === "unknown_gpu_process").length,
    warningsCount
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function firstKnown(values: Array<string | null>): string | null {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function unavailableStatus(checkedAt: string, warning: GpuWarning): GpuMonitoringStatus {
  return {
    available: false,
    checkedAt,
    detectionMethod: "nvidia-smi",
    driverVersion: null,
    cudaVersion: null,
    gpus: [],
    processes: [],
    warnings: [warning],
    summary: { ...emptySummary, warningsCount: 1 }
  };
}

function warningFromCommandError(error: unknown): GpuWarning {
  if (isMissingExecutableError(error)) {
    return { level: "warning", code: "nvidia_smi_missing", message: "nvidia-smi is not available on PATH. Install NVIDIA drivers or add nvidia-smi to PATH to enable GPU monitoring." };
  }
  return { level: "warning", code: "nvidia_smi_failed", message: `nvidia-smi failed while collecting read-only GPU status. ${safeErrorMessage(error)}` };
}

function isMissingExecutableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "No error details were returned.";
  }
  const stderr = typeof (error as Error & { stderr?: unknown }).stderr === "string" ? String((error as Error & { stderr?: string }).stderr) : "";
  return (stderr || error.message).replace(/\s+/gu, " ").trim().slice(0, 240);
}
