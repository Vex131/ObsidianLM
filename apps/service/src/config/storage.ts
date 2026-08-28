import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultRouterRuntimeState, defaultRuntimeState, defaultSettings, type AppSettings, type JobRecord, type RouterRuntimeState, type RuntimeProfile, type RuntimeState } from "@obsidianlm/shared";
import { isAdminTokenHash } from "../auth/admin-token.js";
import { getDataDir } from "./paths.js";

const jsonIndent = 2;
const storageWarnings: string[] = [];

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function invalidBackupName(fileName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return `${fileName}.invalid-${timestamp}.bak`;
}

function rememberStorageWarning(fileName: string, backupName: string): void {
  storageWarnings.push(`${fileName} was invalid JSON. Backed it up as ${backupName} and recreated a safe default.`);
}

export function getStorageWarnings(): string[] {
  return [...storageWarnings];
}

async function readJsonFileReadOnly<T>(fileName: string, defaultValue: T): Promise<T> {
  const filePath = path.join(getDataDir(), fileName);
  try {
    const file = await readFile(filePath, "utf8");
    return JSON.parse(file) as T;
  } catch {
    return defaultValue;
  }
}

async function ensureJsonFile<T>(fileName: string, defaultValue: T): Promise<T> {
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });

  const filePath = path.join(dataDir, fileName);

  try {
    const file = await readFile(filePath, "utf8");
    return JSON.parse(file) as T;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await writeJsonFile(fileName, defaultValue);
      return defaultValue;
    }

    if (error instanceof SyntaxError) {
      const backupName = invalidBackupName(fileName);
      await copyFile(filePath, path.join(dataDir, backupName));
      await writeJsonFile(fileName, defaultValue);
      rememberStorageWarning(fileName, backupName);
      return defaultValue;
    }

    throw error;
  }
}

function normalizeStoredSettings(settings: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings,
    ...settings,
    modelFolders: Array.isArray(settings.modelFolders) ? settings.modelFolders.filter((folder): folder is string => typeof folder === "string") : defaultSettings.modelFolders,
    llamaCppFolders: Array.isArray(settings.llamaCppFolders) ? settings.llamaCppFolders.filter((folder): folder is string => typeof folder === "string") : defaultSettings.llamaCppFolders,
    toolInputFolders: Array.isArray(settings.toolInputFolders) ? settings.toolInputFolders.filter((folder): folder is string => typeof folder === "string") : defaultSettings.toolInputFolders,
    adminTokenHash: isAdminTokenHash(settings.adminTokenHash) ? settings.adminTokenHash : null
  };
}

export async function loadSettings(): Promise<AppSettings> {
  return normalizeStoredSettings(await ensureJsonFile<Partial<AppSettings>>("settings.json", defaultSettings));
}

export async function loadSettingsReadOnly(): Promise<AppSettings> {
  return normalizeStoredSettings(await readJsonFileReadOnly<Partial<AppSettings>>("settings.json", defaultSettings));
}

export async function loadProfiles(): Promise<RuntimeProfile[]> {
  return ensureJsonFile<RuntimeProfile[]>("profiles.json", []);
}

export async function loadProfilesReadOnly(): Promise<RuntimeProfile[]> {
  const profiles = await readJsonFileReadOnly<RuntimeProfile[]>("profiles.json", []);
  return Array.isArray(profiles) ? profiles : [];
}

export async function loadRuntimeState(): Promise<RuntimeState> {
  return ensureJsonFile<RuntimeState>("runtime-state.json", defaultRuntimeState);
}

