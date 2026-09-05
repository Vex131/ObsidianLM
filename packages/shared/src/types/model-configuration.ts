import type { GgufArtifactKind, GgufMetadataInspection } from "./discovery.js";
import type { LlamaCppArgs, LlamaCppFlagOverride } from "./runtime-state.js";

export const MODEL_CONFIGURATION_SCHEMA_VERSION = 1 as const;

export type ModelArtifactId = `artifact_${string}`;
export type ConfiguredModelId = `model_${string}`;
export type LlamaCppBuildId = `build_${string}`;
export type RouterAlias = string & { readonly __routerAlias: unique symbol };

export type ResourceOwner =
  | { scope: "local" }
  | { scope: "node"; nodeId: string };

export interface ResourceReference {
  owner: ResourceOwner;
  locator: string;
}

export type ReferenceStatus = "available" | "missing" | "invalid" | "unknown";
export type ConfigurationValidationStatus = "not_validated" | "valid" | "invalid" | "unknown";

export interface ModelArtifact {
  schemaVersion: typeof MODEL_CONFIGURATION_SCHEMA_VERSION;
  id: ModelArtifactId;
  resource: ResourceReference;
  kind: GgufArtifactKind;
  referenceStatus: ReferenceStatus;
  discoveryId?: string;
  metadata?: GgufMetadataInspection;
  discoveredAt?: string;
  updatedAt?: string;
}

export interface ProjectorAssociation {
  artifactId: ModelArtifactId;
  selection: "explicit";
  validationStatus: ConfigurationValidationStatus;
  warnings?: string[];
}

export interface ProjectorCandidate {
  artifactId: ModelArtifactId;
  basis: "discovery" | "metadata" | "user_hint";
  confidence?: "low" | "medium" | "high";
}

export interface ConfiguredModel {
  schemaVersion: typeof MODEL_CONFIGURATION_SCHEMA_VERSION;
  id: ConfiguredModelId;
  displayName: string;
  routerAlias: RouterAlias;
  artifactId: ModelArtifactId;
  buildId: LlamaCppBuildId;
  enabled: boolean;
  llamaArgs?: LlamaCppArgs;
  flagOverrides?: LlamaCppFlagOverride[];
  /** Preserved source arguments remain authoritative even when a generator cannot emit them. */
  extraArgs?: string[];
  projector?: ProjectorAssociation;
  projectorCandidates?: ProjectorCandidate[];
  referenceStatus: {
    artifact: ReferenceStatus;
    build: ReferenceStatus;
  };
  validationStatus: ConfigurationValidationStatus;
  warnings?: string[];
}

const MAX_ROUTER_ALIAS_LENGTH = 64;
const ROUTER_ALIAS_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

function stableToken(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function opaqueId<T extends string>(prefix: string, seed?: string): T {
  const entropy = seed ?? globalThis.crypto.randomUUID();
  return `${prefix}_${stableToken(entropy)}${stableToken(`${prefix}:${entropy}`)}` as T;
}

export function createModelArtifactId(seed?: string): ModelArtifactId {
  return opaqueId<ModelArtifactId>("artifact", seed);
}

export function createConfiguredModelId(seed?: string): ConfiguredModelId {
  return opaqueId<ConfiguredModelId>("model", seed);
}

export function createLlamaCppBuildId(seed?: string): LlamaCppBuildId {
  return opaqueId<LlamaCppBuildId>("build", seed);
}

export function isRouterAlias(value: string): value is RouterAlias {
  return value.length <= MAX_ROUTER_ALIAS_LENGTH && ROUTER_ALIAS_PATTERN.test(value);
}

/** Enabled + structurally usable for managed preset/runtime participation (not build eligibility). */
export function isConfiguredModelEligibleForManagedRuntime(model: ConfiguredModel): boolean {
  return model.enabled
    && model.validationStatus !== "invalid"
    && model.referenceStatus.artifact === "available"
    && model.referenceStatus.build === "available";
}

export function createRouterAlias(displayName: string, configuredModelId: ConfiguredModelId, existingAliases: Iterable<string> = []): RouterAlias {
  const used = new Set(Array.from(existingAliases, (alias) => alias.toLowerCase()));
  const normalized = displayName
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "") || "model";
  const base = normalized.slice(0, MAX_ROUTER_ALIAS_LENGTH).replace(/[^a-z0-9]+$/g, "") || "model";
  if (!used.has(base)) return base as RouterAlias;

  const suffix = stableToken(configuredModelId);
  const collisionBase = `${base.slice(0, MAX_ROUTER_ALIAS_LENGTH - suffix.length - 1).replace(/[^a-z0-9]+$/g, "")}-${suffix}`;
  if (!used.has(collisionBase)) return collisionBase as RouterAlias;

  for (let counter = 2; ; counter += 1) {
    const counterSuffix = `-${counter}`;
    const candidate = `${collisionBase.slice(0, MAX_ROUTER_ALIAS_LENGTH - counterSuffix.length).replace(/[^a-z0-9]+$/g, "")}${counterSuffix}`;
    if (!used.has(candidate)) return candidate as RouterAlias;
  }
}
