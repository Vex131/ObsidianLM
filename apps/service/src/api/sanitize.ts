import path from "node:path";
import type { DetectedProcess, StartupDetectionSummary } from "@obsidianlm/shared";

export function sanitizeProcessForApi(process: DetectedProcess): DetectedProcess {
  return {
    ...process,
    executablePath: process.executablePath ? path.basename(process.executablePath) : null,
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
