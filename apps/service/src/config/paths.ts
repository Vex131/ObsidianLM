import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..", "..", "..", "..");
const programDataRoot = process.platform === "win32" ? process.env.ProgramData ?? "C:\\ProgramData" : path.resolve(workspaceRoot, ".programdata");

export type PathMode = "project" | "programData" | "custom";

export interface ResolvedAppPaths {
  serviceMode: boolean;
  dataDir: string;
  dataDirMode: PathMode;
  logsDir: string;
  logDirMode: PathMode;
  runtimeLogsDir: string;
  jobLogsDir: string;
  serviceLogsDir: string;
}

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export function isServiceMode(): boolean {
  return isTruthyEnv(process.env.OBSIDIANLM_SERVICE_MODE);
}

function resolveDataDir(serviceMode: boolean): { dir: string; mode: PathMode } {
  if (process.env.OBSIDIANLM_DATA_DIR) {
    return { dir: path.resolve(process.env.OBSIDIANLM_DATA_DIR), mode: "custom" };
  }

  if (serviceMode) {
    return { dir: path.resolve(programDataRoot, "ObsidianLM", "data"), mode: "programData" };
  }

  return { dir: path.resolve(workspaceRoot, "data"), mode: "project" };
}

function resolveLogsDir(serviceMode: boolean): { dir: string; mode: PathMode } {
  const logDirOverride = process.env.OBSIDIANLM_LOG_DIR ?? process.env.OBSIDIANLM_LOGS_DIR;
  if (logDirOverride) {
    return { dir: path.resolve(logDirOverride), mode: "custom" };
  }

  if (serviceMode) {
    return { dir: path.resolve(programDataRoot, "ObsidianLM", "logs"), mode: "programData" };
  }

  return { dir: path.resolve(workspaceRoot, "logs"), mode: "project" };
}

export function getAppPaths(): ResolvedAppPaths {
  const serviceMode = isServiceMode();
  const data = resolveDataDir(serviceMode);
  const logs = resolveLogsDir(serviceMode);

  return {
    serviceMode,
    dataDir: data.dir,
    dataDirMode: data.mode,
    logsDir: logs.dir,
    logDirMode: logs.mode,
    runtimeLogsDir: path.resolve(logs.dir, "runtimes"),
    jobLogsDir: path.resolve(logs.dir, "jobs"),
    serviceLogsDir: path.resolve(logs.dir, "service")
  };
}

export function getDataDir(): string {
  return getAppPaths().dataDir;
}

export function getLogsDir(): string {
  return getAppPaths().logsDir;
}

export function getRuntimeLogsDir(): string {
  return getAppPaths().runtimeLogsDir;
}

export function getJobLogsDir(): string {
  return getAppPaths().jobLogsDir;
}

export function getServiceLogsDir(): string {
  return getAppPaths().serviceLogsDir;
}

export async function ensureAppDirectories(): Promise<void> {
  const paths = getAppPaths();
  await Promise.all([
    mkdir(paths.dataDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.runtimeLogsDir, { recursive: true }),
    mkdir(paths.jobLogsDir, { recursive: true }),
    mkdir(paths.serviceLogsDir, { recursive: true })
  ]);
}

export const dataDir = getDataDir();

export const logsDir = getLogsDir();

export const runtimeLogsDir = getRuntimeLogsDir();

export const webDistDir = path.resolve(workspaceRoot, "apps", "web", "dist");

export const appRootDir = workspaceRoot;
