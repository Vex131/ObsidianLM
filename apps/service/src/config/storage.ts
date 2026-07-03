import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultRuntimeState, defaultSettings, type AppSettings, type JobRecord, type RuntimeProfile, type RuntimeState } from "@obsidianlm/shared";
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
    adminTokenHash: isAdminTokenHash(settings.adminTokenHash) ? settings.adminTokenHash : null
  };
}

export async function loadSettings(): Promise<AppSettings> {
  return normalizeStoredSettings(await ensureJsonFile<Partial<AppSettings>>("settings.json", defaultSettings));
}

export async function loadProfiles(): Promise<RuntimeProfile[]> {
  return ensureJsonFile<RuntimeProfile[]>("profiles.json", []);
}

export async function loadRuntimeState(): Promise<RuntimeState> {
  return ensureJsonFile<RuntimeState>("runtime-state.json", defaultRuntimeState);
}

export async function loadJobs(): Promise<JobRecord[]> {
  const jobs = await ensureJsonFile<JobRecord[]>("jobs.json", []);
  return Array.isArray(jobs) ? jobs : [];
}

export async function saveRuntimeState(state: RuntimeState): Promise<void> {
  await writeJsonFile("runtime-state.json", state);
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
    ensureJsonFile<unknown[]>("jobs.json", [])
  ]);
}
