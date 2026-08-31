import type { RuntimeStatus } from "./runtime-state.js";
import type { ConfiguredModelId, LlamaCppBuildId } from "./model-configuration.js";
import type { RouterHealthState, RouterRuntimeId } from "./router.js";

export type ReadinessCheckStatus = "pass" | "warning" | "block" | "unavailable";

export interface ReadinessCheck {
  id: string;
  label: string;
  status: ReadinessCheckStatus;
  message: string;
  count?: number;
}

export interface ReadinessCounts {
  discoveredArtifacts?: number;
  configuredModels?: number;
  discoveredBuilds?: number;
  eligibleBuilds?: number;
  ggufModels: number;
  serverBuilds: number;
  llamaBenchTools: number;
  llamaPerplexityTools: number;
  toolInputs: number;
  profiles: number;
}

export interface ReadinessConfiguredState {
  modelFolders: boolean;
  llamaCppFolders: boolean;
  toolInputFolders: boolean;
}

export interface ReadinessPortState {
  port: number;
  inUse: boolean;
  conflict: boolean;
  ownerKnown: boolean;
  message: string | null;
}

export interface ReadinessGpuState {
  available: boolean;
  gpuCount: number;
  warningsCount: number;
  message: string;
}

export interface ReadinessRuntimeState {
  runtimeId?: RouterRuntimeId | null;
  buildId?: LlamaCppBuildId | null;
  loadedConfiguredModelIds?: ConfiguredModelId[];
  status: RuntimeStatus;
  active: boolean;
  profileId: string | null;
  profileName: string | null;
  port: number | null;
  health: "active" | "inactive" | "unavailable";
  routerHealth?: RouterHealthState;
  message: string | null;
}

export interface ReadinessResponse {
  ok: boolean;
  checkedAt: string;
  configured: ReadinessConfiguredState;
  counts: ReadinessCounts;
  managedPort: ReadinessPortState;
  gpu: ReadinessGpuState;
  runtime: ReadinessRuntimeState;
  checks: ReadinessCheck[];
  blockingChecks: ReadinessCheck[];
  warnings: string[];
  storageWarnings: string[];
  nextActions: string[];
}
