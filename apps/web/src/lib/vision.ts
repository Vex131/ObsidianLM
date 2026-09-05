import type { ModelArtifactListItem } from "@obsidianlm/shared";

export type VisionCapability = ModelArtifactListItem["vision"]["capability"];
export type VisionModule = ModelArtifactListItem["vision"]["module"];

/** Base-model capability label — never derived from projector presence. */
export function visionCapabilityKind(capability: VisionCapability | undefined): "Vision" | "Text" | "Unknown" {
  if (capability === "yes") return "Vision";
  if (capability === "no") return "Text";
  return "Unknown";
}

export function visionCapabilityYesNo(capability: VisionCapability | undefined): "Yes" | "No" | "Unknown" {
  if (capability === "yes") return "Yes";
  if (capability === "no") return "No";
  return "Unknown";
}

export function visionModuleLabel(module: VisionModule | undefined): string {
  return ({ installed: "Installed", not_found: "Not found", not_required: "Not required", unknown: "Unknown" } as const)[module ?? "unknown"];
}

/** Compact mode line for Runtime/Dashboard: capability first, optional projector association. */
export function visionModeSummary(
  capability: VisionCapability | undefined,
  projectorLocator?: string | null,
): string {
  const kind = visionCapabilityKind(capability);
  return projectorLocator ? `${kind} · explicit projector ${projectorLocator}` : kind;
}