function isRouterRuntimeState(value: unknown): value is RouterRuntimeState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<RouterRuntimeState>;
  const statuses = ["stopped", "starting", "running", "stopping", "exited", "failed", "unknown_previous_runtime"];
  const healthStates = ["unknown", "checking", "healthy", "unhealthy", "failed"];
  const modelStates = ["unloaded", "loading", "loaded", "sleeping", "unavailable", "failed", "unknown"];
  const artifact = state.generatedArtifact as Partial<NonNullable<RouterRuntimeState["generatedArtifact"]>> | undefined;
  return state.stateVersion === 1
    && (state.activeRuntimeId === null || typeof state.activeRuntimeId === "string" && state.activeRuntimeId.startsWith("router_"))
    && (state.activeBuildId === null || typeof state.activeBuildId === "string" && state.activeBuildId.startsWith("build_"))
    && (state.pid === null || Number.isInteger(state.pid) && state.pid! > 0)
    && (state.host === null || typeof state.host === "string")
    && (state.port === null || Number.isInteger(state.port) && state.port! > 0 && state.port! <= 65535)
    && typeof state.startedByObsidianLM === "boolean"
    && ["current_process_child", "persisted_candidate", "unproven"].includes(state.ownershipEvidence ?? "")
    && (state.startedAt === null || typeof state.startedAt === "string")
    && (state.commandHash === null || typeof state.commandHash === "string")
    && statuses.includes(state.status ?? "")
    && !!state.health && typeof state.health === "object" && state.health.endpoint === "/health" && healthStates.includes(state.health.state)
    && (!artifact || artifact.schemaVersion === 1 && artifact.authority === "derived" && typeof artifact.buildId === "string" && artifact.buildId.startsWith("build_") && artifact.resource?.owner.scope === "local" && typeof artifact.resource.locator === "string" && typeof artifact.generatorVersion === "string" && typeof artifact.sourceRevision === "string" && typeof artifact.contentHash === "string" && ["current", "stale", "unknown"].includes(artifact.freshness ?? "") && ["not_validated", "valid", "invalid", "failed"].includes(artifact.validationState ?? "") && Array.isArray(artifact.warnings) && artifact.warnings.every((item) => typeof item === "string") && Array.isArray(artifact.errors) && artifact.errors.every((item) => typeof item === "string"))
    && Array.isArray(state.configuredModelStates) && state.configuredModelStates.every((item) => !!item && typeof item.configuredModelId === "string" && item.configuredModelId.startsWith("model_") && modelStates.includes(item.state))
    && Array.isArray(state.warnings) && state.warnings.every((item) => !!item && typeof item.code === "string" && typeof item.message === "string")
    && Array.isArray(state.errors) && state.errors.every((item) => typeof item === "string")
    && (state.compatibilityProfileId === undefined || state.compatibilityProfileId === null || typeof state.compatibilityProfileId === "string");
}

export async function loadRouterRuntimeState(): Promise<RouterRuntimeState> {
  const fileName = "router-runtime-state.json";
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, fileName);
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (isRouterRuntimeState(parsed)) return parsed;
    throw new SyntaxError("Invalid router runtime state shape.");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      await saveRouterRuntimeState(defaultRouterRuntimeState);
      return structuredClone(defaultRouterRuntimeState);
    }
    if (error instanceof SyntaxError) {
      const backupName = invalidBackupName(fileName);
      await copyFile(filePath, path.join(dataDir, backupName));
      await saveRouterRuntimeState(defaultRouterRuntimeState);
      rememberStorageWarning(fileName, backupName);
      return structuredClone(defaultRouterRuntimeState);
    }
    throw error;
  }
}

export async function loadJobs(): Promise<JobRecord[]> {
  const jobs = await ensureJsonFile<JobRecord[]>("jobs.json", []);
  return Array.isArray(jobs) ? jobs : [];
}

export async function saveRuntimeState(state: RuntimeState): Promise<void> {
  // Deprecated legacy evidence only. Current router lifecycle never writes this file.
  await writeJsonFile("runtime-state.json", state);
}

export async function saveRouterRuntimeState(state: RouterRuntimeState): Promise<void> {
  await writeJsonFile("router-runtime-state.json", state);
}

async function writeJsonFile(fileName: string, value: unknown): Promise<void> {
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });
  const filePath = path.join(dataDir, fileName);
  const tempPath = path.join(dataDir, `${fileName}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, jsonIndent)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await writeJsonFile("settings.json", settings);
}

export async function saveProfiles(profiles: RuntimeProfile[]): Promise<void> {
  await writeJsonFile("profiles.json", profiles);
}

export async function saveJobs(jobs: JobRecord[]): Promise<void> {
  await writeJsonFile("jobs.json", jobs);
}

export async function ensureStorageFiles(): Promise<void> {
  const settings = await ensureJsonFile<Partial<AppSettings>>("settings.json", defaultSettings);
  const normalizedSettings = normalizeStoredSettings(settings);
  if (JSON.stringify(settings) !== JSON.stringify(normalizedSettings)) {
    await saveSettings(normalizedSettings);
  }

  await Promise.all([
    ensureJsonFile<RuntimeProfile[]>("profiles.json", []),
    ensureJsonFile<RuntimeState>("runtime-state.json", defaultRuntimeState),
    loadRouterRuntimeState(),
    ensureJsonFile<unknown[]>("jobs.json", [])
  ]);
}
