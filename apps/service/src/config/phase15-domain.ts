import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LEGACY_PROFILE_SOURCE_VERSION,
  MODEL_CONFIGURATION_SCHEMA_VERSION,
  PROFILE_MIGRATION_TARGET_VERSION,
  createConfiguredModelId,
  createLlamaCppBuildId,
  createModelArtifactId,
  createRouterAlias,
  isRouterAlias,
  type ConfiguredModel,
  type LlamaCppBuild,
  type LlamaCppProfile,
  type ModelArtifact,
  type LegacyProfileCompatibilityBinding,
  type ProfileMigrationRecord
} from "@obsidianlm/shared";
import { getDataDir } from "./paths.js";

const domainFileName = "phase15-domain.json";
const profilesFileName = "profiles.json";
export const PHASE15_DOMAIN_SCHEMA_VERSION = 2 as const;

export interface Phase15DomainSnapshot {
  schemaVersion: typeof PHASE15_DOMAIN_SCHEMA_VERSION;
  revision: string;
  artifacts: ModelArtifact[];
  configuredModels: ConfiguredModel[];
  builds: LlamaCppBuild[];
  migration: ProfileMigrationRecord;
  compatibilityBindings: LegacyProfileCompatibilityBinding[];
}

interface Phase15DomainSnapshotV1 extends Omit<Phase15DomainSnapshot, "schemaVersion" | "compatibilityBindings"> {
  schemaVersion: typeof PROFILE_MIGRATION_TARGET_VERSION;
}

export type LegacyProfilesLoadResult =
  | { kind: "missing" }
  | { kind: "valid"; profiles: LlamaCppProfile[]; bytes: Buffer; revision: string }
  | { kind: "invalid_json"; bytes: Buffer; error: Error }
  | { kind: "unsupported_shape"; bytes: Buffer; error: Error }
  | { kind: "io_error"; error: Error };

export interface Phase15MigrationDependencies {
  readFile?: typeof readFile;
  writeFile?: typeof writeFile;
  rename?: typeof rename;
  open?: typeof open;
  unlink?: typeof unlink;
  stat?: typeof stat;
  now?: () => Date;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(message: string): Error {
  return new Error(`Phase 15 migration: ${message}`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function normalizeLocalResourceLocator(locator: string): string {
  if (process.platform !== "win32") return locator;
  return path.win32.normalize(locator.replaceAll("/", "\\")).toLowerCase();
}

function resource(locator: string) {
  return { owner: { scope: "local" as const }, locator };
}

function legacyPathApi(locator: string): typeof path.win32 | typeof path.posix {
  return /^(?:[A-Za-z]:[\\/]|\\\\)|\\/u.test(locator) ? path.win32 : path.posix;
}

function legacyBuildResourceFolder(serverLocator: string): string {
  const pathApi = legacyPathApi(serverLocator);
  const serverName = pathApi.basename(serverLocator).toLowerCase();
  const serverFolder = pathApi.dirname(serverLocator);
  return /^llama-server(?:\.exe)?$/u.test(serverName) && pathApi.basename(serverFolder).toLowerCase() === "bin" ? pathApi.dirname(serverFolder) : serverFolder;
}

function isLlamaArgs(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const numbers = ["ctxSize", "batchSize", "ubatchSize", "parallel", "threads", "threadsBatch"];
  const strings = ["splitMode", "tensorSplit", "cacheTypeK", "cacheTypeV"];
  const booleans = ["flashAttention", "contBatching", "metrics", "webui"];
  return numbers.every((key) => value[key] === undefined || (typeof value[key] === "number" && Number.isFinite(value[key])))
    && strings.every((key) => value[key] === undefined || typeof value[key] === "string")
    && booleans.every((key) => value[key] === undefined || typeof value[key] === "boolean")
    && (value.gpuLayers === undefined || value.gpuLayers === "all" || (typeof value.gpuLayers === "number" && Number.isFinite(value.gpuLayers)))
    && (value.devices === undefined || (Array.isArray(value.devices) && value.devices.every((item) => typeof item === "string" && item.trim().length > 0)));
}

function isFlagOverrides(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  const flags = value.map((entry) => isRecord(entry) ? entry.flag : undefined);
  return new Set(flags).size === flags.length && value.every((entry) => (
    isRecord(entry) && typeof entry.flag === "string" && /^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/u.test(entry.flag)
    && !["--model", "-m", "--host", "--port"].includes(entry.flag)
    && (entry.values === undefined || (Array.isArray(entry.values) && entry.values.every((item) => typeof item === "string" && item.trim().length > 0)))
  ));
}

function hasNoArgumentConflicts(args: unknown, overrides: unknown): boolean {
  if (!isRecord(args) || !Array.isArray(overrides)) return true;
  const flags = new Map<string, string>([
    ["--ctx-size", "ctxSize"], ["-c", "ctxSize"], ["--n-gpu-layers", "gpuLayers"], ["--gpu-layers", "gpuLayers"], ["-ngl", "gpuLayers"],
    ["--device", "devices"], ["-dev", "devices"], ["--split-mode", "splitMode"], ["-sm", "splitMode"], ["--tensor-split", "tensorSplit"], ["-ts", "tensorSplit"],
    ["--cache-type-k", "cacheTypeK"], ["-ctk", "cacheTypeK"], ["--cache-type-v", "cacheTypeV"], ["-ctv", "cacheTypeV"], ["--flash-attn", "flashAttention"], ["-fa", "flashAttention"],
    ["--batch-size", "batchSize"], ["-b", "batchSize"], ["--ubatch-size", "ubatchSize"], ["-ub", "ubatchSize"], ["--parallel", "parallel"], ["-np", "parallel"],
    ["--threads", "threads"], ["-t", "threads"], ["--threads-batch", "threadsBatch"], ["-tb", "threadsBatch"], ["--cont-batching", "contBatching"], ["--metrics", "metrics"], ["--webui", "webui"]
  ]);
  return overrides.every((override) => !isRecord(override) || typeof override.flag !== "string" || args[flags.get(override.flag) ?? ""] === undefined);
}

function isLegacyProfile(value: unknown): value is LlamaCppProfile {
  return isRecord(value)
    && typeof value.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value.id)
    && typeof value.name === "string" && value.name.trim().length > 0
    && value.runtimeType === "llama.cpp"
    && value.providerKind === "server"
    && typeof value.modelPath === "string" && value.modelPath.trim().length > 0
    && typeof value.buildPath === "string" && value.buildPath.trim().length > 0
    && typeof value.host === "string" && value.host.trim().length > 0 && !/\s/u.test(value.host)
    && typeof value.port === "number" && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535
    && isLlamaArgs(value.llamaArgs)
    && isFlagOverrides(value.flagOverrides)
    && hasNoArgumentConflicts(value.llamaArgs, value.flagOverrides)
    && (value.extraArgs === undefined || (Array.isArray(value.extraArgs) && value.extraArgs.every((item) => typeof item === "string")));
}

function canonicalProfiles(profiles: LlamaCppProfile[]): LlamaCppProfile[] {
  return profiles.map(clone).sort((left, right) => left.id.localeCompare(right.id) || canonicalJson(left).localeCompare(canonicalJson(right)));
}

export async function loadLegacyProfiles(dataDir = getDataDir(), dependencies: Phase15MigrationDependencies = {}): Promise<LegacyProfilesLoadResult> {
  const read = dependencies.readFile ?? readFile;
  try {
    const bytes = await read(path.join(dataDir, profilesFileName));
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "parse failed";
      return { kind: "invalid_json", bytes, error: errorMessage(`profiles.json is invalid JSON: ${detail}`) };
    }
    if (!Array.isArray(parsed) || !parsed.every(isLegacyProfile) || new Set(parsed.map((profile) => profile.id)).size !== parsed.length) {
      return { kind: "unsupported_shape", bytes, error: errorMessage("profiles.json does not contain unique, supported llama.cpp server profiles") };
    }
    const profiles = canonicalProfiles(parsed);
    return { kind: "valid", profiles, bytes, revision: hash(canonicalJson(profiles)) };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { kind: "missing" };
    return { kind: "io_error", error: error instanceof Error ? error : errorMessage("could not read profiles.json") };
  }
}

function isReference(value: unknown): boolean {
  return isRecord(value) && isRecord(value.owner) && typeof value.locator === "string"
    && (value.owner.scope === "local" || value.owner.scope === "node" && typeof value.owner.nodeId === "string" && value.owner.nodeId.length > 0);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number" && Number.isFinite(value);
}

function isVersionInfo(value: unknown): boolean {
  return isRecord(value) && typeof value.raw === "string"
    && [value.buildNumber, value.major, value.minor, value.patch].every(isOptionalFiniteNumber)
    && [value.commit, value.compiler, value.target].every((item) => item === undefined || typeof item === "string");
}

function isDiscoveredTool(value: unknown): boolean {
  return isRecord(value) && ["server", "cli", "bench", "perplexity", "unknown"].includes(String(value.kind))
    && typeof value.fileName === "string" && typeof value.path === "string" && typeof value.exists === "boolean";
}

function isRouterAssessment(value: unknown): boolean {
  return isRecord(value) && ["candidate", "partial", "unsupported", "unknown"].includes(String(value.status)) && isRecord(value.evidence)
    && typeof value.evidence.modelsPreset === "boolean" && typeof value.evidence.modelsMax === "boolean" && typeof value.evidence.modelsAutoload === "boolean"
    && isStringArray(value.missingRequiredFlags) && isStringArray(value.compatibilityHints);
}

function isGgufMetadataInspection(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || typeof value.artifactId !== "string" || !["ready", "partial", "invalid", "unsupported"].includes(String(value.status))
    || !["model", "mmproj", "adapter", "imatrix", "other", "unknown"].includes(String(value.artifactKind)) || !["metadata", "filename", "unknown"].includes(String(value.artifactKindSource))
    || !isRecord(value.metadata) || !Object.values(value.metadata).every((item) => typeof item === "string" || typeof item === "boolean" || typeof item === "number" && Number.isFinite(item))
    || !isStringArray(value.warnings)) return false;
  return [value.version, value.tensorCount, value.kvCount, value.trainedContext, value.embeddingLength, value.blockCount, value.expertCount, value.expertUsedCount, value.nextnPredictLayers].every(isOptionalFiniteNumber)
    && [value.displayName, value.architecture].every((item) => item === undefined || typeof item === "string")
    && (value.isMoE === undefined || typeof value.isMoE === "boolean");
}

