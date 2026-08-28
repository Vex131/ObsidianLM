import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredLlamaCppToolKind, DiscoveryWarning, LlamaBuildDiscoveryResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { friendlyNameFromFolder, stableId } from "./helpers.js";

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

function buildName(discoveryRoot: string, folder: string): { name: string; buildRootHint: string } {
  const relativeFolder = path.relative(discoveryRoot, folder);
  const segments = relativeFolder.split(path.sep).filter(Boolean);
  const generic = new Set(["bin", "build", "release", "debug", "out", "dist", "install", "x64", "x86", "arm64"]);
  const meaningful = segments.find((segment) => !generic.has(segment.toLowerCase()));
  const hint = meaningful ? path.join(discoveryRoot, meaningful) : discoveryRoot;
  return {
    name: friendlyNameFromFolder(meaningful ?? path.basename(discoveryRoot)),
    buildRootHint: hint
  };
}

async function scanBuildFolder(folder: string, currentPath: string, depth: number, state: { visitedDirectories: number; maxVisitedWarning: boolean }, buildMap: Map<string, { discoveryRoot: string; tools: DiscoveredLlamaCppTool[] }>, warnings: DiscoveryWarning[]): Promise<void> {
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
      await scanBuildFolder(folder, entryPath, depth + 1, state, buildMap, warnings);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const kind = knownTools[entry.name.toLowerCase()];
    if (!kind) {
      continue;
    }

    const build = buildMap.get(currentPath) ?? { discoveryRoot: folder, tools: [] };
    build.tools.push({ kind, fileName: entry.name, path: entryPath, exists: true });
    buildMap.set(currentPath, build);
  }
}

export async function discoverLlamaBuilds(settingsOverride?: AppSettings): Promise<LlamaBuildDiscoveryResponse> {
  const settings = settingsOverride ?? (await loadSettings());
  const detectedAt = new Date().toISOString();
  const warnings: DiscoveryWarning[] = [];
  const buildMap = new Map<string, { discoveryRoot: string; tools: DiscoveredLlamaCppTool[] }>();
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

    await scanBuildFolder(folder, folder, 0, scanState, buildMap, warnings);
  }

  const builds: DiscoveredLlamaCppBuild[] = [];
  for (const [folder, build] of buildMap) {
    const sortedTools = build.tools.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
    for (const server of sortedTools.filter((tool) => tool.kind === "server")) {
      if (builds.length >= maxLlamaBuildResults) {
        if (!warnings.some((warning) => warning.code === "max_build_results_reached")) warnings.push({ code: "max_build_results_reached", message: `Stopped llama.cpp discovery after ${maxLlamaBuildResults} builds.` });
        break;
      }
      const metadata = buildName(build.discoveryRoot, path.dirname(server.path));
      const associatedTools = [server, ...sortedTools.filter((tool) => tool.kind !== "server")]
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
      builds.push({
        id: stableId(server.path),
        name: metadata.name,
        folder,
        serverPath: server.path,
        tools: associatedTools,
        detectedAt,
        discoveryRoot: build.discoveryRoot,
        buildRootHint: metadata.buildRootHint,
        relativeServerPath: path.relative(build.discoveryRoot, server.path)
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
