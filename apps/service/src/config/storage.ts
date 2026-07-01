import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { defaultRuntimeState, defaultSettings, type AppSettings, type JobRecord, type RuntimeProfile, type RuntimeState } from "@obsidianlm/shared";
import { getDataDir } from "./paths.js";

const jsonIndent = 2;

async function ensureJsonFile<T>(fileName: string, defaultValue: T): Promise<T> {
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });

  const filePath = path.join(dataDir, fileName);

  try {
    const file = await readFile(filePath, "utf8");
    return JSON.parse(file) as T;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await writeFile(filePath, `${JSON.stringify(defaultValue, null, jsonIndent)}\n`, "utf8");
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
    llamaCppFolders: Array.isArray(settings.llamaCppFolders) ? settings.llamaCppFolders.filter((folder): folder is string => typeof folder === "string") : defaultSettings.llamaCppFolders
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
  const dataDir = getDataDir();
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "runtime-state.json"), `${JSON.stringify(state, null, jsonIndent)}\n`, "utf8");
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
  await Promise.all([
    ensureJsonFile<AppSettings>("settings.json", defaultSettings),
    ensureJsonFile<RuntimeProfile[]>("profiles.json", []),
    ensureJsonFile<RuntimeState>("runtime-state.json", defaultRuntimeState),
    ensureJsonFile<unknown[]>("jobs.json", [])
  ]);
}
