import { access } from "node:fs/promises";
import path from "node:path";
import { defaultProfileEditorDefaults, type CommandSpec, type LlamaCppFlagOverride, type LlamaCppProfile, type RuntimeProfile } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { createConfiguredModelId, createRouterAlias, type ConfiguredModel } from "@obsidianlm/shared";
import { findOrRegisterLegacyBuildInSnapshot, findOrRegisterLocalArtifactInSnapshot, loadPhase15Domain, mutatePhase15Domain, type Phase15DomainSnapshot } from "../config/phase15-domain.js";
import { detectPort } from "../process/port-detector.js";
import { getLlamaBuildCapabilities } from "../discovery/llama-build-capabilities.js";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { buildLlamaCppServerCommand } from "./command.js";

export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProfileValidationOptions {
  strictPaths?: boolean;
  checkPort?: boolean;
  existingProfileIds?: string[];
  currentProfileId?: string;
}

export interface ProfileMutationResult {
  profile: RuntimeProfile;
  validation: ProfileValidationResult;
  command?: CommandSpec;
  warnings?: string[];
}

export interface ImportProfilesResult {
  imported: number;
  skipped: number;
  errors: string[];
  createdProfileIds: string[];
  updatedProfileIds: string[];
}

let profileMutationQueue = Promise.resolve();

export async function withProfileOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = profileMutationQueue.then(operation, operation);
  profileMutationQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionalNumber(container: Record<string, unknown>, key: string, errors: string[]): void {
  const value = container[key];
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`llamaArgs.${key} must be a number when provided.`);
  }
}

function validateOptionalString(container: Record<string, unknown>, key: string, errors: string[]): void {
  const value = container[key];
  if (value !== undefined && typeof value !== "string") {
    errors.push(`llamaArgs.${key} must be a string when provided.`);
  }
}

function validateOptionalBoolean(container: Record<string, unknown>, key: string, errors: string[]): void {
  const value = container[key];
  if (value !== undefined && typeof value !== "boolean") {
    errors.push(`llamaArgs.${key} must be a boolean when provided.`);
  }
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || `profile-${Date.now()}`;
}

function ensureUniqueId(baseId: string, profiles: RuntimeProfile[]): string {
  const existing = new Set(profiles.map((profile) => profile.id));
  if (!existing.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  let id = `${baseId}-${suffix}`;
  while (existing.has(id)) {
    suffix += 1;
    id = `${baseId}-${suffix}`;
  }
  return id;
}

function isValidId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(value);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
}

function normalizeFlagOverrides(value: unknown): LlamaCppFlagOverride[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value as LlamaCppFlagOverride[];
}

const legacyLlamaFlags: Array<{ key: keyof NonNullable<LlamaCppProfile["llamaArgs"]>; flag: string; aliases?: string[]; enabled: (value: unknown) => boolean }> = [
  { key: "ctxSize", flag: "--ctx-size", aliases: ["-c"], enabled: (value) => value !== undefined },
  { key: "gpuLayers", flag: "--n-gpu-layers", aliases: ["--gpu-layers", "-ngl"], enabled: (value) => value !== undefined },
  { key: "devices", flag: "--device", aliases: ["-dev"], enabled: (value) => Array.isArray(value) && value.length > 0 },
  { key: "splitMode", flag: "--split-mode", aliases: ["-sm"], enabled: (value) => value !== undefined },
  { key: "tensorSplit", flag: "--tensor-split", aliases: ["-ts"], enabled: (value) => value !== undefined },
  { key: "cacheTypeK", flag: "--cache-type-k", aliases: ["-ctk"], enabled: (value) => value !== undefined },
  { key: "cacheTypeV", flag: "--cache-type-v", aliases: ["-ctv"], enabled: (value) => value !== undefined },
  { key: "flashAttention", flag: "--flash-attn", aliases: ["-fa"], enabled: (value) => value === true },
  { key: "batchSize", flag: "--batch-size", aliases: ["-b"], enabled: (value) => value !== undefined },
  { key: "ubatchSize", flag: "--ubatch-size", aliases: ["-ub"], enabled: (value) => value !== undefined },
  { key: "parallel", flag: "--parallel", aliases: ["-np"], enabled: (value) => value !== undefined },
  { key: "threads", flag: "--threads", aliases: ["-t"], enabled: (value) => value !== undefined },
  { key: "threadsBatch", flag: "--threads-batch", aliases: ["-tb"], enabled: (value) => value !== undefined },
  { key: "contBatching", flag: "--cont-batching", enabled: (value) => value === true },
  { key: "metrics", flag: "--metrics", enabled: (value) => value === true },
  { key: "webui", flag: "--webui", enabled: (value) => value === true }
];

