import { defaultRuntimeState, type DetectedPort, type ProcessListResponse, type RuntimeState, type StartupDetectionSummary } from "@obsidianlm/shared";
import { loadRuntimeState, loadSettings, saveRuntimeState } from "../config/storage.js";
import { detectLlamaServerProcesses, type ProcessDetectorOptions } from "../process/process-detector.js";
import { detectPort, type PortDetectorOptions } from "../process/port-detector.js";
import { classifyRuntimeDetection } from "./classification.js";

export interface StartupDetectorOptions {
  processOptions?: ProcessDetectorOptions;
  portOptions?: PortDetectorOptions;
  reconcileStaleState?: boolean;
}

export async function runStartupDetection(currentManagedPid: number | null, options: StartupDetectorOptions = {}): Promise<StartupDetectionSummary> {
  const [previousState, settings, processList] = await Promise.all([loadRuntimeState(), loadSettings(), detectLlamaServerProcesses(options.processOptions)]);
  const portsToCheck = uniquePorts([settings.managedLlamaPort, previousState.port]);
  const ports = await Promise.all(portsToCheck.map((port) => detectPort(port, "127.0.0.1", options.portOptions)));
  const summary = buildDetectionSummary(previousState, currentManagedPid, processList, ports);

  const shouldReconcileStaleState = options.reconcileStaleState ?? true;
  if (shouldReconcileStaleState && !currentManagedPid && processList.warnings.length === 0 && summary.categories.includes("previous_managed_stale_state")) {
    await saveRuntimeState({
      ...previousState,
      ...defaultRuntimeState,
      status: "stopped",
      message: "Previous runtime state was stale; no matching live process was found."
    });
  }

  return summary;
}

export function buildDetectionSummary(previousState: RuntimeState, currentManagedPid: number | null, processList: ProcessListResponse, ports: DetectedPort[]): StartupDetectionSummary {
  const summary = classifyRuntimeDetection({
    previousState,
    currentManagedPid,
    processes: processList.processes,
    ports,
    processDetectionReliable: processList.warnings.length === 0
  });

  for (const warning of processList.warnings) {
    summary.warnings.push({
      category: "no_runtime_detected",
      level: "warning",
      message: warning
    });
  }

  return summary;
}

function uniquePorts(ports: Array<number | null>): number[] {
  return [...new Set(ports.filter((port): port is number => typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535))];
}
