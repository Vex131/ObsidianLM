import { access } from "node:fs/promises";
import { defaultProfileEditorDefaults, type CommandSpec, type LlamaCppProfile, type RuntimeProfile } from "@obsidianlm/shared";
import { loadSettings, loadProfiles, saveProfiles } from "../config/storage.js";
import { detectPort } from "../process/port-detector.js";
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
    llamaArgs: {
      ...defaultProfileEditorDefaults.llamaArgs,
      ...(isRecord(input.llamaArgs) ? input.llamaArgs : {})
    },
    extraArgs: normalizeStringArray(input.extraArgs) ?? defaultProfileEditorDefaults.extraArgs
  };
}

function commandPreview(profile: RuntimeProfile, validation: ProfileValidationResult): CommandSpec | undefined {
  if (!isLlamaCppServerProfile(profile) || validation.errors.length > 0) {
    return undefined;
  }
  return buildLlamaCppServerCommand(profile);
}

export async function listProfiles(): Promise<RuntimeProfile[]> {
  const profiles = await loadProfiles();
  return Array.isArray(profiles) ? profiles : [];
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
  if (requestedId && profiles.some((profile) => profile.id === requestedId)) {
    const validation: ProfileValidationResult = { valid: false, errors: [`Profile id '${requestedId}' already exists.`], warnings: [] };
    return { profile: normalizeProfile(input, requestedId), validation };
  }

  const id = requestedId ?? ensureUniqueId(slugify(input.name ?? "Profile"), profiles);
  const profile = normalizeProfile(input, id);
  const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: profile.id });
  if (!validation.valid) {
    return { profile, validation };
  }

  await saveProfiles([...profiles, profile]);
  return { profile, validation, command: commandPreview(profile, validation) };
  });
}

export async function updateManualProfile(profileId: string, patch: Partial<LlamaCppProfile>): Promise<ProfileMutationResult | null> {
  return withProfileOperation(async () => {
  const profiles = await listProfiles();
  const index = profiles.findIndex((profile) => profile.id === profileId);
  if (index === -1) {
    return null;
  }

  const current = profiles[index] as LlamaCppProfile;
  const profile = normalizeProfile({ ...current, ...patch, id: current.id, runtimeType: "llama.cpp", providerKind: "server" }, current.id);
  const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: profile.id });
  if (!validation.valid) {
    return { profile, validation };
  }

  const nextProfiles = [...profiles];
  nextProfiles[index] = profile;
  await saveProfiles(nextProfiles);
  return { profile, validation, command: commandPreview(profile, validation) };
  });
}

export async function duplicateManualProfile(profileId: string, request: { id?: string; name?: string } = {}): Promise<ProfileMutationResult | null> {
  return withProfileOperation(async () => {
  const profiles = await listProfiles();
  const source = profiles.find((profile) => profile.id === profileId) as LlamaCppProfile | undefined;
  if (!source) {
    return null;
  }

  const name = hasString(request.name) ? request.name.trim() : `${source.name} Copy`;
  const id = hasString(request.id) ? request.id.trim() : ensureUniqueId(slugify(name), profiles);
  if (profiles.some((profile) => profile.id === id)) {
    const profile = normalizeProfile({ ...source, id, name }, id);
    return { profile, validation: { valid: false, errors: [`Profile id '${id}' already exists.`], warnings: [] } };
  }

  const profile = normalizeProfile({ ...source, id, name }, id);
  const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: profiles.map((item) => item.id), currentProfileId: profile.id });
  if (!validation.valid) {
    return { profile, validation };
  }

  await saveProfiles([...profiles, profile]);
  return { profile, validation, command: commandPreview(profile, validation) };
  });
}

export async function deleteManualProfile(profileId: string, canDelete: () => boolean = () => true): Promise<"deleted" | "not_found" | "blocked"> {
  return withProfileOperation(async () => {
  const profiles = await listProfiles();
  const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
  if (nextProfiles.length === profiles.length) {
    return "not_found";
  }
  if (!canDelete()) {
    return "blocked";
  }
  await saveProfiles(nextProfiles);
  return "deleted";
  });
}

export async function importManualProfiles(payload: unknown, rejectConflicts = false): Promise<ImportProfilesResult> {
  return withProfileOperation(async () => {
  const profiles = await listProfiles();
  const importedProfiles = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.profiles) ? payload.profiles : [];
  const result: ImportProfilesResult = { imported: 0, skipped: 0, errors: [], createdProfileIds: [], updatedProfileIds: [] };
  const nextProfiles = [...profiles];

  for (const [index, candidate] of importedProfiles.entries()) {
    if (!isRecord(candidate)) {
      result.skipped += 1;
      result.errors.push(`Profile at index ${index} is not an object.`);
      continue;
    }

    const requestedId = hasString(candidate.id) ? candidate.id.trim() : slugify(hasString(candidate.name) ? candidate.name : `Imported ${index + 1}`);
    const conflict = nextProfiles.some((profile) => profile.id === requestedId);
    if (conflict && rejectConflicts) {
      result.skipped += 1;
      result.errors.push(`Profile id '${requestedId}' conflicts with an existing profile.`);
      continue;
    }

    const id = conflict ? ensureUniqueId(requestedId, nextProfiles) : requestedId;
    const profile = normalizeProfile(candidate as Partial<LlamaCppProfile>, id);
    const validation = await validateProfile(profile, { strictPaths: false, existingProfileIds: nextProfiles.map((item) => item.id), currentProfileId: id });
    if (!validation.valid) {
      result.skipped += 1;
      result.errors.push(`Profile '${profile.name}' skipped: ${validation.errors.join(" ")}`);
      continue;
    }

    nextProfiles.push(profile);
    result.imported += 1;
    result.createdProfileIds.push(profile.id);
  }

  if (result.imported > 0) {
    await saveProfiles(nextProfiles);
  }

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
