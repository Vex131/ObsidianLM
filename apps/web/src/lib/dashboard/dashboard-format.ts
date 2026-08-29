const emptyLabel = "—";

export function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? new Intl.NumberFormat().format(value) : emptyLabel;
}

export function formatUptime(startedAt: string | null | undefined, currentTime = Date.now()): string {
  if (!startedAt) return emptyLabel;
  const startedTime = new Date(startedAt).getTime();
  if (Number.isNaN(startedTime)) return emptyLabel;
  const totalSeconds = Math.max(0, Math.floor((currentTime - startedTime) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
}

export function clampPercent(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

export type LogTone = "muted" | "green" | "amber" | "red" | "default";

export function inferLogTone(message: string): LogTone {
  if (/error|failed|fail|exception|panic|fatal|panic:/i.test(message)) return "red";
  if (/warn|warning|deprecated/i.test(message)) return "amber";
  if (/info|success|ready|started|loaded|initialized|listening/i.test(message)) return "green";
  return "muted";
}

export function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) return emptyLabel;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleTimeString();
}

export function formatVramMiB(mib: number | null | undefined): string {
  return typeof mib === "number" && Number.isFinite(mib) ? `${(mib / 1024).toFixed(1)} GiB` : emptyLabel;
}

export function vramPercent(memoryUsedMiB: number | null | undefined, memoryTotalMiB: number | null | undefined): number {
  if (typeof memoryUsedMiB !== "number" || typeof memoryTotalMiB !== "number" || !Number.isFinite(memoryUsedMiB) || !Number.isFinite(memoryTotalMiB) || memoryTotalMiB <= 0) return 0;
  return clampPercent((memoryUsedMiB / memoryTotalMiB) * 100);
}

export function formatTemperature(celsius: number | null | undefined): string {
  return typeof celsius === "number" && Number.isFinite(celsius) ? `${celsius}°C` : emptyLabel;
}

export function formatPowerWatts(watts: number | null | undefined): string {
  return typeof watts === "number" && Number.isFinite(watts) ? `${watts.toFixed(0)} W` : emptyLabel;
}

export function formatUtilization(percent: number | null | undefined): string {
  return typeof percent === "number" && Number.isFinite(percent) ? `${Math.round(percent)}%` : emptyLabel;
}
