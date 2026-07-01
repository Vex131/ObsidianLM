import path from "node:path";
import type { DetectedProcess, StartupDetectionSummary } from "@obsidianlm/shared";

export function safeBasename(value: string): string {
  const winName = path.win32.basename(value);
  const posixName = path.posix.basename(value);
  return winName.length <= posixName.length ? winName : posixName;
}

export function sanitizeProcessForApi(process: DetectedProcess): DetectedProcess {
  return {
    ...process,
    executablePath: process.executablePath ? safeBasename(process.executablePath) : null,
    commandLine: null,
    reasons: process.commandLine || process.executablePath ? [...process.reasons, "Local path and command-line details are redacted from the API response."] : process.reasons
  };
}

export function sanitizeDetectionForApi(summary: StartupDetectionSummary): StartupDetectionSummary {
  return {
    ...summary,
    processes: summary.processes.map(sanitizeProcessForApi)
  };
}
