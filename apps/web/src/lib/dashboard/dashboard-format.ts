import type { CommandSpec, GpuMonitoringStatus, RuntimeLogEntry, RuntimeProfile, RuntimeState, StatusResponse } from "@obsidianlm/shared";

const emptyLabel = "—";

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : emptyLabel;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? emptyLabel : date.toLocaleString();
}

export function formatUptime(startedAt: string | null | undefined, currentTime = Date.now()): string {
  if (!startedAt) {
    return emptyLabel;
  }

  const startedTime = new Date(startedAt).getTime();
  if (Number.isNaN(startedTime)) {
    return emptyLabel;
  }

  const totalSeconds = Math.max(0, Math.floor((currentTime - startedTime) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (part: number) => String(part).padStart(2, "0");

  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function formatGiB(mib: number | null | undefined): string {
  if (typeof mib !== "number" || !Number.isFinite(mib)) {
    return emptyLabel;
  }

  return `${(mib / 1024).toFixed(1)} GiB`;
}

export function clampPercent(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.min(100, Math.max(0, value));
}

export function normalizeEndpoint(status: StatusResponse | null | undefined, activeProfile: RuntimeProfile | null | undefined): string {
  if (activeProfile?.host && activeProfile.port) {
    const host = activeProfile.host.includes("://") ? activeProfile.host : `http://${activeProfile.host}`;
    return stripV1(`${host}:${activeProfile.port}`);
  }

  return stripV1(status?.activeRuntime?.apiUrl) || emptyLabel;
}

function stripV1(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const trimmed = value.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed.slice(0, -3).replace(/\/+$/, "") : trimmed;
}

export function extractModelFileType(modelPath: string | null | undefined): string {
  if (!modelPath) {
    return emptyLabel;
  }

  const fileName = modelPath.split(/[\\/]/).pop() ?? "";
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension ? extension.toUpperCase() : emptyLabel;
}

export function dedupeWarnings(warnings: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const warning of warnings) {
    const normalized = warning?.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function dashboardWarnings(status: StatusResponse | null, runtimeWarnings: string[], gpuStatus: GpuMonitoringStatus | null): string[] {
  return dedupeWarnings([
    ...(status?.warnings ?? []),
    ...(status?.detection?.warnings ?? []).map((warning) => warning.message),
    ...runtimeWarnings,
    ...(gpuStatus?.warnings ?? []).map((warning) => warning.message)
  ]);
}

export function commandDisplay(command: CommandSpec | null | undefined): string {
  return command?.displayCommand?.trim() ?? "";
}

export function latestLogLine(logs: RuntimeLogEntry[]): string {
  return logs.at(-1)?.message?.trim() || emptyLabel;
}

export function logSourceLabel(source: RuntimeLogEntry["source"] | RuntimeLogEntry["stream"] | null | undefined): string {
  return source ? source.toUpperCase() : emptyLabel;
}

export type LogTone = "muted" | "green" | "amber" | "red" | "default";

export function inferLogTone(message: string): LogTone {
  const lower = message.toLowerCase();
  if (/error|failed|fail|exception|panic|fatal|panic:/i.test(lower)) {
    return "red";
  }
  if (/warn|warning|deprecated/i.test(lower)) {
    return "amber";
  }
  if (/info|success|ready|started|loaded|initialized|listening/i.test(lower)) {
    return "green";
  }
  return "muted";
}

export function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return emptyLabel;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleTimeString();
}

export function formatVramMiB(mib: number | null | undefined): string {
  if (typeof mib !== "number" || !Number.isFinite(mib)) {
    return emptyLabel;
  }
  return `${(mib / 1024).toFixed(1)} GiB`;
}

export function vramPercent(memoryUsedMiB: number | null | undefined, memoryTotalMiB: number | null | undefined): number {
  if (typeof memoryUsedMiB !== "number" || typeof memoryTotalMiB !== "number" || !Number.isFinite(memoryUsedMiB) || !Number.isFinite(memoryTotalMiB) || memoryTotalMiB <= 0) {
    return 0;
  }
  return clampPercent((memoryUsedMiB / memoryTotalMiB) * 100);
}

export function formatTemperature(celsius: number | null | undefined): string {
  if (typeof celsius !== "number" || !Number.isFinite(celsius)) {
    return emptyLabel;
  }
  return `${celsius}°C`;
}

export function formatPowerWatts(watts: number | null | undefined): string {
  if (typeof watts !== "number" || !Number.isFinite(watts)) {
    return emptyLabel;
  }
  return `${watts.toFixed(0)} W`;
}

export function formatUtilization(percent: number | null | undefined): string {
  if (typeof percent !== "number" || !Number.isFinite(percent)) {
    return emptyLabel;
  }
  return `${Math.round(percent)}%`;
}

export type InspectorEndpointHealth = "ok" | "stopped" | "warning" | "error" | "muted";

export function inspectorEndpointHealth(status: StatusResponse | null, activeRuntimeState: RuntimeState | null): InspectorEndpointHealth {
  if (!status) {
    return "error";
  }
  if (activeRuntimeState?.status === "running") {
    return "ok";
  }
  if (activeRuntimeState?.status === "stopped" || activeRuntimeState?.status === "unknown_previous_runtime") {
    return "stopped";
  }
  if (activeRuntimeState?.status === "starting" || activeRuntimeState?.status === "stopping") {
    return "warning";
  }
  if (activeRuntimeState?.status === "failed" || activeRuntimeState?.status === "exited") {
    return "error";
  }
  return "stopped";
}