function isStaticEvidence(value: unknown): boolean {
  return isRecord(value) && value.kind === "static" && typeof value.assessedAt === "string" && Array.isArray(value.discoveredTools) && value.discoveredTools.every(isDiscoveredTool)
    && (value.versionInfo === undefined || isVersionInfo(value.versionInfo)) && (value.serverFingerprint === undefined || typeof value.serverFingerprint === "string")
    && isRouterAssessment(value.routerFlags) && isStringArray(value.warnings);
}

function isFunctionalEvidence(value: unknown): boolean {
  return isRecord(value) && value.kind === "functional" && ["unknown", "not_validated", "validating", "eligible", "ineligible", "failed"].includes(String(value.state))
    && value.validationProtocolVersion === 1 && typeof value.serverFingerprint === "string" && typeof value.launchAttempted === "boolean"
    && [value.presetAccepted, value.healthVerified, value.modelsVerified, value.catalogBoundaryVerified, value.requiredBehaviorVerified].every((item) => item === undefined || typeof item === "boolean")
    && [value.attemptedAt, value.completedAt, value.reason].every((item) => item === undefined || typeof item === "string")
    && isStringArray(value.warnings) && isStringArray(value.failures);
}

function snapshotRevision(snapshot: Phase15DomainSnapshot): string {
  const migration = {
    ...snapshot.migration,
    startedAt: undefined,
    completedAt: undefined,
    backup: undefined
  };
  return hash(canonicalJson({ ...snapshot, revision: undefined, migration }));
}

function snapshotRevisionV1(snapshot: Phase15DomainSnapshotV1): string {
  const migration = { ...snapshot.migration, startedAt: undefined, completedAt: undefined, backup: undefined };
  return hash(canonicalJson({ ...snapshot, revision: undefined, migration }));
}

