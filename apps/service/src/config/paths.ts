import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..", "..", "..", "..");

export const dataDir = process.env.OBSIDIANLM_DATA_DIR
  ? path.resolve(process.env.OBSIDIANLM_DATA_DIR)
  : path.resolve(workspaceRoot, "data");

export const logsDir = process.env.OBSIDIANLM_LOGS_DIR
  ? path.resolve(process.env.OBSIDIANLM_LOGS_DIR)
  : path.resolve(workspaceRoot, "logs");

export const runtimeLogsDir = path.resolve(logsDir, "runtimes");

export const webDistDir = path.resolve(workspaceRoot, "apps", "web", "dist");
