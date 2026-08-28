import type { CommandSpec, RuntimeStatus, RuntimeWarning } from "./runtime-state.js";
import type { ConfiguredModelId, LlamaCppBuildId, ResourceReference, RouterAlias } from "./model-configuration.js";

export const ROUTER_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const ROUTER_RUNTIME_STATE_VERSION = 1 as const;

export type RouterRuntimeId = `router_${string}`;
export type RouterModelState = "unloaded" | "loading" | "loaded" | "sleeping" | "unavailable" | "failed" | "unknown";
export type RouterCatalogOwnership = "managed" | "external" | "unknown";
export type RouterHealthState = "unknown" | "checking" | "healthy" | "unhealthy" | "failed";
export type CatalogReconciliationState = "unknown" | "pending" | "reconciled" | "mismatch" | "failed";
export type GeneratedArtifactValidationState = "not_validated" | "valid" | "invalid" | "failed";
export type GeneratedArtifactFreshness = "current" | "stale" | "unknown";

interface RouterCatalogEntryBase {
  routerIdentifier: string;
  alias?: RouterAlias;
  state: RouterModelState;
  statusText?: string;
  rawEvidence?: unknown;
  warnings?: string[];
}

export type RouterCatalogEntry = RouterCatalogEntryBase & (
  | {
      ownership: "managed";
      /** Management requires explicit reconciliation; path equality alone is insufficient. */
      configuredModelId: ConfiguredModelId;
    }
  | {
      ownership: "external" | "unknown";
      configuredModelId?: never;
    }
);

export interface RouterCatalogSnapshot {
  endpoint: "/models";
  observedAt: string;
  entries: RouterCatalogEntry[];
  reconciliationState: CatalogReconciliationState;
  warnings: string[];
}

export interface RouterHealthEvidence {
  endpoint: "/health";
  state: RouterHealthState;
  checkedAt?: string;
  message?: string;
}

export interface RouterInferenceEvidence {
  endpointFamily: "/v1/*";
  purpose: "compatibility" | "diagnostic_inference";
  checkedAt?: string;
  successful?: boolean;
  message?: string;
}

export interface GeneratedRouterArtifact {
  schemaVersion: typeof ROUTER_ARTIFACT_SCHEMA_VERSION;
  authority: "derived";
  buildId: LlamaCppBuildId;
  resource: ResourceReference;
  generatorVersion: string;
  sourceRevision: string;
  contentHash: string;
  generatedAt?: string;
  freshness: GeneratedArtifactFreshness;
  validationState: GeneratedArtifactValidationState;
  warnings: string[];
  errors: string[];
}

export interface RouterLaunchPreview {
  kind: "router_launch";
  command: CommandSpec;
  artifact: GeneratedRouterArtifact;
  policy: {
    modelsMax: 1;
    modelsAutoload: true;
  };
}

export interface RouterPresetPreview {
  kind: "model_preset";
  buildId: LlamaCppBuildId;
  artifact: GeneratedRouterArtifact;
  content: string;
  configuredModelIds: ConfiguredModelId[];
}

export interface RouterRuntimeState {
  stateVersion: typeof ROUTER_RUNTIME_STATE_VERSION;
  activeRuntimeId: RouterRuntimeId | null;
  activeBuildId: LlamaCppBuildId | null;
  pid: number | null;
  host: string | null;
  port: number | null;
  startedByObsidianLM: boolean;
  ownershipEvidence: "current_process_child" | "persisted_candidate" | "unproven";
  startedAt: string | null;
  commandHash: string | null;
  status: RuntimeStatus;
  generatedArtifact?: GeneratedRouterArtifact;
  health: RouterHealthEvidence;
  catalog?: RouterCatalogSnapshot;
  configuredModelStates: Array<{ configuredModelId: ConfiguredModelId; state: RouterModelState }>;
  warnings: RuntimeWarning[];
  errors: string[];
  previousRuntimeUncertainty?: string;
}