export function validatePhase15DomainSnapshotV1(value: unknown): asserts value is Phase15DomainSnapshotV1 {
  if (!isRecord(value) || value.schemaVersion !== PROFILE_MIGRATION_TARGET_VERSION || typeof value.revision !== "string") throw errorMessage("phase15-domain.json has an unsupported v1 shape");
  const legacy = value as unknown as Phase15DomainSnapshotV1;
  const bindings = Array.isArray(legacy.migration?.mappings) ? legacy.migration.mappings.map((mapping) => ({ legacyProfileId: mapping.legacyProfileId, configuredModelId: mapping.configuredModelId, legacyRuntimeEndpoint: clone(mapping.legacyRuntimeEndpoint) })) : [];
  const v2: Phase15DomainSnapshot = { ...clone(legacy), schemaVersion: PHASE15_DOMAIN_SCHEMA_VERSION, compatibilityBindings: bindings, revision: "" };
  v2.revision = snapshotRevision(v2);
  validatePhase15DomainSnapshot(v2);
  const modelIds = new Set(legacy.configuredModels.map((model) => model.id));
  const buildIds = new Set(legacy.builds.map((build) => build.id));
  const mappedIds = legacy.migration.mappings.map((mapping) => mapping.configuredModelId);
  if (legacy.migration.mappings.length !== modelIds.size || new Set(mappedIds).size !== modelIds.size || !mappedIds.every((id) => modelIds.has(id))
    || legacy.migration.migratedConfiguredModelIds.length !== modelIds.size || new Set(legacy.migration.migratedConfiguredModelIds).size !== modelIds.size || !legacy.migration.migratedConfiguredModelIds.every((id) => modelIds.has(id))
    || legacy.migration.migratedBuildIds.length !== buildIds.size || new Set(legacy.migration.migratedBuildIds).size !== buildIds.size || !legacy.migration.migratedBuildIds.every((id) => buildIds.has(id))
    || legacy.revision !== snapshotRevisionV1(legacy)) throw errorMessage("phase15-domain.json has invalid v1 migration results or revision");
}

export function validatePhase15DomainSnapshot(value: unknown): asserts value is Phase15DomainSnapshot {
  if (!isRecord(value) || value.schemaVersion !== PHASE15_DOMAIN_SCHEMA_VERSION || typeof value.revision !== "string" || value.revision.length === 0
    || !Array.isArray(value.artifacts) || !Array.isArray(value.configuredModels) || !Array.isArray(value.builds) || !isRecord(value.migration) || !Array.isArray(value.compatibilityBindings)) {
    throw errorMessage("phase15-domain.json has an unsupported shape");
  }
  const artifacts = value.artifacts as unknown[];
  const models = value.configuredModels as unknown[];
  const builds = value.builds as unknown[];
  const migration = value.migration;
  const referenceStatuses = new Set(["available", "missing", "invalid", "unknown"]);
  const validationStatuses = new Set(["not_validated", "valid", "invalid", "unknown"]);
  const buildStates = new Set(["unknown", "not_validated", "validating", "eligible", "ineligible", "failed"]);
  const artifactKinds = new Set(["model", "mmproj", "adapter", "imatrix", "other", "unknown"]);
  const buildClassifications = new Set(["official", "custom", "experimental", "compatibility", "unknown"]);
  if (!artifacts.every((artifact) => isRecord(artifact) && artifact.schemaVersion === MODEL_CONFIGURATION_SCHEMA_VERSION && typeof artifact.id === "string" && isReference(artifact.resource) && artifactKinds.has(String(artifact.kind)) && referenceStatuses.has(String(artifact.referenceStatus))
      && (artifact.metadata === undefined || isGgufMetadataInspection(artifact.metadata) && artifact.metadata.artifactId === artifact.id))
    || !builds.every((build) => isRecord(build) && build.schemaVersion === 1 && typeof build.id === "string" && typeof build.displayName === "string" && isReference(build.resource) && isReference(build.server)
      && Array.isArray(build.tools) && build.tools.every(isDiscoveredTool) && (build.versionInfo === undefined || isVersionInfo(build.versionInfo)) && (build.staticEvidence === undefined || isStaticEvidence(build.staticEvidence)) && (build.functionalEvidence === undefined || isFunctionalEvidence(build.functionalEvidence)) && (build.serverFingerprint === undefined || typeof build.serverFingerprint === "string")
      && buildClassifications.has(String(build.classification)) && buildStates.has(String(build.managedInferenceEligibility)) && isStringArray(build.warnings) && isStringArray(build.failures))
    || !models.every((model) => isRecord(model) && model.schemaVersion === MODEL_CONFIGURATION_SCHEMA_VERSION && typeof model.id === "string" && typeof model.displayName === "string"
      && typeof model.routerAlias === "string" && isRouterAlias(model.routerAlias) && typeof model.artifactId === "string" && typeof model.buildId === "string" && typeof model.enabled === "boolean"
      && isRecord(model.referenceStatus) && referenceStatuses.has(String(model.referenceStatus.artifact)) && referenceStatuses.has(String(model.referenceStatus.build))
      && validationStatuses.has(String(model.validationStatus)) && isLlamaArgs(model.llamaArgs) && isFlagOverrides(model.flagOverrides) && hasNoArgumentConflicts(model.llamaArgs, model.flagOverrides)
      && (model.extraArgs === undefined || isStringArray(model.extraArgs)) && (model.warnings === undefined || isStringArray(model.warnings))
      && (model.projector === undefined || (isRecord(model.projector) && typeof model.projector.artifactId === "string" && model.projector.selection === "explicit" && validationStatuses.has(String(model.projector.validationStatus)) && (model.projector.warnings === undefined || isStringArray(model.projector.warnings)))))) {
    throw errorMessage("phase15-domain.json contains malformed records");
  }
  const idsAreUnique = (items: UnknownRecord[]) => new Set(items.map((item) => item.id)).size === items.length;
  if (!idsAreUnique(artifacts as UnknownRecord[]) || !idsAreUnique(models as UnknownRecord[]) || !idsAreUnique(builds as UnknownRecord[])
    || new Set((models as UnknownRecord[]).map((model) => String(model.routerAlias).toLowerCase())).size !== models.length) {
    throw errorMessage("phase15-domain.json contains duplicate IDs or aliases");
  }
  const artifactIds = new Set((artifacts as UnknownRecord[]).map((artifact) => artifact.id));
  const buildIds = new Set((builds as UnknownRecord[]).map((build) => build.id));
  const artifactsById = new Map((artifacts as UnknownRecord[]).map((artifact) => [artifact.id, artifact]));
  if (!(models as UnknownRecord[]).every((model) => artifactIds.has(model.artifactId) && buildIds.has(model.buildId)
    && ["model", "unknown"].includes(String(artifactsById.get(model.artifactId)?.kind))
    && (model.projector === undefined || (isRecord(model.projector) && artifactIds.has(model.projector.artifactId) && ["mmproj", "unknown"].includes(String(artifactsById.get(model.projector.artifactId)?.kind)))))) {
    throw errorMessage("phase15-domain.json has invalid model references");
  }
  if (!(builds as UnknownRecord[]).every((build) => build.managedInferenceEligibility !== "eligible" || (isRecord(build.functionalEvidence)
    && build.functionalEvidence.state === "eligible" && build.functionalEvidence.launchAttempted === true && build.functionalEvidence.presetAccepted === true
    && build.functionalEvidence.healthVerified === true && build.functionalEvidence.modelsVerified === true && build.functionalEvidence.catalogBoundaryVerified === true
    && build.functionalEvidence.requiredBehaviorVerified === true && build.functionalEvidence.validationProtocolVersion === 1
    && typeof build.serverFingerprint === "string" && build.functionalEvidence.serverFingerprint === build.serverFingerprint))) {
    throw errorMessage("phase15-domain.json has unsupported managed inference eligibility evidence");
  }
  if (!(models as UnknownRecord[]).every((model) => {
    const references = model.referenceStatus as UnknownRecord;
    const projector = isRecord(model.projector) ? model.projector : undefined;
    const missing = references.artifact === "missing" || references.build === "missing";
    const projectorMissing = projector !== undefined && artifactsById.get(projector.artifactId)?.referenceStatus === "missing";
    return references.artifact === artifactsById.get(model.artifactId)?.referenceStatus
      && (!missing && !projectorMissing || (model.enabled === false && model.validationStatus === "invalid"))
      && (!projectorMissing || projector?.validationStatus === "invalid");
  })) {
    throw errorMessage("phase15-domain.json has inconsistent reference validation state");
  }
  if (migration.sourceVersion !== LEGACY_PROFILE_SOURCE_VERSION || migration.targetVersion !== PROFILE_MIGRATION_TARGET_VERSION
    || migration.status !== "completed" || typeof migration.sourceRevision !== "string" || migration.sourceRevision.length === 0 || typeof migration.completedAt !== "string" || !Array.isArray(migration.mappings)
    || !migration.mappings.every((mapping) => isRecord(mapping) && typeof mapping.legacyProfileId === "string" && typeof mapping.configuredModelId === "string" && typeof mapping.artifactId === "string" && typeof mapping.buildId === "string"
      && isRecord(mapping.legacyRuntimeEndpoint) && typeof mapping.legacyRuntimeEndpoint.host === "string" && typeof mapping.legacyRuntimeEndpoint.port === "number"
      && Array.isArray(mapping.preservedFields) && mapping.preservedFields.every((field) => ["llamaArgs", "flagOverrides", "extraArgs"].includes(String(field)))
      && isStringArray(mapping.warnings) && isStringArray(mapping.errors))
    || !Array.isArray(migration.invalidReferences) || !migration.invalidReferences.every((reference) => isRecord(reference) && typeof reference.legacyProfileId === "string" && ["model", "build", "projector"].includes(String(reference.kind)) && typeof reference.reference === "string" && typeof reference.reason === "string")
    || !isStringArray(migration.warnings) || !isStringArray(migration.errors) || typeof migration.recoverable !== "boolean"
    || (migration.backup !== undefined && (!isRecord(migration.backup) || typeof migration.backup.resource !== "string" || migration.backup.verified !== true || typeof migration.backup.checksum !== "string"))) {
    throw errorMessage("phase15-domain.json has an invalid migration record");
  }
  const modelIds = new Set((models as UnknownRecord[]).map((model) => model.id));
  const mappedModelIds = new Set(migration.mappings.map((mapping) => (mapping as UnknownRecord).configuredModelId));
  if (mappedModelIds.size !== migration.mappings.length
    || !Array.isArray(migration.migratedConfiguredModelIds) || !Array.isArray(migration.migratedBuildIds)
    || migration.migratedConfiguredModelIds.length !== migration.mappings.length || new Set(migration.migratedConfiguredModelIds).size !== migration.mappings.length
    || new Set(migration.migratedBuildIds).size !== migration.migratedBuildIds.length) {
    throw errorMessage("phase15-domain.json has inconsistent migration result IDs");
  }
  const bindings = value.compatibilityBindings as unknown[];
  if (!bindings.every((binding) => isRecord(binding) && typeof binding.legacyProfileId === "string" && modelIds.has(binding.configuredModelId)
    && isRecord(binding.legacyRuntimeEndpoint) && typeof binding.legacyRuntimeEndpoint.host === "string" && binding.legacyRuntimeEndpoint.host.trim().length > 0
    && Number.isInteger(binding.legacyRuntimeEndpoint.port) && Number(binding.legacyRuntimeEndpoint.port) > 0 && Number(binding.legacyRuntimeEndpoint.port) <= 65535)
    || new Set(bindings.map((binding) => (binding as UnknownRecord).legacyProfileId)).size !== bindings.length
    || new Set(bindings.map((binding) => (binding as UnknownRecord).configuredModelId)).size !== bindings.length
    || new Set(migration.mappings.map((mapping) => (mapping as UnknownRecord).legacyProfileId)).size !== migration.mappings.length
    || value.revision !== snapshotRevision(value as unknown as Phase15DomainSnapshot)) {
    throw errorMessage("phase15-domain.json has an invalid revision or duplicate migration mappings");
  }
}

