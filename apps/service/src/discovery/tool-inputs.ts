import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { AppSettings, DiscoveredToolInputFile, DiscoveryWarning, ToolInputDiscoveryResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { stableId } from "./helpers.js";

const maxDepth = 8;
const maxResults = 1000;
const supportedExtensions = new Set([".txt", ".raw", ".jsonl", ".md"] as const);

type SupportedToolInputExtension = DiscoveredToolInputFile["extension"];

function isSupportedExtension(extension: string): extension is SupportedToolInputExtension {
  return supportedExtensions.has(extension as SupportedToolInputExtension);
}

async function scanFolder(folder: string, currentPath: string, depth: number, detectedAt: string, files: DiscoveredToolInputFile[], warnings: DiscoveryWarning[]): Promise<void> {
  if (files.length >= maxResults) {
    return;
  }

  if (depth > maxDepth) {
    warnings.push({ code: "max_depth_reached", message: `Stopped scanning below ${currentPath}; maximum tool input discovery depth is ${maxDepth}.`, folder, path: currentPath });
    return;
  }

  let entries;
  try {
    entries = await readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    warnings.push({ code: "folder_unreadable", message: `Could not read ${currentPath}: ${error instanceof Error ? error.message : "unknown error"}`, folder, path: currentPath });
    return;
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.length >= maxResults) {
      warnings.push({ code: "max_results_reached", message: `Stopped tool input discovery after ${maxResults} files.`, folder });
      return;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await scanFolder(folder, entryPath, depth + 1, detectedAt, files, warnings);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || !isSupportedExtension(extension)) {
      continue;
    }

    let stats;
    try {
      stats = await lstat(entryPath);
    } catch (error) {
      warnings.push({ code: "file_unreadable", message: `Could not read tool input metadata for ${entryPath}: ${error instanceof Error ? error.message : "unknown error"}`, folder, path: entryPath });
      continue;
    }

    if (stats.isSymbolicLink()) {
      continue;
    }

    files.push({
      id: stableId(entryPath),
      name: path.basename(entry.name, path.extname(entry.name)),
      fileName: entry.name,
      path: entryPath,
      folder,
      extension,
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      detectedAt
    });
  }
}

export async function discoverToolInputs(settingsOverride?: AppSettings): Promise<ToolInputDiscoveryResponse> {
  const settings = settingsOverride ?? (await loadSettings());
  const detectedAt = new Date().toISOString();
  const warnings: DiscoveryWarning[] = [];
  const files: DiscoveredToolInputFile[] = [];

  for (const folder of settings.toolInputFolders) {
    let stats;
    try {
      stats = await lstat(folder);
    } catch {
      warnings.push({ code: "folder_missing", message: `Configured tool input folder does not exist: ${folder}`, folder });
      continue;
    }

    if (stats.isSymbolicLink()) {
      warnings.push({ code: "folder_symlink_skipped", message: `Configured tool input folder is a symlink and was skipped: ${folder}`, folder });
      continue;
    }

    if (!stats.isDirectory()) {
      warnings.push({ code: "folder_not_directory", message: `Configured tool input path is not a directory: ${folder}`, folder });
      continue;
    }

    await scanFolder(folder, folder, 0, detectedAt, files, warnings);
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  return { files, warnings, scannedFolders: settings.toolInputFolders, detectedAt };
}
