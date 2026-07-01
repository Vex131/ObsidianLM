import type { StartupDetectionSummary } from "./detection.js";
import type { RuntimeStatus, RuntimeType } from "./runtime-state.js";

export interface ActiveRuntimeStatus {
  type: RuntimeType;
  status: RuntimeStatus;
  pid: number | null;
  profileId: string | null;
  profileName: string | null;
  apiUrl: string | null;
}

export interface StatusResponse {
  service: "running";
  app: "ObsidianLM";
  version: string;
  uiPort: number;
  managedLlamaPort: number;
  activeRuntime: ActiveRuntimeStatus | null;
  warnings: string[];
  detection: Pick<StartupDetectionSummary, "categories" | "warnings" | "ports" | "checkedAt">;
}
