import path from "node:path";
import { createHash } from "node:crypto";

export function stableId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function friendlyNameFromFolder(folder: string): string {
  const baseName = path.basename(folder).trim() || folder;
  return baseName
    .replace(/[._-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeFolderList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const folders: string[] = [];

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const folder = item.trim();
    if (!folder || seen.has(folder)) {
      continue;
    }

    seen.add(folder);
    folders.push(folder);
  }

  return folders;
}

export function slugifyProfileId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);

  return slug || "discovered-profile";
}
