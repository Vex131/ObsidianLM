import type { CommandSpec, LlamaCppArgs, RuntimeProfile } from "./runtime-state.js";

export interface DiscoveryWarning {
  code: string;
  message: string;
  folder?: string;
  path?: string;
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
}

export interface ModelDiscoveryResponse {
  models: DiscoveredModel[];
  warnings: DiscoveryWarning[];
  scannedFolders: string[];
  detectedAt: string;
}

export interface LlamaBuildDiscoveryResponse {
  builds: DiscoveredLlamaCppBuild[];
  warnings: DiscoveryWarning[];
  scannedFolders: string[];
  detectedAt: string;
}

export interface DiscoverySettingsUpdate {
  modelFolders: string[];
  llamaCppFolders: string[];
}

export interface CreateProfileFromDiscoveryRequest {
  name: string;
  modelPath: string;
  buildPath: string;
  host?: string;
  port?: number;
  llamaArgs?: LlamaCppArgs;
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
