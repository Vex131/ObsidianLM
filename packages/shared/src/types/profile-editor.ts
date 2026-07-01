import type { CommandSpec, LlamaCppProfile, RuntimeProfile } from "./runtime-state.js";

export interface ProfileValidationResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ProfileListResponse {
  profiles: RuntimeProfile[];
}

export interface ProfileDetailResponse {
  profile: RuntimeProfile;
}

export type CreateProfileRequest = Partial<LlamaCppProfile> & Pick<LlamaCppProfile, "name" | "buildPath" | "modelPath">;

export type UpdateProfileRequest = Partial<Omit<LlamaCppProfile, "id">>;

export interface DuplicateProfileRequest {
  id?: string;
  name?: string;
}

export interface ProfileMutationResponse {
  profile: RuntimeProfile;
  validation: ProfileValidationResponse;
  command?: CommandSpec;
  warnings?: string[];
}

export interface DeleteProfileResponse {
  deletedProfileId: string;
}

export interface ImportProfilesRequest {
  profiles?: RuntimeProfile[];
  rejectConflicts?: boolean;
}

export interface ImportProfilesResponse {
  imported: number;
  skipped: number;
  errors: string[];
  createdProfileIds: string[];
  updatedProfileIds: string[];
}

export interface ExportProfilesResponse {
  exportVersion: 1;
  exportedAt: string;
  profiles: RuntimeProfile[];
}

export interface ProfileConfigSnippetResponse {
  command: CommandSpec;
  endpoint: string;
  opencodeStarterSnippet: string;
  illustriaStarterSnippet: string;
}

export interface ProfileEditorPreset {
  id: string;
  name: string;
  description: string;
  llamaArgs: LlamaCppProfile["llamaArgs"];
}

export interface ProfileEditorDefaults {
  host: string;
  port: number;
  runtimeType: LlamaCppProfile["runtimeType"];
  providerKind: LlamaCppProfile["providerKind"];
  llamaArgs: NonNullable<LlamaCppProfile["llamaArgs"]>;
  extraArgs: string[];
}
