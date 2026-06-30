import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultRuntimeState, defaultSettings, type AppSettings, type RuntimeProfile, type RuntimeState } from "@obsidianlm/shared";
import { dataDir } from "./paths.js";

const jsonIndent = 2;

async function ensureJsonFile<T>(fileName: string, defaultValue: T): Promise<T> {
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

export async function loadSettings(): Promise<AppSettings> {
  return ensureJsonFile("settings.json", defaultSettings);
}

export async function loadProfiles(): Promise<RuntimeProfile[]> {
  return ensureJsonFile<RuntimeProfile[]>("profiles.json", []);
}

export async function loadRuntimeState(): Promise<RuntimeState> {
  return ensureJsonFile<RuntimeState>("runtime-state.json", defaultRuntimeState);
}

export async function saveRuntimeState(state: RuntimeState): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "runtime-state.json"), `${JSON.stringify(state, null, jsonIndent)}\n`, "utf8");
}

export async function ensureStorageFiles(): Promise<void> {
  await Promise.all([
    ensureJsonFile<AppSettings>("settings.json", defaultSettings),
    ensureJsonFile<RuntimeProfile[]>("profiles.json", []),
    ensureJsonFile<RuntimeState>("runtime-state.json", defaultRuntimeState),
    ensureJsonFile<unknown[]>("jobs.json", [])
  ]);
}
