import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredLlamaCppToolKind, DiscoveryWarning, LlamaBuildDiscoveryResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { normalizePathForCompare, stableId } from "./helpers.js";

export const maxLlamaBuildDiscoveryDepth = 6;
export const maxLlamaBuildVisitedDirectories = 2_000;
export const maxLlamaBuildResults = 200;

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

async function scanBuildFolder(folder: string, currentPath: string, depth: number, state: { visitedDirectories: number; maxVisitedWarning: boolean }, tools: DiscoveredLlamaCppTool[], warnings: DiscoveryWarning[]): Promise<void> {
  if (state.visitedDirectories >= maxLlamaBuildVisitedDirectories) {
    if (!state.maxVisitedWarning) {
      warnings.push({ code: "max_visited_directories_reached", message: `Stopped llama.cpp discovery after visiting ${maxLlamaBuildVisitedDirectories} directories.`, folder, path: currentPath });
      state.maxVisitedWarning = true;
    }
    return;
  }
  state.visitedDirectories += 1;
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

    if (entry.isDirectory()) {
      if (depth >= maxLlamaBuildDiscoveryDepth) {
        warnings.push({ code: "max_depth_reached", message: `Stopped scanning below ${entryPath}; maximum discovery depth is ${maxLlamaBuildDiscoveryDepth}.`, folder, path: entryPath });
        continue;
      }
      try {
        const stats = await lstat(entryPath);
        if (stats.isSymbolicLink() || !stats.isDirectory()) continue;
      } catch (error) {
        warnings.push({ code: "folder_unreadable", message: `Could not read ${entryPath}: ${error instanceof Error ? error.message : "unknown error"}`, folder, path: entryPath });
        continue;
      }
      await scanBuildFolder(folder, entryPath, depth + 1, state, tools, warnings);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const kind = knownTools[entry.name.toLowerCase()];
    if (!kind) {
      continue;
    }

    tools.push({ kind, fileName: entry.name, path: entryPath, exists: true });
  }
}

function serverPriority(candidate: string, tool: DiscoveredLlamaCppTool): [number, number, string] {
  const relative = path.relative(candidate, tool.path);
  const location = relative === tool.fileName ? 0 : path.dirname(relative).toLowerCase() === "bin" ? 1 : 2;
  return [location, tool.fileName.toLowerCase().endsWith(".exe") ? 0 : 1, normalizePathForCompare(tool.path)];
}

function comparePriority(left: [number, number, string], right: [number, number, string]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
}

async function candidatesForRoot(root: string, warnings: DiscoveryWarning[]): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch (error) {
    warnings.push({ code: "folder_unreadable", message: `Could not read ${root}: ${error instanceof Error ? error.message : "unknown error"}`, folder: root, path: root });
    return [];
  }
}

export async function discoverLlamaBuilds(settingsOverride?: AppSettings): Promise<LlamaBuildDiscoveryResponse> {
  const settings = settingsOverride ?? (await loadSettings());
  const detectedAt = new Date().toISOString();
  const warnings: DiscoveryWarning[] = [];
  const builds: DiscoveredLlamaCppBuild[] = [];
  const scanState = { visitedDirectories: 0, maxVisitedWarning: false };

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

    for (const candidate of await candidatesForRoot(folder, warnings)) {
      const tools: DiscoveredLlamaCppTool[] = [];
      await scanBuildFolder(candidate, candidate, 0, scanState, tools, warnings);
      const sortedTools = tools.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
      const servers = sortedTools.filter((tool) => tool.kind === "server").sort((a, b) => comparePriority(serverPriority(candidate, a), serverPriority(candidate, b)));
      const server = servers[0];
      if (builds.length >= maxLlamaBuildResults) {
        if (!warnings.some((warning) => warning.code === "max_build_results_reached")) warnings.push({ code: "max_build_results_reached", message: `Stopped llama.cpp discovery after ${maxLlamaBuildResults} builds.` });
        break;
      }
      builds.push({
        id: stableId(normalizePathForCompare(candidate)),
        name: path.basename(candidate),
        folder: candidate,
        ...(server ? { serverPath: server.path, ...(servers.length > 1 ? { warnings: [`Multiple llama-server executables were found; using ${path.relative(candidate, server.path)}.`] } : {}) } : { serverPath: "", status: "missing", warnings: ["llama-server.exe not found (possibly broken build)."] }),
        tools: server ? [server, ...sortedTools.filter((tool) => tool !== server && tool.kind !== "server")] : sortedTools,
        detectedAt,
        discoveryRoot: folder,
        buildRootHint: candidate,
        ...(server ? { relativeServerPath: path.relative(candidate, server.path) } : {})
      });
    }
  }

  builds.sort((a, b) => a.folder.localeCompare(b.folder));

  return {
    builds,
    warnings,
    scannedFolders: settings.llamaCppFolders,
    detectedAt
  };
}
