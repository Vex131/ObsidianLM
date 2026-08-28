import type { LlamaBuildFlagCapability, LlamaCppArgs, LlamaCppFlagOverride, LlamaCppProfile } from "@obsidianlm/shared";

export type CapabilityFlag = LlamaBuildFlagCapability;
export type FlagOverride = LlamaCppFlagOverride;
export type CuratedSection = "PROFILE" | "CONTEXT & CACHE" | "COMPUTE" | "PERFORMANCE" | "SERVER";

export type CuratedField = {
  key: keyof LlamaCppArgs;
  label: string;
  aliases: string[];
  kind: "text" | "boolean";
  section: CuratedSection;
  parent?: keyof LlamaCppArgs;
};

export type ProfileField = { key: "name"; label: string; section: "PROFILE" };
export const profileFields: ProfileField[] = [{ key: "name", label: "Name", section: "PROFILE" }];

export const curatedFields: CuratedField[] = [
  { key: "ctxSize", label: "Context size", aliases: ["--ctx-size", "-c"], kind: "text", section: "CONTEXT & CACHE" },
  { key: "cacheTypeK", label: "KV cache K", aliases: ["--cache-type-k", "-ctk"], kind: "text", section: "CONTEXT & CACHE" },
  { key: "cacheTypeV", label: "KV cache V", aliases: ["--cache-type-v", "-ctv"], kind: "text", section: "CONTEXT & CACHE" },
  { key: "flashAttention", label: "Flash attention", aliases: ["--flash-attn", "-fa"], kind: "boolean", section: "CONTEXT & CACHE" },
  { key: "gpuLayers", label: "GPU layers", aliases: ["--n-gpu-layers", "--gpu-layers", "-ngl"], kind: "text", section: "COMPUTE" },
  { key: "devices", label: "GPU devices", aliases: ["--device", "-dev"], kind: "text", section: "COMPUTE" },
  { key: "splitMode", label: "Split mode", aliases: ["--split-mode", "-sm"], kind: "text", section: "COMPUTE" },
  { key: "tensorSplit", label: "Tensor split", aliases: ["--tensor-split", "-ts"], kind: "text", section: "COMPUTE", parent: "splitMode" },
  { key: "batchSize", label: "Batch size", aliases: ["--batch-size", "-b"], kind: "text", section: "PERFORMANCE" },
  { key: "ubatchSize", label: "Micro batch", aliases: ["--ubatch-size", "-ub"], kind: "text", section: "PERFORMANCE" },
  { key: "parallel", label: "Parallel slots", aliases: ["--parallel", "-np"], kind: "text", section: "PERFORMANCE" },
  { key: "threads", label: "Threads", aliases: ["--threads", "-t"], kind: "text", section: "PERFORMANCE" },
  { key: "threadsBatch", label: "Batch threads", aliases: ["--threads-batch", "-tb"], kind: "text", section: "PERFORMANCE" },
  { key: "contBatching", label: "Continuous batching", aliases: ["--cont-batching"], kind: "boolean", section: "PERFORMANCE" },
  { key: "metrics", label: "Metrics endpoint", aliases: ["--metrics"], kind: "boolean", section: "SERVER" },
  { key: "webui", label: "Web UI", aliases: ["--webui"], kind: "boolean", section: "SERVER" }
];

const excluded = /(^--(?:help|version|list-devices|model|model-path|build-path|path)$)|(^--models-)|(^-(?:h|v)$)/;

export function capabilityFor(field: CuratedField, flags: CapabilityFlag[]): CapabilityFlag | undefined {
  return flags.find((flag) => [flag.canonicalName, ...flag.aliases].some((name) => field.aliases.includes(name)));
}

export function genericFlags(flags: CapabilityFlag[]): CapabilityFlag[] {
  return flags.filter((flag) => !flag.deprecated && !excluded.test(flag.canonicalName) && !curatedFields.some((field) => capabilityFor(field, [flag])));
}

export function supportsExplicitOff(flag: CapabilityFlag): boolean {
  return (flag.choices ?? []).some((choice) => /^(0|false|off|no|disabled)$/i.test(choice));
}

export function suggestedName(modelPath: string): string {
  return modelPath.split(/[\\/]/).pop()?.replace(/\.(gguf|bin)$/i, "") || "New profile";
}

export function unknownOverrides(overrides: FlagOverride[], flags: CapabilityFlag[]): FlagOverride[] {
  return overrides.filter((override) => !flags.some((flag) => [flag.canonicalName, ...flag.aliases].includes(override.flag)));
}

export function unsupportedArgs(profile: LlamaCppProfile, flags: CapabilityFlag[]): string[] {
  return curatedFields.filter((field) => profile.llamaArgs?.[field.key] !== undefined && !capabilityFor(field, flags)).map((field) => field.label);
}

export function draftChangeSummary(saved: LlamaCppProfile | null, draft: LlamaCppProfile): string[] {
  if (!saved) return ["New local draft"];
  const changes: string[] = [];
  for (const key of ["name", "modelPath", "buildPath", "host", "port"] as const) if (saved[key] !== draft[key]) changes.push(key === "modelPath" ? "model" : key === "buildPath" ? "build" : key);
  if (JSON.stringify(saved.llamaArgs ?? {}) !== JSON.stringify(draft.llamaArgs ?? {})) changes.push("curated options");
  if (JSON.stringify(saved.flagOverrides ?? []) !== JSON.stringify(draft.flagOverrides ?? [])) changes.push("build-specific overrides");
  if (JSON.stringify(saved.extraArgs ?? []) !== JSON.stringify(draft.extraArgs ?? [])) changes.push("raw arguments");
  return changes.length ? changes : ["No unsaved changes"];
}
