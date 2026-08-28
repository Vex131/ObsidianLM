import type { CommandSpec, LlamaCppArgs, LlamaCppFlagOverride, RuntimeProfile } from "./runtime-state.js";

export interface DiscoveryWarning {
  code: string;
  message: string;
  folder?: string;
  path?: string;
}

export type GgufArtifactKind = "model" | "mmproj" | "adapter" | "imatrix" | "other" | "unknown";
export type GgufArtifactKindSource = "metadata" | "filename" | "unknown";
export type GgufMetadataStatus = "ready" | "partial" | "invalid" | "unsupported";
export type GgufMetadataValue = string | number | boolean;

export interface GgufMetadataInspection {
  artifactId: string;
  status: GgufMetadataStatus;
  artifactKind: GgufArtifactKind;
  artifactKindSource: GgufArtifactKindSource;
  version?: number;
  tensorCount?: number;
  kvCount?: number;
  displayName?: string;
  architecture?: string;
  trainedContext?: number;
  embeddingLength?: number;
  blockCount?: number;
  expertCount?: number;
  expertUsedCount?: number;
  nextnPredictLayers?: number;
  isMoE?: boolean;
  metadata: Record<string, GgufMetadataValue>;
  warnings: string[];
}

export interface DiscoveredModel {
  id: string;
  name: string;
  fileName: string;
  path: string;
  folder: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  detectedAt: string;
  quantizationGuess?: string;
  familyGuess?: string;
  artifactKindGuess?: GgufArtifactKind;
  artifactKindSource?: Exclude<GgufArtifactKindSource, "metadata">;
}

export interface DiscoveredToolInputFile {
  id: string;
  name: string;
  fileName: string;
  path: string;
  folder: string;
  extension: ".txt" | ".raw" | ".jsonl" | ".md";
  sizeBytes: number;
  modifiedAt: string;
  detectedAt: string;
}

export type DiscoveredLlamaCppToolKind = "server" | "cli" | "bench" | "perplexity" | "unknown";

export interface DiscoveredLlamaCppTool {
  kind: DiscoveredLlamaCppToolKind;
  fileName: string;
  path: string;
  exists: boolean;
}

export interface DiscoveredLlamaCppBuild {
  id: string;
  name: string;
  folder: string;
  serverPath: string;
  tools: DiscoveredLlamaCppTool[];
  detectedAt: string;
  discoveryRoot?: string;
  buildRootHint?: string;
  relativeServerPath?: string;
}

export interface ModelDiscoveryResponse {
  models: DiscoveredModel[];
  warnings: DiscoveryWarning[];
  scannedFolders: string[];
  detectedAt: string;
}

export interface ModelArtifactUsageResponse {
  usage: Array<{ artifactId: string; profileIds: string[] }>;
  missingProfileIds: string[];
}

export interface LlamaBuildUsageResponse {
  usage: Array<{ buildId: string; profileIds: string[] }>;
  missingProfileIds: string[];
}

export interface LlamaBuildDiscoveryResponse {
  builds: DiscoveredLlamaCppBuild[];
  warnings: DiscoveryWarning[];
  scannedFolders: string[];
  detectedAt: string;
}

export type LlamaBuildCapabilitiesStatus = "ready" | "partial" | "failed";

export interface LlamaBuildVersionInfo {
  raw: string;
  buildNumber?: number;
  major?: number;
  minor?: number;
  patch?: number;
  commit?: string;
  compiler?: string;
  target?: string;
}

export type LlamaBuildOriginClassification = "official" | "custom" | "unknown";
export type LlamaBuildOriginSource = "path_hint" | "version_hint" | "unknown";

export interface LlamaBuildOrigin {
  classification: LlamaBuildOriginClassification;
  source: LlamaBuildOriginSource;
  evidence: string[];
}

export type LlamaBuildRouterStatus = "candidate" | "partial" | "unsupported" | "unknown";

export interface LlamaBuildRouterAssessment {
  status: LlamaBuildRouterStatus;
  evidence: {
    modelsPreset: boolean;
    modelsMax: boolean;
    modelsAutoload: boolean;
  };
  missingRequiredFlags: string[];
  compatibilityHints: string[];
}

export interface LlamaBuildDeviceCapability {
  id: string;
  label?: string;
}

export interface LlamaBuildFlagCapability {
  canonicalName: string;
  aliases: string[];
  valuePlaceholder?: string;
  description?: string;
  defaultText?: string;
  choices?: string[];
  environmentAlias?: string;
  deprecated?: boolean;
}

export interface LlamaBuildCapabilitiesManifest {
  buildId: string;
  serverPath: string;
  inspectedAt: string;
  versionText?: string;
  versionInfo?: LlamaBuildVersionInfo;
  origin: LlamaBuildOrigin;
  status: LlamaBuildCapabilitiesStatus;
  devices: LlamaBuildDeviceCapability[];
  backendHints: string[];
  flags: LlamaBuildFlagCapability[];
  router: LlamaBuildRouterAssessment;
  warnings: DiscoveryWarning[];
}

export interface ToolInputDiscoveryResponse {
  files: DiscoveredToolInputFile[];
  warnings: DiscoveryWarning[];
  scannedFolders: string[];
  detectedAt: string;
}

export interface DiscoverySettingsUpdate {
  modelFolders: string[];
  llamaCppFolders: string[];
  toolInputFolders: string[];
}

export interface CreateProfileFromDiscoveryRequest {
  name: string;
  modelPath: string;
  buildPath: string;
  host?: string;
  port?: number;
  llamaArgs?: LlamaCppArgs;
  flagOverrides?: LlamaCppFlagOverride[];
  extraArgs?: string[];
}

export interface CreateProfileFromDiscoveryResponse {
  profile: RuntimeProfile;
  command: CommandSpec;
  validation: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
}
