import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { DiscoveredModel, DiscoveryWarning, ModelDiscoveryResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { stableId } from "./helpers.js";

const maxDepth = 8;
const maxResults = 1000;

function guessQuantization(fileName: string): string | undefined {
  return fileName.match(/\b(Q[0-9]_[A-Z0-9_]+|IQ[0-9]_[A-Z0-9_]+)\b/iu)?.[1]?.toUpperCase();
}

function guessFamily(fileName: string): string | undefined {
  const normalized = fileName.toLowerCase();
  for (const family of ["qwen", "llama", "mistral", "mixtral", "gemma", "phi", "deepseek", "yi"]) {
    if (normalized.includes(family)) {
      return family;
    }
  }

  return undefined;
}

async function scanFolder(folder: string, currentPath: string, depth: number, detectedAt: string, models: DiscoveredModel[], warnings: DiscoveryWarning[]): Promise<void> {
  if (models.length >= maxResults) {
    return;
  }

  if (depth > maxDepth) {
    warnings.push({
      code: "max_depth_reached",
      message: `Stopped scanning below ${currentPath}; maximum discovery depth is ${maxDepth}.`,
      folder,
      path: currentPath
    });
    return;
  }

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
    if (models.length >= maxResults) {
      warnings.push({
        code: "max_results_reached",
        message: `Stopped model discovery after ${maxResults} GGUF files.`,
        folder
      });
      return;
    }

    const entryPath = path.join(currentPath, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await scanFolder(folder, entryPath, depth + 1, detectedAt, models, warnings);
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".gguf") {
      continue;
    }

    let stats;
    try {
      stats = await lstat(entryPath);
    } catch (error) {
      warnings.push({
        code: "file_unreadable",
        message: `Could not read model file metadata for ${entryPath}: ${error instanceof Error ? error.message : "unknown error"}`,
        folder,
        path: entryPath
      });
      continue;
    }
    const modelName = path.basename(entry.name, path.extname(entry.name));
    models.push({
      id: stableId(entryPath),
      name: modelName,
      fileName: entry.name,
      path: entryPath,
      folder,
      extension: path.extname(entry.name),
      sizeBytes: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      detectedAt,
      quantizationGuess: guessQuantization(entry.name),
      familyGuess: guessFamily(entry.name)
    });
  }
}

export async function discoverModels(): Promise<ModelDiscoveryResponse> {
  const settings = await loadSettings();
  const detectedAt = new Date().toISOString();
  const warnings: DiscoveryWarning[] = [];
  const models: DiscoveredModel[] = [];

  for (const folder of settings.modelFolders) {
    let stats;
    try {
      stats = await lstat(folder);
    } catch {
      warnings.push({ code: "folder_missing", message: `Configured model folder does not exist: ${folder}`, folder });
      continue;
    }

    if (stats.isSymbolicLink()) {
      warnings.push({ code: "folder_symlink_skipped", message: `Configured model folder is a symlink and was skipped: ${folder}`, folder });
      continue;
    }

    if (!stats.isDirectory()) {
      warnings.push({ code: "folder_not_directory", message: `Configured model path is not a directory: ${folder}`, folder });
      continue;
    }

    await scanFolder(folder, folder, 0, detectedAt, models, warnings);
  }

  models.sort((a, b) => a.path.localeCompare(b.path));

  return {
    models,
    warnings,
    scannedFolders: settings.modelFolders,
    detectedAt
  };
}
