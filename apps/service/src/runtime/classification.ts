import type { DetectedPort, DetectedProcess, RuntimeDetectionCategory, RuntimeDetectionWarning, RuntimeState, StartupDetectionSummary } from "@obsidianlm/shared";

export interface ClassificationInput {
  previousState: RuntimeState | null;
  currentManagedPid: number | null;
  processes: DetectedProcess[];
  ports: DetectedPort[];
  processDetectionReliable?: boolean;
  checkedAt?: string;
}

export function classifyRuntimeDetection(input: ClassificationInput): StartupDetectionSummary {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const processDetectionReliable = input.processDetectionReliable ?? true;
  const categories = new Set<RuntimeDetectionCategory>();
  const warnings: RuntimeDetectionWarning[] = [];
  const activePreviousState = Boolean(
    input.previousState?.startedByObsidianLM &&
      input.previousState.pid &&
      input.previousState.pid !== input.currentManagedPid &&
      ["starting", "running", "stopping"].includes(input.previousState.status)
  );

  if (input.currentManagedPid && input.processes.some((process) => process.pid === input.currentManagedPid)) {
    categories.add("current_managed_process");
  }

  const previousCandidate = activePreviousState ? findPreviousCandidate(input.previousState, input.processes) : null;
  if (activePreviousState && previousCandidate) {
    categories.add("previous_managed_process_candidate");
    warnings.push({
      category: "previous_managed_process_candidate",
      level: "warning",
      pid: previousCandidate.pid,
      port: input.previousState?.port ?? undefined,
      message: `Detected a possible previous ObsidianLM-managed llama.cpp process with PID ${previousCandidate.pid}. It was not adopted or stopped automatically.`
    });
  } else if (activePreviousState && processDetectionReliable) {
    categories.add("previous_managed_stale_state");
    warnings.push({
      category: "previous_managed_stale_state",
      level: "info",
      port: input.previousState?.port ?? undefined,
      message: "Previous runtime state said llama.cpp was running, but no matching live process was found. State was marked stale/stopped."
    });
  } else if (activePreviousState) {
    categories.add("previous_managed_process_candidate");
    warnings.push({
      category: "previous_managed_process_candidate",
      level: "warning",
      port: input.previousState?.port ?? undefined,
      message: "Previous runtime state exists, but process detection was unavailable. ObsidianLM did not mark it stale, adopt it, or stop any process."
    });
  }

  for (const process of input.processes) {
    if (process.pid === input.currentManagedPid || process.pid === previousCandidate?.pid) {
      continue;
    }

    categories.add("unmanaged_llama_process");
    warnings.push({
      category: "unmanaged_llama_process",
      level: "warning",
      pid: process.pid,
      message: `Unmanaged llama-server-like process detected with PID ${process.pid}. ObsidianLM will not kill or adopt it automatically.`
    });
  }

  for (const port of input.ports) {
    if (port.inUse && (!input.currentManagedPid || port.ownerPid !== input.currentManagedPid)) {
      categories.add("port_conflict");
      warnings.push({
        category: "port_conflict",
        level: "danger",
        port: port.port,
        pid: port.ownerPid ?? undefined,
        message: `Port ${port.port} is already in use by another process. ObsidianLM will block duplicate runtime starts on that port.`
      });
    }
  }

  if (!categories.size) {
    categories.add("no_runtime_detected");
  }

  return {
    categories: [...categories],
    warnings,
    actions: [
      {
        id: "stop-stale-previous-managed-process",
        label: "Stop stale previous managed process",
        category: "previous_managed_stale_process",
        enabled: false,
        reason: "Phase 3 does not have enough cross-platform proof to safely kill previous processes. No kill action is available."
      }
    ],
    processes: input.processes,
    ports: input.ports,
    previousState: input.previousState,
    checkedAt
  };
}

function findPreviousCandidate(previousState: RuntimeState | null, processes: DetectedProcess[]): DetectedProcess | null {
  if (!previousState?.pid) {
    return null;
  }

  const process = processes.find((item) => item.pid === previousState.pid);
  if (!process) {
    return null;
  }

  const commandLine = process.commandLine?.toLowerCase() ?? "";
  if (previousState.port && commandLine && !commandLine.includes(`${previousState.port}`)) {
    return null;
  }

  return process;
}
