import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredLlamaCppToolKind, DiscoveryWarning, LlamaBuildDiscoveryResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { friendlyNameFromFolder, stableId } from "./helpers.js";

const knownTools: Record<string, DiscoveredLlamaCppToolKind> = {
  "llama-server.exe": "server",
  "llama-server": "server",
  "llama-cli.exe": "cli",
  "llama-cli": "cli",
  "llama-bench.exe": "bench",
  "llama-bench": "bench",
  "llama-perplexity.exe": "perplexity",
  "llama-perplexity": "perplexity"
};

async function scanBuildFolder(folder: string, currentPath: string, depth: number, detectedAt: string, buildMap: Map<string, DiscoveredLlamaCppTool[]>, warnings: DiscoveryWarning[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    warnings.push({
      code: "folder_unreadable",
      message: `Could not read ${currentPath}: ${error instanceof Error ? error.message : "unknown error"}`,
      folder,
      path: currentPath
    });
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory() && depth < 1) {
      await scanBuildFolder(folder, entryPath, depth + 1, detectedAt, buildMap, warnings);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const kind = knownTools[entry.name.toLowerCase()];
    if (!kind) {
      continue;
    }

    const tools = buildMap.get(currentPath) ?? [];
    tools.push({ kind, fileName: entry.name, path: entryPath, exists: true });
    buildMap.set(currentPath, tools);
  }
}

export async function discoverLlamaBuilds(): Promise<LlamaBuildDiscoveryResponse> {
  const settings = await loadSettings();
  const detectedAt = new Date().toISOString();
  const warnings: DiscoveryWarning[] = [];
  const buildMap = new Map<string, DiscoveredLlamaCppTool[]>();

  for (const folder of settings.llamaCppFolders) {
    let stats;
    try {
      stats = await lstat(folder);
    } catch {
      warnings.push({ code: "folder_missing", message: `Configured llama.cpp folder does not exist: ${folder}`, folder });
      continue;
    }

    if (stats.isSymbolicLink()) {
      warnings.push({ code: "folder_symlink_skipped", message: `Configured llama.cpp folder is a symlink and was skipped: ${folder}`, folder });
      continue;
    }

    if (!stats.isDirectory()) {
      warnings.push({ code: "folder_not_directory", message: `Configured llama.cpp path is not a directory: ${folder}`, folder });
      continue;
    }

    await scanBuildFolder(folder, folder, 0, detectedAt, buildMap, warnings);
  }

  const builds: DiscoveredLlamaCppBuild[] = [];
  for (const [folder, tools] of buildMap) {
    const sortedTools = tools.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
    const server = sortedTools.find((tool) => tool.kind === "server");
    if (!server) {
      continue;
    }

    builds.push({
      id: stableId(server.path),
      name: friendlyNameFromFolder(folder),
      folder,
      serverPath: server.path,
      tools: sortedTools,
      detectedAt
    });
  }

  builds.sort((a, b) => a.folder.localeCompare(b.folder));

  return {
    builds,
    warnings,
    scannedFolders: settings.llamaCppFolders,
    detectedAt
  };
}