function normalizeProfile(input: Partial<LlamaCppProfile>, existingId?: string): LlamaCppProfile {
  return {
    id: existingId ?? (hasString(input.id) ? input.id.trim() : slugify(input.name ?? "Profile")),
    name: hasString(input.name) ? input.name.trim() : "Untitled llama.cpp profile",
    runtimeType: "llama.cpp",
    providerKind: "server",
    buildPath: typeof input.buildPath === "string" ? input.buildPath.trim() : "",
    modelPath: typeof input.modelPath === "string" ? input.modelPath.trim() : "",
    host: typeof input.host === "string" && input.host.trim() ? input.host.trim() : defaultProfileEditorDefaults.host,
    port: typeof input.port === "number" ? input.port : defaultProfileEditorDefaults.port,
    llamaArgs: isRecord(input.llamaArgs) ? { ...input.llamaArgs } : {},
    flagOverrides: normalizeFlagOverrides(input.flagOverrides) ?? defaultProfileEditorDefaults.flagOverrides,
    extraArgs: normalizeStringArray(input.extraArgs) ?? defaultProfileEditorDefaults.extraArgs
  };
}

function commandPreview(profile: RuntimeProfile, validation: ProfileValidationResult): CommandSpec | undefined {
  if (!isLlamaCppServerProfile(profile) || validation.errors.length > 0) {
    return undefined;
  }
  return buildLlamaCppServerCommand(profile);
}

function projectProfiles(snapshot: Phase15DomainSnapshot): LlamaCppProfile[] {
  return snapshot.compatibilityBindings.map((binding) => {
    const model = snapshot.configuredModels.find((entry) => entry.id === binding.configuredModelId);
    const artifact = model && snapshot.artifacts.find((entry) => entry.id === model.artifactId);
    const build = model && snapshot.builds.find((entry) => entry.id === model.buildId);
    if (!model || !artifact || !build || artifact.resource.owner.scope !== "local" || build.server.owner.scope !== "local") throw new Error("Phase 15 domain compatibility relation is invalid");
    return { id: binding.legacyProfileId, name: model.displayName, runtimeType: "llama.cpp", providerKind: "server", modelPath: artifact.resource.locator, buildPath: build.server.locator, host: binding.legacyRuntimeEndpoint.host, port: binding.legacyRuntimeEndpoint.port, llamaArgs: structuredClone(model.llamaArgs ?? {}), flagOverrides: structuredClone(model.flagOverrides ?? []), extraArgs: structuredClone(model.extraArgs ?? []) };
  });
}

function legacyModel(snapshot: Phase15DomainSnapshot, profile: LlamaCppProfile): ConfiguredModel {
  const id = createConfiguredModelId();
  return { schemaVersion: 1, id, displayName: profile.name, routerAlias: createRouterAlias(profile.name, id, snapshot.configuredModels.map((entry) => entry.routerAlias)), artifactId: "artifact_pending" as ConfiguredModel["artifactId"], buildId: "build_pending" as ConfiguredModel["buildId"], enabled: false, referenceStatus: { artifact: "missing", build: "missing" }, validationStatus: "invalid", llamaArgs: structuredClone(profile.llamaArgs), flagOverrides: structuredClone(profile.flagOverrides), extraArgs: structuredClone(profile.extraArgs) };
}

export async function listProfiles(): Promise<RuntimeProfile[]> {
  return projectProfiles(await loadPhase15Domain());
}

