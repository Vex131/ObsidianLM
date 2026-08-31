import type { DiscoveredModel, GgufArtifactKind, GgufMetadataInspection } from "@obsidianlm/shared";

export type ModelTab = "models" | "projectors" | "other" | "all";
export type ModelSort = "name" | "size" | "modified";

const filenameKind = (model: DiscoveredModel): GgufArtifactKind => model.artifactKindGuess ?? "unknown";

export function effectiveKind(model: DiscoveredModel, inspection?: GgufMetadataInspection): GgufArtifactKind {
  return inspection?.artifactKindSource === "metadata" ? inspection.artifactKind : filenameKind(model);
}

export function typeLabel(model: DiscoveredModel, inspection?: GgufMetadataInspection): string {
  const kind = effectiveKind(model, inspection);
  return kind === "mmproj" ? "Projector" : kind === "imatrix" ? "Importance matrix" : kind === "unknown" ? "Unknown GGUF" : kind[0].toUpperCase() + kind.slice(1);
}

export function isPrimaryModel(model: DiscoveredModel, inspection?: GgufMetadataInspection): boolean {
  if (inspection?.status === "invalid") return false;
  return effectiveKind(model, inspection) === "model" || (effectiveKind(model, inspection) === "unknown" && !/(?:mmproj|projector|adapter|lora|imatrix)/i.test(model.path));
}

export function artifactSignature(model: DiscoveredModel): string { return `${model.sizeBytes}:${model.modifiedAt}`; }
export function formatBytes(bytes: number): string { return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GiB` : `${Math.max(0, Math.round(bytes / 1024 ** 2))} MiB`; }
export function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString(); }

export function matchesModel(model: DiscoveredModel, inspection: GgufMetadataInspection | undefined, query: string, tab: ModelTab, family: string, quant: string, usage: "all" | "used" | "unused", folder: string, usedIds: Set<string>): boolean {
  const kind = effectiveKind(model, inspection);
  const normalized = query.trim().toLowerCase();
  const haystack = [model.name, model.fileName, model.path, model.folder, model.familyGuess, model.quantizationGuess, inspection?.architecture, inspection?.displayName].filter(Boolean).join(" ").toLowerCase();
  if (normalized && !haystack.includes(normalized)) return false;
  if (tab === "models" && !isPrimaryModel(model, inspection)) return false;
  if (tab === "projectors" && kind !== "mmproj") return false;
  if (tab === "other" && !(kind === "adapter" || kind === "imatrix" || kind === "other")) return false;
  if (family !== "all" && inspection?.architecture !== family && (model.familyGuess ?? "Unknown") !== family) return false;
  if (quant !== "all" && (model.quantizationGuess ?? "Unknown") !== quant) return false;
  if (folder !== "all" && model.folder !== folder) return false;
  return usage === "all" || (usage === "used") === usedIds.has(model.id);
}

export function sortModels(models: DiscoveredModel[], sort: ModelSort): DiscoveredModel[] {
  return models.map((model, index) => ({ model, index })).sort((a, b) => {
    const comparison = sort === "size" ? b.model.sizeBytes - a.model.sizeBytes : sort === "modified" ? new Date(b.model.modifiedAt).getTime() - new Date(a.model.modifiedAt).getTime() : a.model.name.localeCompare(b.model.name);
    return comparison || a.index - b.index;
  }).map(({ model }) => model);
}

function tokens(model: DiscoveredModel): Set<string> { return new Set(model.fileName.toLowerCase().replace(/\.[^.]+$/, "").split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !/^(mmproj|f16|q\d|gguf)$/.test(token))); }
export function relatedArtifactCandidates(selected: DiscoveredModel, models: DiscoveredModel[], inspections: Map<string, GgufMetadataInspection>): Array<{ model: DiscoveredModel; reason: string }> {
  const selectedKind = effectiveKind(selected, inspections.get(selected.id));
  const selectedTokens = tokens(selected);
  return models.filter((candidate) => candidate.id !== selected.id && candidate.folder === selected.folder).flatMap((candidate) => {
    const candidateKind = effectiveKind(candidate, inspections.get(candidate.id));
    if (!((selectedKind === "model" && candidateKind === "mmproj") || (selectedKind === "mmproj" && candidateKind === "model"))) return [];
    const overlap = [...tokens(candidate)].filter((token) => selectedTokens.has(token));
    return overlap.length ? [{ model: candidate, reason: `Same folder; shared name token${overlap.length > 1 ? "s" : ""}: ${overlap.join(", ")}` }] : [];
  });
}
