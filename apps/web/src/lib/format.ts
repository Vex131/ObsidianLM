import type { GpuDevice } from "@obsidianlm/shared";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function formatOptionalDate(value: string | null): string {
  return value ? formatDate(value) : "--";
}

export function formatMiB(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "--";
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(value >= 10240 ? 1 : 2)} GiB`;
  }
  return `${value.toFixed(0)} MiB`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : `${value.toFixed(0)}%`;
}

export function formatTemperature(value: number | null | undefined): string {
  return value === null || value === undefined ? "--" : `${value.toFixed(0)} C`;
}

export function formatPower(draw: number | null | undefined, limit: number | null | undefined): string {
  if (draw === null || draw === undefined) {
    return "--";
  }
  return limit === null || limit === undefined ? `${draw.toFixed(1)} W` : `${draw.toFixed(1)} / ${limit.toFixed(1)} W`;
}

export function gpuMemoryPercent(gpu: GpuDevice): number {
  if (!gpu.memoryTotalMiB || gpu.memoryUsedMiB === null) {
    return 0;
  }
  return Math.max(0, Math.min(100, (gpu.memoryUsedMiB / gpu.memoryTotalMiB) * 100));
}
