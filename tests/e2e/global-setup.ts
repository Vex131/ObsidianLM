import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultSettings } from "@obsidianlm/shared";

export default async function globalSetup(): Promise<void> {
  const tempRoot = path.resolve(".tmp");
  const dataDir = path.join(tempRoot, "e2e-data");
  const logsDir = path.join(tempRoot, "e2e-logs");
  const discoveryDir = path.join(tempRoot, "e2e-discovery");
  const buildRoot = path.join(discoveryDir, "builds");
  await rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await rm(logsDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await rm(discoveryDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
    mkdir(path.join(buildRoot, "valid-build"), { recursive: true }),
    mkdir(path.join(buildRoot, "broken-build"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(buildRoot, "valid-build", "llama-server.exe"), "fixture server"),
    writeFile(path.join(buildRoot, "broken-build", "llama-cli.exe"), "fixture cli"),
    writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ ...defaultSettings, llamaCppFolders: [buildRoot] })),
  ]);
}
