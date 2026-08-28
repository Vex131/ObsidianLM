import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  LEGACY_PROFILE_SOURCE_VERSION,
  MODEL_CONFIGURATION_SCHEMA_VERSION,
  PHASE15_DOMAIN_TARGET_VERSION,
  createConfiguredModelId,
  createLlamaCppBuildId,
  createModelArtifactId,
  createRouterAlias,
  isRouterAlias,
  type ConfiguredModel,
  type LlamaCppBuild,
  type LlamaCppProfile,
  type ModelArtifact,
  type ProfileMigrationRecord
} from "@obsidianlm/shared";
import { getDataDir } from "./paths.js";

const domainFileName = "phase15-domain.json";
const profilesFileName = "profiles.json";

export interface Phase15DomainSnapshot {
  schemaVersion: typeof PHASE15_DOMAIN_TARGET_VERSION;
  revision: string;
  artifacts: ModelArtifact[];
  configuredModels: ConfiguredModel[];
  builds: LlamaCppBuild[];
  migration: ProfileMigrationRecord;
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
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeLocalLocator(locator: string): string {
  if (process.platform !== "win32") return locator;
  return path.win32.normalize(locator.replaceAll("/", "\\")).toLowerCase();
}

function resource(locator: string) {
  return { owner: { scope: "local" as const }, locator };
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
  return isRecord(value) && isRecord(value.owner) && value.owner.scope === "local" && typeof value.locator === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
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

export function validatePhase15DomainSnapshot(value: unknown): asserts value is Phase15DomainSnapshot {
  if (!isRecord(value) || value.schemaVersion !== PHASE15_DOMAIN_TARGET_VERSION || typeof value.revision !== "string" || value.revision.length === 0
    || !Array.isArray(value.artifacts) || !Array.isArray(value.configuredModels) || !Array.isArray(value.builds) || !isRecord(value.migration)) {
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
  if (!artifacts.every((artifact) => isRecord(artifact) && artifact.schemaVersion === MODEL_CONFIGURATION_SCHEMA_VERSION && typeof artifact.id === "string" && isReference(artifact.resource) && artifactKinds.has(String(artifact.kind)) && referenceStatuses.has(String(artifact.referenceStatus)))
    || !builds.every((build) => isRecord(build) && build.schemaVersion === 1 && typeof build.id === "string" && typeof build.displayName === "string" && isReference(build.resource) && isReference(build.server)
      && Array.isArray(build.tools) && build.tools.every((tool) => isRecord(tool) && typeof tool.kind === "string" && typeof tool.fileName === "string" && typeof tool.path === "string" && typeof tool.exists === "boolean")
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
    && (model.projector === undefined || (isRecord(model.projector) && artifactIds.has(model.projector.artifactId))))) {
    throw errorMessage("phase15-domain.json has invalid model references");
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
  if (migration.sourceVersion !== LEGACY_PROFILE_SOURCE_VERSION || migration.targetVersion !== PHASE15_DOMAIN_TARGET_VERSION
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
  if (!migration.mappings.every((mapping) => {
    const entry = mapping as UnknownRecord;
    return artifactIds.has(entry.artifactId) && buildIds.has(entry.buildId) && modelIds.has(entry.configuredModelId);
  })) throw errorMessage("phase15-domain.json has invalid migration references");
  const mappedModelIds = new Set(migration.mappings.map((mapping) => (mapping as UnknownRecord).configuredModelId));
  if (migration.mappings.length !== modelIds.size || mappedModelIds.size !== modelIds.size || ![...mappedModelIds].every((id) => modelIds.has(id))
    || !Array.isArray(migration.migratedConfiguredModelIds) || !Array.isArray(migration.migratedBuildIds)
    || migration.migratedConfiguredModelIds.length !== modelIds.size || new Set(migration.migratedConfiguredModelIds).size !== modelIds.size || !migration.migratedConfiguredModelIds.every((id) => modelIds.has(id))
    || migration.migratedBuildIds.length !== buildIds.size || new Set(migration.migratedBuildIds).size !== buildIds.size || !migration.migratedBuildIds.every((id) => buildIds.has(id))) {
    throw errorMessage("phase15-domain.json has inconsistent migration result IDs");
  }
  if (new Set(migration.mappings.map((mapping) => (mapping as UnknownRecord).legacyProfileId)).size !== migration.mappings.length
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
    const modelKey = normalizeLocalLocator(profile.modelPath);
    const buildKey = normalizeLocalLocator(profile.buildPath);
    const [artifactStatus, buildStatus] = await Promise.all([referenceStatus(profile.modelPath, inspect), referenceStatus(profile.buildPath, inspect)]);
    const artifactId = createModelArtifactId(`legacy-model:${modelKey}`);
    const buildId = createLlamaCppBuildId(`legacy-build:${buildKey}`);
    if (!artifactByKey.has(modelKey)) artifactByKey.set(modelKey, { schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION, id: artifactId, resource: resource(profile.modelPath), kind: "model", referenceStatus: artifactStatus });
    if (!buildByKey.has(buildKey)) buildByKey.set(buildKey, { schemaVersion: 1, id: buildId, displayName: path.basename(profile.buildPath) || profile.buildPath, resource: resource(path.dirname(profile.buildPath)), server: resource(profile.buildPath), tools: [{ kind: "server", fileName: path.basename(profile.buildPath), path: profile.buildPath, exists: buildStatus === "available" }], classification: "unknown", managedInferenceEligibility: "not_validated", warnings: [], failures: [] });
    return { profile, artifactId, buildId, artifactStatus, buildStatus };
  }));
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
  const migration: ProfileMigrationRecord = { migrationId: `phase15-${sourceRevision.slice(0, 16)}`, sourceVersion: LEGACY_PROFILE_SOURCE_VERSION, targetVersion: PHASE15_DOMAIN_TARGET_VERSION, sourceRevision, status: "completed", completedAt: now.toISOString(), ...(sourceBackup ? { backup: sourceBackup } : {}), mappings, migratedConfiguredModelIds: configuredModels.map((model) => model.id), migratedBuildIds: [...buildByKey.values()].map((build) => build.id), invalidReferences, warnings: [], errors: [], recoverable: true };
  const snapshot: Phase15DomainSnapshot = { schemaVersion: PHASE15_DOMAIN_TARGET_VERSION, revision: "", artifacts: [...artifactByKey.values()].sort((a, b) => a.id.localeCompare(b.id)), configuredModels, builds: [...buildByKey.values()].sort((a, b) => a.id.localeCompare(b.id)), migration };
  snapshot.revision = snapshotRevision(snapshot);
  return snapshot;
}

async function uniqueBackup(dataDir: string, fileName: string, bytes: Buffer, openFile: typeof open, read: typeof readFile, now: Date): Promise<ProfileMigrationRecord["backup"]> {
  const stamp = now.toISOString().replace(/[:.]/gu, "-");
  const checksum = hash(bytes);
  for (let counter = 0; ; counter += 1) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const prefix = fileName === domainFileName ? "corrupt-phase15" : "phase15";
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
  const source = await loadLegacyProfiles(dataDir, dependencies);
  if (source.kind === "invalid_json" || source.kind === "unsupported_shape") {
    await uniqueBackup(dataDir, profilesFileName, source.bytes, openFile, read, now());
    throw source.error;
  }
  if (source.kind === "io_error") throw source.error;
  const profiles = source.kind === "missing" ? [] : source.profiles;
  const sourceRevision = source.kind === "missing" ? hash(canonicalJson([])) : source.revision;
  const target = path.join(dataDir, domainFileName);
  try {
    const existing = JSON.parse((await read(target)).toString("utf8")) as unknown;
    try {
      validatePhase15DomainSnapshot(existing);
    } catch (error) {
      await uniqueBackup(dataDir, domainFileName, await read(target), openFile, read, now());
      throw error;
    }
    if (existing.migration.sourceRevision === sourceRevision) return "already_migrated";
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      // No target is the normal first-run path.
    } else if (error instanceof SyntaxError) {
      await uniqueBackup(dataDir, domainFileName, await read(target), openFile, read, now());
      throw errorMessage("phase15-domain.json is invalid JSON");
    } else {
      throw error;
    }
  }
  const backup = source.kind === "valid" ? await uniqueBackup(dataDir, profilesFileName, source.bytes, openFile, read, now()) : undefined;
  const snapshot = await createSnapshot(profiles, sourceRevision, backup, inspect, now());
  validatePhase15DomainSnapshot(snapshot);
  await saveSnapshot(dataDir, snapshot, dependencies);
  return "migrated";
}