async function referenceStatus(locator: string, inspect: typeof stat): Promise<"available" | "missing"> {
  try {
    await inspect(locator);
    return "available";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return "missing";
    throw error;
  }
}

async function createSnapshot(profiles: LlamaCppProfile[], sourceRevision: string, sourceBackup: ProfileMigrationRecord["backup"] | undefined, inspect: typeof stat, now: Date): Promise<Phase15DomainSnapshot> {
  const artifactByKey = new Map<string, ModelArtifact>();
  const buildByKey = new Map<string, LlamaCppBuild>();
  const modelEntries = await Promise.all(profiles.map(async (profile) => {
    const modelKey = normalizeLocalResourceLocator(profile.modelPath);
    const buildFolder = legacyBuildResourceFolder(profile.buildPath);
    const buildKey = normalizeLocalResourceLocator(buildFolder);
    const [artifactStatus, buildStatus] = await Promise.all([referenceStatus(profile.modelPath, inspect), referenceStatus(profile.buildPath, inspect)]);
    const artifactId = createModelArtifactId(`legacy-model:${modelKey}`);
    const buildId = createLlamaCppBuildId(`legacy-build:${buildKey}`);
    return { profile, modelKey, buildFolder, buildKey, artifactId, buildId, artifactStatus, buildStatus };
  }));
  for (const { profile, modelKey, buildFolder, buildKey, artifactId, buildId, artifactStatus, buildStatus } of modelEntries) {
    if (!artifactByKey.has(modelKey)) artifactByKey.set(modelKey, { schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION, id: artifactId, resource: resource(profile.modelPath), kind: "model", referenceStatus: artifactStatus });
    if (!buildByKey.has(buildKey)) buildByKey.set(buildKey, { schemaVersion: 1, id: buildId, displayName: legacyPathApi(buildFolder).basename(buildFolder) || buildFolder, resource: resource(buildFolder), server: resource(profile.buildPath), tools: [{ kind: "server", fileName: legacyPathApi(profile.buildPath).basename(profile.buildPath), path: profile.buildPath, exists: buildStatus === "available" }], classification: "unknown", managedInferenceEligibility: "not_validated", warnings: [], failures: [] });
  }
  const aliases: string[] = [];
  const configuredModels: ConfiguredModel[] = modelEntries.map(({ profile, artifactId, buildId, artifactStatus, buildStatus }) => {
    const id = createConfiguredModelId(`legacy-profile:${profile.id}`);
    const missing = artifactStatus === "missing" || buildStatus === "missing";
    const warnings = missing ? ["A legacy resource reference is missing."] : undefined;
    const model: ConfiguredModel = { schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION, id, displayName: profile.name, routerAlias: createRouterAlias(profile.name, id, aliases), artifactId, buildId, enabled: !missing, referenceStatus: { artifact: artifactStatus, build: buildStatus }, validationStatus: missing ? "invalid" : "not_validated", ...(warnings ? { warnings } : {}) };
    aliases.push(model.routerAlias);
    if (profile.llamaArgs !== undefined) model.llamaArgs = clone(profile.llamaArgs);
    if (profile.flagOverrides !== undefined) model.flagOverrides = clone(profile.flagOverrides);
    if (profile.extraArgs !== undefined) model.extraArgs = clone(profile.extraArgs);
    return model;
  });
  const mappings = modelEntries.map(({ profile, artifactId, buildId, artifactStatus, buildStatus }, index) => ({ legacyProfileId: profile.id, configuredModelId: configuredModels[index]!.id, artifactId, buildId, legacyRuntimeEndpoint: { host: profile.host, port: profile.port }, preservedFields: (["llamaArgs", "flagOverrides", "extraArgs"] as const).filter((field) => profile[field] !== undefined), warnings: artifactStatus === "missing" || buildStatus === "missing" ? ["A legacy resource reference is missing."] : [], errors: [] }));
  const invalidReferences = modelEntries.flatMap(({ profile, artifactStatus, buildStatus }) => [artifactStatus === "missing" ? { legacyProfileId: profile.id, kind: "model" as const, reference: profile.modelPath, reason: "missing" } : undefined, buildStatus === "missing" ? { legacyProfileId: profile.id, kind: "build" as const, reference: profile.buildPath, reason: "missing" } : undefined].filter((item): item is NonNullable<typeof item> => item !== undefined));
  const migration: ProfileMigrationRecord = { migrationId: `phase15-${sourceRevision.slice(0, 16)}`, sourceVersion: LEGACY_PROFILE_SOURCE_VERSION, targetVersion: PROFILE_MIGRATION_TARGET_VERSION, sourceRevision, status: "completed", completedAt: now.toISOString(), ...(sourceBackup ? { backup: sourceBackup } : {}), mappings, migratedConfiguredModelIds: configuredModels.map((model) => model.id), migratedBuildIds: [...buildByKey.values()].map((build) => build.id).sort((a, b) => a.localeCompare(b)), invalidReferences, warnings: [], errors: [], recoverable: true };
  const snapshot: Phase15DomainSnapshot = { schemaVersion: PHASE15_DOMAIN_SCHEMA_VERSION, revision: "", artifacts: [...artifactByKey.values()].sort((a, b) => a.id.localeCompare(b.id)), configuredModels, builds: [...buildByKey.values()].sort((a, b) => a.id.localeCompare(b.id)), migration, compatibilityBindings: mappings.map(({ legacyProfileId, configuredModelId, legacyRuntimeEndpoint }) => ({ legacyProfileId, configuredModelId, legacyRuntimeEndpoint })) };
  snapshot.revision = snapshotRevision(snapshot);
  return snapshot;
}