export async function getProfile(profileId: string): Promise<RuntimeProfile | null> {
  const profiles = await listProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

export function isLlamaCppServerProfile(profile: RuntimeProfile): profile is LlamaCppProfile {
  return profile.runtimeType === "llama.cpp" && profile.providerKind === "server";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateProfile(profile: unknown, options: ProfileValidationOptions = {}): Promise<ProfileValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const strictPaths = options.strictPaths ?? true;

  if (!isRecord(profile)) {
    return {
      valid: false,
      errors: ["Unsupported profile shape: profile must be an object."],
      warnings
    };
  }

  if (!hasString(profile.id)) {
    errors.push("Profile id is required.");
  } else if (!isValidId(profile.id)) {
    errors.push("Profile id may only contain letters, numbers, dots, dashes, and underscores, and must start with a letter or number.");
  } else if (options.existingProfileIds?.some((id) => id === profile.id && id !== options.currentProfileId)) {
    errors.push(`Profile id '${profile.id}' already exists.`);
  }

  if (!hasString(profile.name)) {
    errors.push("Profile name is required.");
  }

  if (profile.runtimeType !== "llama.cpp") {
    errors.push("Unsupported runtimeType. Phase 1 only supports llama.cpp.");
  }

  if (profile.providerKind !== "server") {
    errors.push("Unsupported providerKind. Phase 1 only supports server profiles.");
  }

  if (!hasString(profile.buildPath)) {
    errors.push("buildPath is required.");
  }

  if (!hasString(profile.modelPath)) {
    errors.push("modelPath is required.");
  }

  if (!hasString(profile.host)) {
    errors.push("host is required.");
  } else if (/\s/u.test(profile.host)) {
    errors.push("host must not contain whitespace.");
  }

  if (typeof profile.port !== "number" || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    errors.push("port must be a valid number between 1 and 65535.");
  }

  if (profile.extraArgs !== undefined && (!Array.isArray(profile.extraArgs) || !profile.extraArgs.every((arg) => typeof arg === "string"))) {
    errors.push("extraArgs must be an array of strings.");
  }

  if (profile.flagOverrides !== undefined) {
    if (!Array.isArray(profile.flagOverrides)) {
      errors.push("flagOverrides must be an array when provided.");
    } else {
      const seenFlags = new Set<string>();
      const reservedFlags = new Set(["--model", "-m", "--host", "--port"]);
      const legacyFlags = new Map(legacyLlamaFlags.flatMap((item) => [item.flag, ...(item.aliases ?? [])].map((flag) => [flag, item.key] as const)));
      for (const [index, override] of profile.flagOverrides.entries()) {
        if (!isRecord(override) || !hasString(override.flag) || !/^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/u.test(override.flag)) {
          errors.push(`flagOverrides[${index}].flag must be a flag name.`);
          continue;
        }
        const flag = override.flag.trim();
        if (seenFlags.has(flag)) {
          errors.push(`flagOverrides must not contain duplicate flag '${flag}'.`);
        }
        seenFlags.add(flag);
        if (reservedFlags.has(flag)) {
          errors.push(`flagOverrides must not override required ${flag}.`);
        }
        const legacyKey = legacyFlags.get(flag);
        if (legacyKey && isRecord(profile.llamaArgs) && profile.llamaArgs[legacyKey] !== undefined) {
          errors.push(`flagOverrides '${flag}' conflicts with llamaArgs.${legacyKey}.`);
        }
        if (override.values !== undefined && (!Array.isArray(override.values) || !override.values.every((value) => typeof value === "string" && value.trim().length > 0))) {
          errors.push(`flagOverrides[${index}].values must be an array of non-empty strings when provided.`);
        }
      }
      if (profile.flagOverrides.length > 0) {
        warnings.push("Custom flag overrides are passed directly to llama.cpp and may require future build-specific handling.");
      }
    }
  }

  if (isRecord(profile.llamaArgs)) {
    validateOptionalNumber(profile.llamaArgs, "ctxSize", errors);
    const gpuLayers = profile.llamaArgs.gpuLayers;
    if (gpuLayers !== undefined && gpuLayers !== "all" && (typeof gpuLayers !== "number" || !Number.isFinite(gpuLayers))) {
      errors.push("llamaArgs.gpuLayers must be a number or 'all' when provided.");
    }

    const devices = profile.llamaArgs.devices;
    if (devices !== undefined && (!Array.isArray(devices) || !devices.every((device) => typeof device === "string"))) {
      errors.push("llamaArgs.devices must be an array of strings.");
    } else if (Array.isArray(devices) && devices.some((device) => !device.trim())) {
      errors.push("llamaArgs.devices entries must not be empty strings.");
    }

    validateOptionalString(profile.llamaArgs, "splitMode", errors);
    validateOptionalString(profile.llamaArgs, "tensorSplit", errors);
    validateOptionalString(profile.llamaArgs, "cacheTypeK", errors);
    validateOptionalString(profile.llamaArgs, "cacheTypeV", errors);
    validateOptionalBoolean(profile.llamaArgs, "flashAttention", errors);
    validateOptionalNumber(profile.llamaArgs, "batchSize", errors);
    validateOptionalNumber(profile.llamaArgs, "ubatchSize", errors);
    validateOptionalNumber(profile.llamaArgs, "parallel", errors);
    validateOptionalNumber(profile.llamaArgs, "threads", errors);
    validateOptionalNumber(profile.llamaArgs, "threadsBatch", errors);
    validateOptionalBoolean(profile.llamaArgs, "contBatching", errors);
    validateOptionalBoolean(profile.llamaArgs, "metrics", errors);
    validateOptionalBoolean(profile.llamaArgs, "webui", errors);

    if (typeof profile.llamaArgs.ctxSize === "number" && profile.llamaArgs.ctxSize > 262144) {
      warnings.push("ctxSize is unusually high and may require very large VRAM/RAM.");
    }

    if (typeof profile.llamaArgs.tensorSplit === "string" && (!Array.isArray(devices) || devices.length < 2)) {
      warnings.push("tensorSplit is set but fewer than two GPU devices are configured.");
    }

    if (profile.llamaArgs.gpuLayers === "all" && (!Array.isArray(devices) || devices.length === 0)) {
      warnings.push("gpuLayers is set to all without explicit GPU devices; llama.cpp will choose available devices.");
    }
  } else if (profile.llamaArgs !== undefined) {
    errors.push("llamaArgs must be an object when provided.");
  }

  if (hasString(profile.buildPath) && !(await pathExists(profile.buildPath))) {
    (strictPaths ? errors : warnings).push("buildPath does not exist on disk.");
  }

  if (hasString(profile.modelPath) && !(await pathExists(profile.modelPath))) {
    (strictPaths ? errors : warnings).push("modelPath does not exist on disk.");
  }

  if (typeof profile.port === "number" && Number.isInteger(profile.port)) {
    const settings = await loadSettings().catch(() => null);
    if (settings && profile.port !== settings.managedLlamaPort) {
      warnings.push(`Profile port ${profile.port} differs from managed llama.cpp port ${settings.managedLlamaPort}.`);
    }

    if (options.checkPort) {
      const port = await detectPort(profile.port, "127.0.0.1").catch(() => null);
      if (port?.inUse) {
        warnings.push(`Port ${profile.port} is currently in use.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

export async function createManualProfile(input: Partial<LlamaCppProfile>): Promise<ProfileMutationResult> {
  return withProfileOperation(async () => {
    const profiles = await listProfiles();
    const requestedId = hasString(input.id) ? input.id.trim() : undefined;
    if (requestedId && profiles.some((profile) => profile.id === requestedId)) return { profile: normalizeProfile(input, requestedId), validation: { valid: false, errors: [`Profile id '${requestedId}' already exists.`], warnings: [] } };
    const profile = normalizeProfile(input, requestedId ?? ensureUniqueId(slugify(input.name ?? "Profile"), profiles));
    const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: profile.id });
    if (!validation.valid) return { profile, validation };
    const [modelExists, buildExists] = await Promise.all([pathExists(profile.modelPath), pathExists(profile.buildPath)]);
    const committed = await mutatePhase15Domain((snapshot) => {
      if (snapshot.compatibilityBindings.some((binding) => binding.legacyProfileId === profile.id)) throw new Error(`Profile id '${profile.id}' already exists.`);
      const artifact = findOrRegisterLocalArtifactInSnapshot(snapshot, profile.modelPath, { kind: "model", referenceStatus: modelExists ? "available" : "missing" });
      const build = findOrRegisterLegacyBuildInSnapshot(snapshot, profile.buildPath, buildExists ? "available" : "missing");
      const model = legacyModel(snapshot, profile);
      model.artifactId = artifact.id; model.buildId = build.id;
      const available = modelExists && buildExists;
      model.referenceStatus = { artifact: modelExists ? "available" : "missing", build: buildExists ? "available" : "missing" };
      model.enabled = available; model.validationStatus = available ? "not_validated" : "invalid";
      snapshot.configuredModels.push(model);
      snapshot.compatibilityBindings.push({ legacyProfileId: profile.id, configuredModelId: model.id, legacyRuntimeEndpoint: { host: profile.host, port: profile.port } });
      return projectProfiles(snapshot).find((entry) => entry.id === profile.id)!;
    });
    return { profile: committed.result, validation, command: commandPreview(committed.result, validation) };
  });
}

export async function updateManualProfile(profileId: string, patch: Partial<LlamaCppProfile>): Promise<ProfileMutationResult | null> {
  return withProfileOperation(async () => {
    const profiles = await listProfiles();
    const current = profiles.find((profile) => profile.id === profileId) as LlamaCppProfile | undefined;
    if (!current) return null;
    const profile = normalizeProfile({ ...current, ...patch, id: current.id, runtimeType: "llama.cpp", providerKind: "server" }, current.id);
    const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: profile.id });
    if (!validation.valid) return { profile, validation };
    const [modelExists, buildExists] = await Promise.all([pathExists(profile.modelPath), pathExists(profile.buildPath)]);
    const committed = await mutatePhase15Domain((snapshot) => {
      const binding = snapshot.compatibilityBindings.find((entry) => entry.legacyProfileId === profileId);
      const model = binding && snapshot.configuredModels.find((entry) => entry.id === binding.configuredModelId);
      if (!binding || !model) throw new Error("Phase 15 domain compatibility relation is invalid");
      const artifact = findOrRegisterLocalArtifactInSnapshot(snapshot, profile.modelPath, { kind: "model", referenceStatus: modelExists ? "available" : "missing" });
      const build = findOrRegisterLegacyBuildInSnapshot(snapshot, profile.buildPath, buildExists ? "available" : "missing");
      model.displayName = profile.name; model.artifactId = artifact.id; model.buildId = build.id;
      model.llamaArgs = structuredClone(profile.llamaArgs); model.flagOverrides = structuredClone(profile.flagOverrides); model.extraArgs = structuredClone(profile.extraArgs);
      model.referenceStatus = { artifact: modelExists ? "available" : "missing", build: buildExists ? "available" : "missing" };
      model.enabled = modelExists && buildExists; model.validationStatus = model.enabled ? "not_validated" : "invalid";
      binding.legacyRuntimeEndpoint = { host: profile.host, port: profile.port };
      return projectProfiles(snapshot).find((entry) => entry.id === profileId)!;
    });
    return { profile: committed.result, validation, command: commandPreview(committed.result, validation) };
  });
}

export async function validateProfileDraft(input: Partial<LlamaCppProfile>, preview = false): Promise<ProfileMutationResult> {
  const profiles = await listProfiles();
  const profile = normalizeProfile(input);
  const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: profile.id });
  validation.warnings.push("buildPath is not in the current discovered llama.cpp catalog; capability compatibility was not checked.");
  return { profile, validation, command: preview ? commandPreview(profile, validation) : undefined };
}

export async function duplicateManualProfile(profileId: string, request: { id?: string; name?: string } = {}): Promise<ProfileMutationResult | null> {
  return withProfileOperation(async () => {
    const profiles = await listProfiles(); const source = profiles.find((profile) => profile.id === profileId) as LlamaCppProfile | undefined;
    if (!source) return null;
    const name = hasString(request.name) ? request.name.trim() : `${source.name} Copy`;
    const id = hasString(request.id) ? request.id.trim() : ensureUniqueId(slugify(name), profiles);
    if (profiles.some((profile) => profile.id === id)) return { profile: normalizeProfile({ ...source, id, name }, id), validation: { valid: false, errors: [`Profile id '${id}' already exists.`], warnings: [] } };
    const profile = normalizeProfile({ ...source, id, name }, id); const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: id });
    if (!validation.valid) return { profile, validation };
    const committed = await mutatePhase15Domain((snapshot) => {
      const binding = snapshot.compatibilityBindings.find((entry) => entry.legacyProfileId === profileId); const sourceModel = binding && snapshot.configuredModels.find((entry) => entry.id === binding.configuredModelId);
      if (!binding || !sourceModel) throw new Error("Phase 15 domain compatibility relation is invalid");
      const id2 = createConfiguredModelId(); const model = structuredClone(sourceModel); model.id = id2; model.displayName = name; model.routerAlias = createRouterAlias(name, id2, snapshot.configuredModels.map((entry) => entry.routerAlias));
      snapshot.configuredModels.push(model); snapshot.compatibilityBindings.push({ legacyProfileId: id, configuredModelId: id2, legacyRuntimeEndpoint: structuredClone(binding.legacyRuntimeEndpoint) });
      return projectProfiles(snapshot).find((entry) => entry.id === id)!;
    });
    return { profile: committed.result, validation, command: commandPreview(committed.result, validation) };
  });
}

export async function deleteManualProfile(profileId: string, canDelete: () => boolean = () => true): Promise<"deleted" | "not_found" | "blocked"> {
  return withProfileOperation(async () => {
    if (!canDelete()) return "blocked";
    try { await mutatePhase15Domain((snapshot) => { const index = snapshot.compatibilityBindings.findIndex((binding) => binding.legacyProfileId === profileId); if (index < 0) throw new Error("PROFILE_NOT_FOUND"); const modelId = snapshot.compatibilityBindings[index]!.configuredModelId; snapshot.compatibilityBindings.splice(index, 1); snapshot.configuredModels = snapshot.configuredModels.filter((model) => model.id !== modelId); }); return "deleted"; }
    catch (error) { if (error instanceof Error && error.message === "PROFILE_NOT_FOUND") return "not_found"; throw error; }
  });
}

export async function importManualProfiles(payload: unknown, rejectConflicts = false): Promise<ImportProfilesResult> {
  return withProfileOperation(async () => {
    const profiles = await listProfiles(); const candidates = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.profiles) ? payload.profiles : [];
    const result: ImportProfilesResult = { imported: 0, skipped: 0, errors: [], createdProfileIds: [], updatedProfileIds: [] }; const accepted: LlamaCppProfile[] = []; const used = [...profiles];
    for (const [index, candidate] of candidates.entries()) {
      if (!isRecord(candidate)) { result.skipped++; result.errors.push(`Profile at index ${index} is not an object.`); continue; }
      const requested = hasString(candidate.id) ? candidate.id.trim() : slugify(hasString(candidate.name) ? candidate.name : `Imported ${index + 1}`); const conflict = used.some((profile) => profile.id === requested);
      if (conflict && rejectConflicts) { result.skipped++; result.errors.push(`Profile id '${requested}' conflicts with an existing profile.`); continue; }
      const profile = normalizeProfile(candidate as Partial<LlamaCppProfile>, conflict ? ensureUniqueId(requested, used) : requested); const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: used.map((item) => item.id), currentProfileId: profile.id });
      if (!validation.valid) { result.skipped++; result.errors.push(`Profile '${profile.name}' skipped: ${validation.errors.join(" ")}`); continue; }
      used.push(profile); accepted.push(profile); result.imported++; result.createdProfileIds.push(profile.id);
    }
    const availability = await Promise.all(accepted.map(async (profile) => ({ profile, model: await pathExists(profile.modelPath), build: await pathExists(profile.buildPath) })));
    if (accepted.length) await mutatePhase15Domain((snapshot) => { for (const item of availability) { const artifact = findOrRegisterLocalArtifactInSnapshot(snapshot, item.profile.modelPath, { kind: "model", referenceStatus: item.model ? "available" : "missing" }); const build = findOrRegisterLegacyBuildInSnapshot(snapshot, item.profile.buildPath, item.build ? "available" : "missing"); const model = legacyModel(snapshot, item.profile); model.artifactId = artifact.id; model.buildId = build.id; model.referenceStatus = { artifact: item.model ? "available" : "missing", build: item.build ? "available" : "missing" }; model.enabled = item.model && item.build; model.validationStatus = model.enabled ? "not_validated" : "invalid"; snapshot.configuredModels.push(model); snapshot.compatibilityBindings.push({ legacyProfileId: item.profile.id, configuredModelId: model.id, legacyRuntimeEndpoint: { host: item.profile.host, port: item.profile.port } }); } });
    return result;
  });
}

export function buildProfileEndpoint(profile: LlamaCppProfile): string {
  const bindHost = profile.host === "0.0.0.0" || profile.host === "::" ? "localhost" : profile.host;
  const host = bindHost.includes(":") && !bindHost.startsWith("[") ? `[${bindHost}]` : bindHost;
  return `http://${host}:${profile.port}/v1`;
}

export function buildProfileSnippets(profile: LlamaCppProfile): { command: CommandSpec; endpoint: string; opencodeStarterSnippet: string; illustriaStarterSnippet: string } {
  const command = buildLlamaCppServerCommand(profile);
  const endpoint = buildProfileEndpoint(profile);
  const opencodeStarterSnippet = JSON.stringify(
    {
      provider: {
        "obsidianlm-llama": {
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: endpoint },
          models: { local: {} }
        }
      }
    },
    null,
    2
  );
  const illustriaStarterSnippet = JSON.stringify(
    {
      name: profile.name,
      baseUrl: endpoint,
      model: "local",
      provider: "openai-compatible"
    },
    null,
    2
  );
  return { command, endpoint, opencodeStarterSnippet, illustriaStarterSnippet };
}
