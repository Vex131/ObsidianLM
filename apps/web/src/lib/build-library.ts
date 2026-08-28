import type { DiscoveredLlamaCppBuild, LlamaBuildCapabilitiesManifest } from "@obsidianlm/shared";

export type BuildSort = "name" | "version" | "inspected" | "usage";

export function originLabel(manifest?: LlamaBuildCapabilitiesManifest): string {
  if (!manifest || manifest.origin.classification === "unknown") return "Unknown";
  return manifest.origin.classification === "official" ? "Official hint" : "Custom hint";
}

export function routerLabel(manifest?: LlamaBuildCapabilitiesManifest): string {
  if (!manifest || manifest.router.status === "unknown") return "Unknown";
  if (manifest.router.status === "candidate") return "Static candidate";
  if (manifest.router.status === "unsupported") return "Legacy candidate";
  return "Partial";
}

export function versionLabel(manifest?: LlamaBuildCapabilitiesManifest): string {
  const version = manifest?.versionInfo;
  if (version?.buildNumber !== undefined) return `b${version.buildNumber}`;
  if (version?.major !== undefined && version.minor !== undefined) return `v${version.major}.${version.minor}${version.patch === undefined ? "" : `.${version.patch}`}`;
  return manifest?.versionText?.split(/\r?\n/u)[0]?.slice(0, 48) || "Not inspected";
}

export function capabilityFamilies(manifest: LlamaBuildCapabilitiesManifest): string[] {
  const names = manifest.flags.flatMap((flag) => [flag.canonicalName, ...flag.aliases]).join(" ");
  const groups: Array<[string, RegExp]> = [
    ["GPU offload", /gpu-layers|device/iu], ["Multi-GPU", /split-mode|tensor-split/iu], ["Flash Attention", /flash-attn/iu],
    ["Vision / mmproj", /mmproj|vision/iu], ["Speculative / MTP", /draft|speculative|mtp/iu], ["Reasoning", /reasoning/iu],
    ["MoE", /expert|moe/iu], ["Embeddings / reranking", /embedding|rerank/iu], ["Router", /models-preset|models-max|models-autoload/iu],
    ["Metrics / Web UI", /metrics|webui/iu]
  ];
  return groups.filter(([, pattern]) => pattern.test(names)).map(([label]) => label);
}

export function matchesBuild(build: DiscoveredLlamaCppBuild, manifest: LlamaBuildCapabilitiesManifest | undefined, query: string): boolean {
  const text = [build.name, build.folder, build.serverPath, build.relativeServerPath, ...build.tools.flatMap((tool) => [tool.kind, tool.fileName, tool.path]), manifest?.versionText, ...(manifest?.backendHints ?? []), ...(manifest?.devices.flatMap((device) => [device.id, device.label]) ?? []), originLabel(manifest), routerLabel(manifest)].filter(Boolean).join(" ").toLowerCase();
  return text.includes(query.trim().toLowerCase());
}

export function sortBuilds(builds: DiscoveredLlamaCppBuild[], manifests: Map<string, LlamaBuildCapabilitiesManifest>, usage: Map<string, string[]>, sort: BuildSort): DiscoveredLlamaCppBuild[] {
  return [...builds].sort((a, b) => {
    if (sort === "usage") return (usage.get(b.id)?.length ?? 0) - (usage.get(a.id)?.length ?? 0) || a.name.localeCompare(b.name);
    if (sort === "inspected") return (manifests.get(b.id)?.inspectedAt ?? "").localeCompare(manifests.get(a.id)?.inspectedAt ?? "") || a.name.localeCompare(b.name);
    if (sort === "version") return (manifests.get(b.id)?.versionInfo?.buildNumber ?? -1) - (manifests.get(a.id)?.versionInfo?.buildNumber ?? -1) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name) || a.serverPath.localeCompare(b.serverPath);
  });
}
