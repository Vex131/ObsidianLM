export type GpuProcessKind = "current_managed_runtime" | "possible_llama_runtime" | "unknown_gpu_process";

export interface GpuMemoryInfo {
  totalMiB: number | null;
  usedMiB: number | null;
  freeMiB: number | null;
}

export interface GpuUtilizationInfo {
  gpuPercent: number | null;
}

export interface GpuPowerInfo {
  drawW: number | null;
  limitW: number | null;
}

export interface GpuTemperatureInfo {
  gpuC: number | null;
}

export interface GpuWarning {
  level: "info" | "warning" | "danger";
  code: "nvidia_smi_missing" | "nvidia_smi_failed" | "unsupported_output" | "no_nvidia_gpus_detected" | "gpu_process_owner_unknown" | "parse_warning";
  message: string;
}

export interface GpuProcess {
  pid: number;
  processName: string;
  gpuIndex: number | null;
  gpuUuid: string | null;
  usedMemoryMiB: number | null;
  kind: GpuProcessKind;
  matchedRuntimeType: "llama.cpp" | null;
  reasons: string[];
}

export interface GpuDevice {
  index: number;
  uuid: string | null;
  name: string;
  pciBusId: string | null;
  driverVersion: string | null;
  cudaVersion: string | null;
  memoryTotalMiB: number | null;
  memoryUsedMiB: number | null;
  memoryFreeMiB: number | null;
  utilizationGpuPercent: number | null;
  temperatureGpuC: number | null;
  powerDrawW: number | null;
  powerLimitW: number | null;
  processes: GpuProcess[];
}

export interface GpuSummary {
  gpuCount: number;
  totalMemoryMiB: number | null;
  usedMemoryMiB: number | null;
  freeMemoryMiB: number | null;
  currentManagedRuntimeGpuMemoryMiB: number | null;
  unknownGpuProcessCount: number;
  warningsCount: number;
}

export interface GpuMonitoringStatus {
  available: boolean;
  checkedAt: string;
  detectionMethod: string;
  driverVersion: string | null;
  cudaVersion: string | null;
  gpus: GpuDevice[];
  processes: GpuProcess[];
  warnings: GpuWarning[];
  summary: GpuSummary;
}

export interface CompactGpuStatus {
  available: boolean;
  gpuCount: number;
  totalMemoryMiB: number | null;
  usedMemoryMiB: number | null;
  currentManagedRuntimeGpuMemoryMiB: number | null;
  unknownGpuProcessCount: number;
  warningsCount: number;
  checkedAt: string;
}
