import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(currentDir, "..", "..", "..", "..");

export const dataDir = process.env.OBSIDIANLM_DATA_DIR
  ? path.resolve(process.env.OBSIDIANLM_DATA_DIR)
  : path.resolve(workspaceRoot, "data");

export const webDistDir = path.resolve(workspaceRoot, "apps", "web", "dist");
