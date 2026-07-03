import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

export default async function globalSetup(): Promise<void> {
  const tempRoot = path.resolve(".tmp");
  const dataDir = path.join(tempRoot, "e2e-data");
  const logsDir = path.join(tempRoot, "e2e-logs");
  await rm(dataDir, { recursive: true, force: true });
  await rm(logsDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
}
