import type { LlamaBuildCapabilitiesManifest } from "./discovery.js";
import type { LlamaCppBuild } from "./llama-build.js";
import type { ConfiguredModel, ConfiguredModelId, ModelArtifact } from "./model-configuration.js";
import type { RouterLaunchPreview, RouterPresetPreview, RouterRuntimeState } from "./router.js";
import type { RuntimeState, RuntimeWarning } from "./runtime-state.js";

export interface ModelArtifactListItem extends ModelArtifact {
  configuredModelIds: ConfiguredModelId[];
}

export interface ModelArtifactListResponse {
  revision: string;
  artifacts: ModelArtifactListItem[];
}

export interface ModelArtifactDetailResponse {
  revision: string;
  artifact: ModelArtifactListItem;
}

export interface ConfiguredModelDetails extends Omit<ConfiguredModel, "projector"> {
  artifact?: ModelArtifact;
  build?: LlamaCppBuild;
  projector?: ModelArtifact;
  projectorAssociation?: ConfiguredModel["projector"];
  validation: {
    structural: boolean;
    references: ConfiguredModel["referenceStatus"];
    status: ConfiguredModel["validationStatus"];
    managedInferenceEligibility?: LlamaCppBuild["managedInferenceEligibility"];
  };
  compatibilityProfileIds?: string[];
}

export interface ConfiguredModelListResponse {
  revision: string;
  configuredModels: ConfiguredModelDetails[];
}

export interface ConfiguredModelDetailResponse {
  revision: string;
  model: ConfiguredModelDetails;
}

export type ConfiguredModelDraft = Omit<ConfiguredModel, "schemaVersion" | "id" | "referenceStatus" | "validationStatus" | "routerAlias"> & { routerAlias?: string };

export interface ConfiguredModelDraftPreviewRequest {
  draft: ConfiguredModelDraft;
  existingId?: ConfiguredModelId;
}

export interface ConfiguredModelDraftPreviewResponse {
  preset: RouterPresetPreview;
  launch: RouterLaunchPreview;
}

export interface LlamaCppBuildDetails extends LlamaCppBuild {
  validationInProgress: boolean;
  configuredModelIds: ConfiguredModelId[];
}

export interface LlamaCppBuildListResponse {
  revision: string;
  builds: LlamaCppBuildDetails[];
}

export interface LlamaCppBuildDetailResponse {
  revision: string;
  build: LlamaCppBuildDetails;
}

export interface LlamaCppBuildCapabilitiesResponse extends LlamaBuildCapabilitiesManifest {}

export interface RouterRuntimeResponse {
  state: RuntimeState;
  routerState: RouterRuntimeState;
  warnings: RuntimeWarning[];
}