async function uniqueBackup(dataDir: string, fileName: string, bytes: Buffer, openFile: typeof open, read: typeof readFile, now: Date, prefixOverride?: string): Promise<ProfileMigrationRecord["backup"]> {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const checksum = hash(bytes);
  for (let counter = 0; ; counter += 1) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const prefix = prefixOverride ?? (fileName === domainFileName ? "corrupt-phase15" : "phase15");
    const name = `${fileName}.${prefix}-${stamp}-${checksum.slice(0, 12)}${suffix}.bak`;
    try {
      const handle = await openFile(path.join(dataDir, name), "wx");
      await handle.writeFile(bytes);
      await handle.close();
      const verified = hash(await read(path.join(dataDir, name))) === checksum;
      if (!verified) throw errorMessage(`backup verification failed for ${name}`);
      return { resource: name, createdAt: now.toISOString(), checksum, verified };
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") continue;
      throw error;
    }
  }
}

async function saveSnapshot(dataDir: string, snapshot: Phase15DomainSnapshot, dependencies: Phase15MigrationDependencies): Promise<void> {
  const write = dependencies.writeFile ?? writeFile;
  const move = dependencies.rename ?? rename;
  const remove = dependencies.unlink ?? unlink;
  const target = path.join(dataDir, domainFileName);
  const temporary = path.join(dataDir, `${domainFileName}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await write(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await move(temporary, target);
  } catch (error) {
    await remove(temporary).catch(() => undefined);
    throw error;
  }
}

export async function migratePhase15Domain(dataDir = getDataDir(), dependencies: Phase15MigrationDependencies = {}): Promise<"migrated" | "already_migrated"> {
  const read = dependencies.readFile ?? readFile;
  const write = dependencies.writeFile ?? writeFile;
  const openFile = dependencies.open ?? open;
  const inspect = dependencies.stat ?? stat;
  const now = dependencies.now ?? (() => new Date());
  const target = path.join(dataDir, domainFileName);
  let existingBytes: Buffer | undefined;
  try {
    existingBytes = await read(target);
    let existing: unknown;
    try { existing = JSON.parse(existingBytes.toString("utf8")); } catch {
      await uniqueBackup(dataDir, domainFileName, existingBytes, openFile, read, now());
      throw errorMessage("phase15-domain.json is invalid JSON");
    }
    if (isRecord(existing) && existing.schemaVersion === PHASE15_DOMAIN_SCHEMA_VERSION) {
      try { validatePhase15DomainSnapshot(existing); } catch (error) {
        await uniqueBackup(dataDir, domainFileName, existingBytes, openFile, read, now());
        throw error;
      }
      return "already_migrated";
    }
    if (isRecord(existing) && existing.schemaVersion === PROFILE_MIGRATION_TARGET_VERSION) {
      const legacy = existing as unknown as Phase15DomainSnapshotV1;
      try { validatePhase15DomainSnapshotV1(legacy); } catch (error) {
        await uniqueBackup(dataDir, domainFileName, existingBytes, openFile, read, now());
        throw error;
      }
      const bindings = legacy.migration.mappings.map((mapping) => ({ legacyProfileId: mapping.legacyProfileId, configuredModelId: mapping.configuredModelId, legacyRuntimeEndpoint: clone(mapping.legacyRuntimeEndpoint) }));
      const upgraded: Phase15DomainSnapshot = { ...clone(legacy), schemaVersion: PHASE15_DOMAIN_SCHEMA_VERSION, compatibilityBindings: bindings, revision: "" };
      upgraded.revision = snapshotRevision(upgraded);
      validatePhase15DomainSnapshot(upgraded);
      await uniqueBackup(dataDir, domainFileName, existingBytes, openFile, read, now(), "schema-v1-upgrade");
      await saveSnapshot(dataDir, upgraded, dependencies);
      return "migrated";
    }
    await uniqueBackup(dataDir, domainFileName, existingBytes, openFile, read, now());
    throw errorMessage("phase15-domain.json has an unsupported schema version");
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) throw error;
  }
  const source = await loadLegacyProfiles(dataDir, dependencies);
  if (source.kind === "invalid_json" || source.kind === "unsupported_shape") {
    await uniqueBackup(dataDir, profilesFileName, source.bytes, openFile, read, now());
    throw source.error;
  }
  if (source.kind === "io_error") throw source.error;
  const profiles = source.kind === "missing" ? [] : source.profiles;
  const sourceRevision = source.kind === "missing" ? hash(canonicalJson([])) : source.revision;
  const backup = source.kind === "valid" ? await uniqueBackup(dataDir, profilesFileName, source.bytes, openFile, read, now()) : undefined;
  const snapshot = await createSnapshot(profiles, sourceRevision, backup, inspect, now());
  validatePhase15DomainSnapshot(snapshot);
  await saveSnapshot(dataDir, snapshot, dependencies);
  return "migrated";
}

const domainMutationQueues = new Map<string, Promise<void>>();

export async function loadPhase15Domain(dataDir = getDataDir(), dependencies: Phase15MigrationDependencies = {}): Promise<Phase15DomainSnapshot> {
  await migratePhase15Domain(dataDir, dependencies);
  const bytes = await (dependencies.readFile ?? readFile)(path.join(dataDir, domainFileName));
  let snapshot: unknown;
  try { snapshot = JSON.parse(bytes.toString("utf8")); } catch { throw errorMessage("phase15-domain.json is invalid JSON"); }
  validatePhase15DomainSnapshot(snapshot);
  return clone(snapshot);
}

export async function mutatePhase15Domain<T>(mutator: (snapshot: Phase15DomainSnapshot) => T | Promise<T>, dataDir = getDataDir(), dependencies: Phase15MigrationDependencies = {}): Promise<{ snapshot: Phase15DomainSnapshot; result: T }> {
  const prior = domainMutationQueues.get(dataDir) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = prior.then(() => current);
  domainMutationQueues.set(dataDir, queued);
  await prior;
  try {
    const currentSnapshot = await loadPhase15Domain(dataDir, dependencies);
    const next = clone(currentSnapshot);
    const migration = canonicalJson(next.migration);
    const result = await mutator(next);
    if (canonicalJson(next.migration) !== migration) throw errorMessage("migration records are immutable");
    next.revision = snapshotRevision(next);
    validatePhase15DomainSnapshot(next);
    await saveSnapshot(dataDir, next, dependencies);
    return { snapshot: clone(next), result: clone(result) };
  } finally {
    release();
    if (domainMutationQueues.get(dataDir) === queued) domainMutationQueues.delete(dataDir);
  }
}

function localResourceKey(item: { resource: { owner: { scope: string }; locator: string } }): string | undefined {
  return item.resource.owner.scope === "local" ? normalizeLocalResourceLocator(item.resource.locator) : undefined;
}

export function findArtifactByLocalResource(snapshot: Phase15DomainSnapshot, locator: string): ModelArtifact | undefined {
  const key = normalizeLocalResourceLocator(locator);
  return clone(snapshot.artifacts.find((artifact) => localResourceKey(artifact) === key));
}

export function findOrRegisterLocalArtifactInSnapshot(snapshot: Phase15DomainSnapshot, locator: string, patch: Partial<Omit<ModelArtifact, "schemaVersion" | "id" | "resource">> = {}): ModelArtifact {
  const existing = snapshot.artifacts.find((artifact) => localResourceKey(artifact) === normalizeLocalResourceLocator(locator));
  if (existing) {
    if (patch.kind !== undefined) {
      const mainDependent = snapshot.configuredModels.some((model) => model.artifactId === existing.id);
      const projectorDependent = snapshot.configuredModels.some((model) => model.projector?.artifactId === existing.id);
      if (mainDependent && !["model", "unknown"].includes(patch.kind) || projectorDependent && !["mmproj", "unknown"].includes(patch.kind)) throw errorMessage("artifact kind conflicts with configured model dependents");
    }
    Object.assign(existing, clone(patch));
    return clone(existing);
  }
  const artifact: ModelArtifact = { schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION, id: createModelArtifactId(), resource: resource(locator), kind: patch.kind ?? "unknown", referenceStatus: patch.referenceStatus ?? "unknown", ...clone(patch) };
  snapshot.artifacts.push(artifact);
  return clone(artifact);
}

export function findOrRegisterLegacyBuildInSnapshot(snapshot: Phase15DomainSnapshot, serverLocator: string, referenceStatus: "available" | "missing" | "unknown" = "unknown"): LlamaCppBuild {
  const buildFolder = legacyBuildResourceFolder(serverLocator);
  const existing = snapshot.builds.find((build) => (build.resource.owner.scope === "local" && normalizeLocalResourceLocator(build.resource.locator) === normalizeLocalResourceLocator(buildFolder)) || (build.server.owner.scope === "local" && normalizeLocalResourceLocator(build.server.locator) === normalizeLocalResourceLocator(serverLocator)));
  if (existing) {
    if (referenceStatus !== "unknown") {
      const server = existing.tools.find((tool) => tool.kind === "server" && normalizeLocalResourceLocator(tool.path) === normalizeLocalResourceLocator(serverLocator));
      if (server) server.exists = referenceStatus === "available";
      else existing.tools.push({ kind: "server", fileName: path.basename(serverLocator), path: serverLocator, exists: referenceStatus === "available" });
    }
    return clone(existing);
  }
  const build: LlamaCppBuild = { schemaVersion: 1, id: createLlamaCppBuildId(normalizeLocalResourceLocator(buildFolder)), displayName: legacyPathApi(buildFolder).basename(buildFolder) || buildFolder, resource: resource(buildFolder), server: resource(serverLocator), tools: [{ kind: "server", fileName: legacyPathApi(serverLocator).basename(serverLocator), path: serverLocator, exists: referenceStatus === "available" }], classification: "unknown", managedInferenceEligibility: "not_validated", warnings: [], failures: [] };
  snapshot.builds.push(build);
  return clone(build);
}

export function reconcileBuildFingerprintInSnapshot(snapshot: Phase15DomainSnapshot, buildId: string, fingerprint: string | undefined, reason = "Router validation was invalidated because the resolved server executable changed or disappeared."): LlamaCppBuild {
  const build = snapshot.builds.find((entry) => entry.id === buildId);
  if (!build) throw errorMessage("build not found");
  const changed = build.serverFingerprint !== undefined && build.serverFingerprint !== fingerprint;
  const staleEvidence = build.functionalEvidence !== undefined && build.functionalEvidence.serverFingerprint !== fingerprint;
  if (changed || staleEvidence || fingerprint === undefined && (build.functionalEvidence !== undefined || build.managedInferenceEligibility === "eligible")) {
    build.managedInferenceEligibility = "not_validated";
    delete build.functionalEvidence;
    delete build.validatedAt;
    if (!build.warnings.includes(reason)) build.warnings.push(reason);
  }
  if (fingerprint === undefined) delete build.serverFingerprint;
  else build.serverFingerprint = fingerprint;
  return clone(build);
}

export function removeCompatibilityProfileInSnapshot(snapshot: Phase15DomainSnapshot, legacyProfileId: string): void {
  const index = snapshot.compatibilityBindings.findIndex((binding) => binding.legacyProfileId === legacyProfileId);
  if (index < 0) throw errorMessage("compatibility profile not found");
  snapshot.compatibilityBindings.splice(index, 1);
}

export function addOrUpdateCompatibilityBindingInSnapshot(snapshot: Phase15DomainSnapshot, binding: LegacyProfileCompatibilityBinding): LegacyProfileCompatibilityBinding {
  if (!snapshot.configuredModels.some((model) => model.id === binding.configuredModelId)) throw errorMessage("compatibility binding model not found");
  if (!binding.legacyProfileId || !binding.legacyRuntimeEndpoint.host || !Number.isInteger(binding.legacyRuntimeEndpoint.port) || binding.legacyRuntimeEndpoint.port < 1 || binding.legacyRuntimeEndpoint.port > 65535) throw errorMessage("invalid compatibility binding");
  const conflict = snapshot.compatibilityBindings.find((entry) => entry.configuredModelId === binding.configuredModelId && entry.legacyProfileId !== binding.legacyProfileId);
  if (conflict) throw errorMessage("configured model already has compatibility binding");
  const index = snapshot.compatibilityBindings.findIndex((entry) => entry.legacyProfileId === binding.legacyProfileId);
  if (index < 0) snapshot.compatibilityBindings.push(clone(binding)); else snapshot.compatibilityBindings[index] = clone(binding);
  return clone(binding);
}

export function projectCompatibilityProfiles(snapshot: Phase15DomainSnapshot): LegacyProfileCompatibilityBinding[] { return clone(snapshot.compatibilityBindings); }
export function projectCompatibilityProfile(snapshot: Phase15DomainSnapshot, legacyProfileId: string): LegacyProfileCompatibilityBinding | undefined { return clone(snapshot.compatibilityBindings.find((binding) => binding.legacyProfileId === legacyProfileId)); }

export const listArtifacts = (snapshot: Phase15DomainSnapshot): ModelArtifact[] => clone(snapshot.artifacts);
export const getArtifact = (snapshot: Phase15DomainSnapshot, id: string): ModelArtifact | undefined => clone(snapshot.artifacts.find((artifact) => artifact.id === id));
export const listBuilds = (snapshot: Phase15DomainSnapshot): LlamaCppBuild[] => clone(snapshot.builds);
export const getBuild = (snapshot: Phase15DomainSnapshot, id: string): LlamaCppBuild | undefined => clone(snapshot.builds.find((build) => build.id === id));
export const listConfiguredModels = (snapshot: Phase15DomainSnapshot): ConfiguredModel[] => clone(snapshot.configuredModels);
export const getConfiguredModel = (snapshot: Phase15DomainSnapshot, id: string): ConfiguredModel | undefined => clone(snapshot.configuredModels.find((model) => model.id === id));
export const listCompatibilityBindings = (snapshot: Phase15DomainSnapshot): LegacyProfileCompatibilityBinding[] => clone(snapshot.compatibilityBindings);
export const getCompatibilityBinding = (snapshot: Phase15DomainSnapshot, legacyProfileId: string): LegacyProfileCompatibilityBinding | undefined => clone(snapshot.compatibilityBindings.find((binding) => binding.legacyProfileId === legacyProfileId));

export async function findOrRegisterLocalArtifact(locator: string, kind: ModelArtifact["kind"] = "unknown", dataDir = getDataDir()): Promise<ModelArtifact> {
  const committed = await mutatePhase15Domain((snapshot) => findOrRegisterLocalArtifactInSnapshot(snapshot, locator, { kind }), dataDir);
  return clone(committed.result);
}

export async function deleteArtifactWithDependents(artifactId: string, dataDir = getDataDir()): Promise<void> {
  await mutatePhase15Domain((snapshot) => {
    if (!snapshot.artifacts.some((artifact) => artifact.id === artifactId)) throw errorMessage("artifact not found");
    if (snapshot.configuredModels.some((model) => model.artifactId === artifactId || model.projector?.artifactId === artifactId)) throw errorMessage("artifact has configured model dependents");
    snapshot.artifacts = snapshot.artifacts.filter((artifact) => artifact.id !== artifactId);
  }, dataDir);
}

export async function findOrRegisterLegacyBuild(serverLocator: string, dataDir = getDataDir()): Promise<LlamaCppBuild> {
  const committed = await mutatePhase15Domain((snapshot) => findOrRegisterLegacyBuildInSnapshot(snapshot, serverLocator), dataDir);
  return clone(committed.result);
}

export async function patchBuildDisplayNameAndClassification(buildId: string, patch: Pick<LlamaCppBuild, "displayName" | "classification">, dataDir = getDataDir()): Promise<LlamaCppBuild> {
  const committed = await mutatePhase15Domain((snapshot) => {
    const build = snapshot.builds.find((entry) => entry.id === buildId);
    if (!build) throw errorMessage("build not found");
    build.displayName = patch.displayName;
    build.classification = patch.classification;
    return build;
  }, dataDir);
  return clone(committed.result);
}

export async function deleteBuildWithDependents(buildId: string, dataDir = getDataDir()): Promise<void> {
  await mutatePhase15Domain((snapshot) => {
    if (!snapshot.builds.some((build) => build.id === buildId)) throw errorMessage("build not found");
    if (snapshot.configuredModels.some((model) => model.buildId === buildId)) throw errorMessage("build has configured model dependents");
    snapshot.builds = snapshot.builds.filter((build) => build.id !== buildId);
  }, dataDir);
}

export type ConfiguredModelCreateInput = Omit<ConfiguredModel, "schemaVersion" | "id" | "referenceStatus" | "validationStatus" | "routerAlias"> & { routerAlias?: string };
export type ConfiguredModelPatch = Partial<Omit<ConfiguredModel, "id" | "schemaVersion" | "referenceStatus" | "validationStatus" | "projector">> & { projector?: ConfiguredModel["projector"] | null };

function isBuildAvailable(build: LlamaCppBuild): boolean { return build.tools.some((tool) => tool.kind === "server" && tool.exists); }
function modelReferences(snapshot: Phase15DomainSnapshot, model: Pick<ConfiguredModel, "artifactId" | "buildId" | "projector">) {
  const artifact = snapshot.artifacts.find((entry) => entry.id === model.artifactId);
  const build = snapshot.builds.find((entry) => entry.id === model.buildId);
  const projector = model.projector && snapshot.artifacts.find((entry) => entry.id === model.projector!.artifactId);
  if (!artifact || !build || (model.projector && !projector)) throw errorMessage("configured model references must exist");
  if (artifact.kind !== "model" && artifact.kind !== "unknown") throw errorMessage("main artifact must be model or unknown");
  if (projector && projector.kind !== "mmproj" && projector.kind !== "unknown") throw errorMessage("projector artifact must be mmproj or unknown");
  const roleConflict = artifact.metadata?.artifactKind !== undefined && !["model", "unknown"].includes(artifact.metadata.artifactKind)
    || projector?.metadata?.artifactKind !== undefined && !["mmproj", "unknown"].includes(projector.metadata.artifactKind);
  return { artifact, build, projector, roleConflict };
}

export function createConfiguredModelInSnapshot(snapshot: Phase15DomainSnapshot, input: ConfiguredModelCreateInput): ConfiguredModel {
  const { artifact, build, projector, roleConflict } = modelReferences(snapshot, input);
  if (roleConflict) throw errorMessage("artifact metadata conflicts with configured model role");
  if (artifact.referenceStatus !== "available" || !isBuildAvailable(build) || (projector && projector.referenceStatus !== "available")) throw errorMessage("new configured model references are unavailable");
  const id = createConfiguredModelId();
  const aliases = snapshot.configuredModels.map((entry) => entry.routerAlias);
  if (input.routerAlias !== undefined && (!isRouterAlias(input.routerAlias) || aliases.some((alias) => alias.toLowerCase() === input.routerAlias!.toLowerCase()))) throw errorMessage("router alias is invalid or already in use");
  const model: ConfiguredModel = { ...clone(input), schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION, id, routerAlias: input.routerAlias ?? createRouterAlias(input.displayName, id, aliases), referenceStatus: { artifact: artifact.referenceStatus, build: "available" }, validationStatus: "not_validated" };
  snapshot.configuredModels.push(model);
  return clone(model);
}

export function updateConfiguredModelInSnapshot(snapshot: Phase15DomainSnapshot, id: string, patch: ConfiguredModelPatch): ConfiguredModel {
  const model = snapshot.configuredModels.find((entry) => entry.id === id);
  if (!model) throw errorMessage("configured model not found");
  const next = { ...clone(model), ...clone(patch), ...(patch.projector === null ? { projector: undefined } : {}) } as ConfiguredModel;
  const { artifact, build, projector, roleConflict } = modelReferences(snapshot, next);
  if (patch.routerAlias !== undefined && (!isRouterAlias(patch.routerAlias) || snapshot.configuredModels.some((entry) => entry.id !== id && entry.routerAlias.toLowerCase() === patch.routerAlias!.toLowerCase()))) throw errorMessage("router alias is invalid or already in use");
  next.referenceStatus = { artifact: artifact.referenceStatus, build: isBuildAvailable(build) ? "available" : "missing" };
  const unavailable = next.referenceStatus.artifact !== "available" || next.referenceStatus.build !== "available" || (projector && projector.referenceStatus !== "available");
  if (patch.enabled === true && roleConflict) throw errorMessage("cannot enable configured model with an artifact role conflict");
  if (next.enabled && unavailable) throw errorMessage("cannot enable unavailable configured model");
  if (unavailable || roleConflict) { next.enabled = false; next.validationStatus = "invalid"; }
  Object.assign(model, next);
  return clone(model);
}

export function duplicateConfiguredModelInSnapshot(snapshot: Phase15DomainSnapshot, id: string): ConfiguredModel {
  const source = snapshot.configuredModels.find((entry) => entry.id === id);
  if (!source) throw errorMessage("configured model not found");
  const { id: _id, routerAlias: _alias, schemaVersion: _schema, referenceStatus: _references, validationStatus: _validation, ...input } = clone(source);
  return createConfiguredModelInSnapshot(snapshot, { ...input, displayName: `${input.displayName} Copy`, enabled: source.enabled });
}

export async function createConfiguredModel(input: ConfiguredModelCreateInput, dataDir = getDataDir()): Promise<ConfiguredModel> { return (await mutatePhase15Domain((snapshot) => createConfiguredModelInSnapshot(snapshot, input), dataDir)).result; }
export async function updateConfiguredModel(id: string, patch: ConfiguredModelPatch, dataDir = getDataDir()): Promise<ConfiguredModel> { return (await mutatePhase15Domain((snapshot) => updateConfiguredModelInSnapshot(snapshot, id, patch), dataDir)).result; }
export async function duplicateConfiguredModel(id: string, dataDir = getDataDir()): Promise<ConfiguredModel> { return (await mutatePhase15Domain((snapshot) => duplicateConfiguredModelInSnapshot(snapshot, id), dataDir)).result; }

export async function deleteConfiguredModel(id: string, dataDir = getDataDir()): Promise<void> {
  await mutatePhase15Domain((snapshot) => {
    if (!snapshot.configuredModels.some((model) => model.id === id)) throw errorMessage("configured model not found");
    if (snapshot.compatibilityBindings.some((binding) => binding.configuredModelId === id)) throw errorMessage("configured model has compatibility binding");
    snapshot.configuredModels = snapshot.configuredModels.filter((model) => model.id !== id);
  }, dataDir);
}
