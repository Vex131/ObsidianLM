import {
  LEGACY_PROFILE_SOURCE_VERSION,
  PHASE15_DOMAIN_TARGET_VERSION,
  createConfiguredModelId,
  createLlamaCppBuildId,
  createModelArtifactId,
  createRouterAlias,
  type ConfiguredModel,
  type LlamaCppProfile,
  type ProfileMigrationRecord
} from "@obsidianlm/shared";

const profile = (id: string, name: string, modelPath: string, buildPath: string, overrides: Partial<LlamaCppProfile> = {}): LlamaCppProfile => ({
  id,
  name,
  runtimeType: "llama.cpp",
  providerKind: "server",
  modelPath,
  buildPath,
  host: "0.0.0.0",
  port: 8085,
  ...overrides
});

export const phase15LegacyProfiles = [
  profile("normal", "Normal", "/fixtures/models/normal.gguf", "/fixtures/builds/official/llama-server", {
    llamaArgs: { ctxSize: 8192, gpuLayers: "all" }
  }),
  profile("duplicate-a", "Duplicate config", "/fixtures/models/shared.gguf", "/fixtures/builds/official/llama-server", {
    llamaArgs: { ctxSize: 4096 }
  }),
  profile("duplicate-b", "Duplicate config", "/fixtures/models/shared.gguf", "/fixtures/builds/official/llama-server", {
    llamaArgs: { ctxSize: 16384, tensorSplit: "3,1" }
  }),
  profile("different-build", "Shared custom", "/fixtures/models/shared.gguf", "/fixtures/builds/custom/llama-server"),
  profile("custom-arguments", "Custom arguments", "/fixtures/models/custom.gguf", "/fixtures/builds/custom/llama-server", {
    llamaArgs: { ctxSize: 32768, flashAttention: true },
    flagOverrides: [{ flag: "--custom-flag", values: ["safe-value"] }],
    extraArgs: ["--future-option", "preserve-me"]
  }),
  profile("missing-model", "Missing model", "/fixtures/missing/model.gguf", "/fixtures/builds/official/llama-server"),
  profile("missing-build", "Missing build", "/fixtures/models/normal.gguf", "/fixtures/missing/llama-server")
] as const satisfies readonly LlamaCppProfile[];

export const phase15ExpectedIdentityMappings = phase15LegacyProfiles.map((legacyProfile) => ({
  legacyProfileId: legacyProfile.id,
  configuredModelId: createConfiguredModelId(`legacy-profile:${legacyProfile.id}`),
  artifactId: createModelArtifactId(`legacy-model:${legacyProfile.modelPath}`),
  buildId: createLlamaCppBuildId(`legacy-build:${legacyProfile.buildPath}`)
}));

export const phase15MissingReferenceConfigurations: ConfiguredModel[] = phase15ExpectedIdentityMappings
  .filter((mapping) => mapping.legacyProfileId === "missing-model" || mapping.legacyProfileId === "missing-build")
  .map((mapping) => ({
    schemaVersion: 1,
    id: mapping.configuredModelId,
    displayName: mapping.legacyProfileId,
    routerAlias: createRouterAlias(mapping.legacyProfileId, mapping.configuredModelId),
    artifactId: mapping.artifactId,
    buildId: mapping.buildId,
    enabled: false,
    referenceStatus: {
      artifact: mapping.legacyProfileId === "missing-model" ? "missing" : "available",
      build: mapping.legacyProfileId === "missing-build" ? "missing" : "available"
    },
    validationStatus: "invalid"
  }));

export const phase15MultimodalFixture = {
  legacyProfile: profile("vision-source", "Vision source", "/fixtures/models/vision.gguf", "/fixtures/builds/official/llama-server"),
  modelArtifactId: createModelArtifactId("legacy-model:/fixtures/models/vision.gguf"),
  projectorArtifactId: createModelArtifactId("projector:/fixtures/models/vision-mmproj.gguf"),
  textConfiguredModelId: createConfiguredModelId("legacy-profile:vision-source:text"),
  visionConfiguredModelId: createConfiguredModelId("legacy-profile:vision-source:projector-a"),
  selection: "explicit" as const
};

export const phase15MissingProjectorConfiguration: ConfiguredModel = {
  schemaVersion: 1,
  id: createConfiguredModelId("legacy-profile:vision-missing-projector"),
  displayName: "Vision missing projector",
  routerAlias: createRouterAlias("Vision missing projector", createConfiguredModelId("legacy-profile:vision-missing-projector")),
  artifactId: phase15MultimodalFixture.modelArtifactId,
  buildId: createLlamaCppBuildId("legacy-build:/fixtures/builds/official/llama-server"),
  enabled: false,
  projector: {
    artifactId: createModelArtifactId("projector:/fixtures/missing/vision-mmproj.gguf"),
    selection: "explicit",
    validationStatus: "invalid",
    warnings: ["projector reference is missing"]
  },
  referenceStatus: { artifact: "available", build: "available" },
  validationStatus: "invalid"
};

export const phase15CompletedMigration: ProfileMigrationRecord = {
  migrationId: "phase15-fixture-completed",
  sourceVersion: LEGACY_PROFILE_SOURCE_VERSION,
  targetVersion: PHASE15_DOMAIN_TARGET_VERSION,
  sourceRevision: "fixture-source-revision",
  status: "completed",
  completedAt: "2026-08-28T00:00:00.000Z",
  backup: { resource: "/fixtures/backups/profiles.v1.json", verified: true },
  mappings: phase15ExpectedIdentityMappings.map((mapping) => {
    const legacyProfile = phase15LegacyProfiles.find((profile) => profile.id === mapping.legacyProfileId)!;
    return {
      ...mapping,
      preservedFields: (["llamaArgs", "flagOverrides", "extraArgs"] as const).filter((field) => legacyProfile[field] !== undefined),
      warnings: [],
      errors: []
    };
  }),
  migratedConfiguredModelIds: phase15ExpectedIdentityMappings.map((mapping) => mapping.configuredModelId),
  migratedBuildIds: [...new Set(phase15ExpectedIdentityMappings.map((mapping) => mapping.buildId))],
  invalidReferences: [
    { legacyProfileId: "missing-model", kind: "model", reference: "/fixtures/missing/model.gguf", reason: "missing" },
    { legacyProfileId: "missing-build", kind: "build", reference: "/fixtures/missing/llama-server", reason: "missing" },
    { legacyProfileId: "vision-missing-projector", kind: "projector", reference: "/fixtures/missing/vision-mmproj.gguf", reason: "missing" }
  ],
  warnings: [],
  errors: [],
  recoverable: true
};

export const phase15RepeatedMigrationInput = {
  sourceVersion: LEGACY_PROFILE_SOURCE_VERSION,
  sourceRevision: "fixture-source-revision",
  profiles: [...phase15LegacyProfiles],
  priorMigration: phase15CompletedMigration
};

export const phase15InterruptedMigration: ProfileMigrationRecord = {
  ...phase15CompletedMigration,
  migrationId: "phase15-fixture-interrupted",
  status: "interrupted",
  completedAt: undefined,
  backup: { resource: "/fixtures/backups/profiles.v1.interrupted.json", checksum: "fixture-checksum", verified: true },
  errors: ["fixture interruption after backup"],
  recoverable: true
};
