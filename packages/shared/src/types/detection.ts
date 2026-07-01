import type { RuntimeState, RuntimeType } from "./runtime-state.js";

export type ProcessKind = "llama_server" | "unknown";

export interface DetectedProcess {
  pid: number;
  name: string;
  executablePath: string | null;
  commandLine: string | null;
  startedAt: string | null;
  detectedAt: string;
  matchedRuntimeType: RuntimeType | null;
  kind: ProcessKind;
  confidence: "low" | "medium" | "high";
  reasons: string[];
}

export interface DetectedPort {
  port: number;
  host: string;
  inUse: boolean;
  ownerPid: number | null;
  detectionMethod: string;
  warnings: string[];
}

export type RuntimeDetectionCategory =
  | "current_managed_process"
  | "previous_managed_process_candidate"
  | "previous_managed_stale_state"
  | "previous_managed_stale_process"
  | "unmanaged_llama_process"
  | "port_conflict"
  | "no_runtime_detected";

export type RuntimeDetectionWarningLevel = "info" | "warning" | "danger";

export interface RuntimeDetectionWarning {
  category: RuntimeDetectionCategory;
  level: RuntimeDetectionWarningLevel;
  message: string;
  pid?: number;
  port?: number;
}

export interface RuntimeDetectionAction {
  id: string;
  label: string;
  category: RuntimeDetectionCategory;
  enabled: boolean;
  reason: string;
}

export interface StartupDetectionSummary {
  categories: RuntimeDetectionCategory[];
  warnings: RuntimeDetectionWarning[];
  actions: RuntimeDetectionAction[];
  processes: DetectedProcess[];
  ports: DetectedPort[];
  previousState: RuntimeState | null;
  checkedAt: string;
}

export interface PortStatus {
  port: DetectedPort;
  conflict: boolean;
  conflictMessage: string | null;
}

export interface ProcessListResponse {
  processes: DetectedProcess[];
  warnings: string[];
  detectionMethod: string;
}
