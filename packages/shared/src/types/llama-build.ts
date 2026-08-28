import type {
  DiscoveredLlamaCppTool,
  LlamaBuildRouterAssessment,
  LlamaBuildVersionInfo
} from "./discovery.js";
import type { LlamaCppBuildId, ResourceReference } from "./model-configuration.js";

export const LLAMA_CPP_BUILD_SCHEMA_VERSION = 1 as const;

export type LlamaCppBuildClassification = "official" | "custom" | "experimental" | "compatibility" | "unknown";
export type BuildValidationState = "unknown" | "not_validated" | "validating" | "eligible" | "ineligible" | "failed";

export interface LlamaCppBuildStaticEvidence {
  kind: "static";
  assessedAt: string;
  discoveredTools: DiscoveredLlamaCppTool[];
  versionInfo?: LlamaBuildVersionInfo;
  routerFlags: LlamaBuildRouterAssessment;
  warnings: string[];
}

export interface LlamaCppBuildFunctionalEvidence {
  kind: "functional";
  state: BuildValidationState;
  attemptedAt?: string;
  completedAt?: string;
  launchAttempted: boolean;
  presetAccepted?: boolean;
  healthVerified?: boolean;
  modelsVerified?: boolean;
  requiredBehaviorVerified?: boolean;
  reason?: string;
  warnings: string[];
  failures: string[];
}

export interface LlamaCppBuild {
  schemaVersion: typeof LLAMA_CPP_BUILD_SCHEMA_VERSION;
  id: LlamaCppBuildId;
  displayName: string;
  resource: ResourceReference;
  server: ResourceReference;
  tools: DiscoveredLlamaCppTool[];
  discoveryId?: string;
  versionInfo?: LlamaBuildVersionInfo;
  classification: LlamaCppBuildClassification;
  staticEvidence?: LlamaCppBuildStaticEvidence;
  functionalEvidence?: LlamaCppBuildFunctionalEvidence;
  managedInferenceEligibility: BuildValidationState;
  validatedAt?: string;
  warnings: string[];
  failures: string[];
}

export function isBuildEligibleForManagedInference(build: LlamaCppBuild): boolean {
  return build.managedInferenceEligibility === "eligible"
    && build.functionalEvidence?.state === "eligible"
    && build.functionalEvidence.launchAttempted === true
    && build.functionalEvidence.presetAccepted === true
    && build.functionalEvidence.healthVerified === true
    && build.functionalEvidence.modelsVerified === true
    && build.functionalEvidence.requiredBehaviorVerified === true;
}
