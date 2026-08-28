import type { LlamaCppBuildId, ConfiguredModelId, ModelArtifactId } from "./model-configuration.js";
import type { LlamaCppProfile } from "./runtime-state.js";

export const LEGACY_PROFILE_SOURCE_VERSION = 1 as const;
export const PHASE15_DOMAIN_TARGET_VERSION = 1 as const;

export type ProfileMigrationStatus = "not_started" | "in_progress" | "completed" | "failed" | "interrupted" | "already_migrated";

export interface MigrationBackupReference {
  resource: string;
  createdAt?: string;
  checksum?: string;
  verified: boolean;
}

export interface LegacyProfileMigrationInput {
  sourceVersion: typeof LEGACY_PROFILE_SOURCE_VERSION;
  profiles: LlamaCppProfile[];
  sourceRevision?: string;
  priorMigration?: ProfileMigrationRecord;
}

export interface LegacyProfileMapping {
  legacyProfileId: string;
  configuredModelId: ConfiguredModelId;
  artifactId: ModelArtifactId;
  buildId: LlamaCppBuildId;
  legacyRuntimeEndpoint: {
    host: string;
    port: number;
  };
  preservedFields: Array<"llamaArgs" | "flagOverrides" | "extraArgs">;
  warnings: string[];
  errors: string[];
}

export interface ProfileMigrationRecord {
  migrationId: string;
  sourceVersion: typeof LEGACY_PROFILE_SOURCE_VERSION;
  targetVersion: typeof PHASE15_DOMAIN_TARGET_VERSION;
  sourceRevision?: string;
  status: ProfileMigrationStatus;
  startedAt?: string;
  completedAt?: string;
  backup?: MigrationBackupReference;
  mappings: LegacyProfileMapping[];
  migratedConfiguredModelIds: ConfiguredModelId[];
  migratedBuildIds: LlamaCppBuildId[];
  invalidReferences: Array<{
    legacyProfileId: string;
    kind: "model" | "build" | "projector";
    reference: string;
    reason: string;
  }>;
  warnings: string[];
  errors: string[];
  recoverable: boolean;
}

export interface LegacyProfileMigrationOutput {
  targetVersion: typeof PHASE15_DOMAIN_TARGET_VERSION;
  record: ProfileMigrationRecord;
}
