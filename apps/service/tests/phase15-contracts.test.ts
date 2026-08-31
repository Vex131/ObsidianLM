import assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_CONFIGURATION_SCHEMA_VERSION,
  createConfiguredModelId,
  createLlamaCppBuildId,
  createModelArtifactId,
  createRouterAlias,
  isBuildEligibleForManagedInference,
  isRouterAlias,
  type ConfiguredModel,
  type GeneratedRouterArtifact,
  type LlamaCppBuild,
  type ModelArtifact,
  type RouterCatalogEntry,
  type RouterLaunchPreview,
  type RouterModelState,
  type RouterPresetPreview,
} from "@obsidianlm/shared";
import {
  phase15CompletedMigration,
  phase15ExpectedIdentityMappings,
  phase15InterruptedMigration,
  phase15LegacyProfiles,
  phase15MissingReferenceConfigurations,
  phase15MissingProjectorConfiguration,
  phase15MultimodalFixture,
  phase15RepeatedMigrationInput,
} from "./fixtures/phase15-migration.js";

const localResource = (locator: string) => ({
  owner: { scope: "local" as const },
  locator,
});

test("artifact, configured-model, and build identities remain distinct", () => {
  const artifactId = createModelArtifactId("same-resource");
  const configuredA = createConfiguredModelId("configuration-a");
  const configuredB = createConfiguredModelId("configuration-b");
  const buildId = createLlamaCppBuildId("same-resource");

  assert.notEqual(artifactId, configuredA);
  assert.notEqual(configuredA, configuredB);
  assert.notEqual(artifactId, buildId);
  assert.equal(createConfiguredModelId("configuration-a"), configuredA);
});

test("router aliases are conservative, stable after storage, and collision-safe", () => {
  const firstId = createConfiguredModelId("first");
  const secondId = createConfiguredModelId("second");
  const first = createRouterAlias("Vision Model (Q8)", firstId);
  const second = createRouterAlias("Vision Model (Q8)", secondId, [first]);
  const repeated = createRouterAlias("Vision Model (Q8)", secondId, [first]);

  assert.equal(first, "vision-model-q8");
  assert.equal(second, repeated);
  assert.notEqual(first, second);
  assert.ok(isRouterAlias(first));
  assert.ok(isRouterAlias(second));
  assert.ok(second.length <= 64);

  const configured = {
    id: firstId,
    displayName: "Renamed",
    routerAlias: first,
  };
  assert.equal(configured.routerAlias, first);
});

test("managed inference eligibility requires functional router evidence", () => {
  const base: LlamaCppBuild = {
    schemaVersion: 1,
    id: createLlamaCppBuildId("official-build"),
    displayName: "Official build",
    resource: localResource("/fixtures/builds/official"),
    server: localResource("/fixtures/builds/official/llama-server"),
    serverFingerprint: "fingerprint-current",
    tools: [],
    classification: "official",
    staticEvidence: {
      kind: "static",
      assessedAt: "2026-08-28T00:00:00.000Z",
      discoveredTools: [],
      routerFlags: {
        status: "candidate",
        evidence: { modelsPreset: true, modelsMax: true, modelsAutoload: true },
        missingRequiredFlags: [],
        compatibilityHints: [],
      },
      warnings: [],
    },
    managedInferenceEligibility: "eligible",
    warnings: [],
    failures: [],
  };
  assert.equal(isBuildEligibleForManagedInference(base), false);
  assert.equal(base.staticEvidence?.kind, "static");

  const unlaunched: LlamaCppBuild = {
    ...base,
    functionalEvidence: {
      kind: "functional",
      state: "eligible",
      validationProtocolVersion: 1,
      serverFingerprint: "fingerprint-current",
      launchAttempted: false,
      presetAccepted: true,
      healthVerified: true,
      modelsVerified: true,
      catalogBoundaryVerified: true,
      requiredBehaviorVerified: true,
      warnings: [],
      failures: [],
    },
  };
  assert.equal(isBuildEligibleForManagedInference(unlaunched), false);

  const eligible: LlamaCppBuild = {
    ...base,
    functionalEvidence: {
      kind: "functional",
      state: "eligible",
      validationProtocolVersion: 1,
      serverFingerprint: "fingerprint-current",
      launchAttempted: true,
      presetAccepted: true,
      healthVerified: true,
      modelsVerified: true,
      catalogBoundaryVerified: true,
      requiredBehaviorVerified: true,
      warnings: [],
      failures: [],
    },
  };
  assert.equal(isBuildEligibleForManagedInference(eligible), true);
  assert.equal(eligible.functionalEvidence?.kind, "functional");
  assert.notEqual(eligible.classification, eligible.functionalEvidence?.kind);
  assert.notEqual(
    eligible.staticEvidence?.kind,
    eligible.functionalEvidence?.kind,
  );
});

test("router catalog ownership and lifecycle states preserve control-plane boundaries", () => {
  const managed: RouterCatalogEntry = {
    routerIdentifier: "managed-model",
    ownership: "managed",
    configuredModelId: createConfiguredModelId("managed-model"),
    state: "loaded",
  };
  const external: RouterCatalogEntry = {
    routerIdentifier: "cache-visible-model",
    ownership: "external",
    state: "unloaded",
    rawEvidence: { source: "cache" },
  };
  const states = new Set<RouterModelState>([
    "unloaded",
    "loading",
    "loaded",
    "sleeping",
    "unavailable",
    "failed",
    "unknown",
  ]);

  assert.equal(managed.ownership, "managed");
  assert.equal(external.ownership, "external");
  assert.equal("configuredModelId" in external, false);
  for (const required of [
    "unloaded",
    "loading",
    "loaded",
    "sleeping",
    "unavailable",
  ] as const)
    assert.ok(states.has(required));
});

test("generated presets are derived artifacts distinct from router launch commands", () => {
  const artifact: GeneratedRouterArtifact = {
    schemaVersion: 1,
    authority: "derived",
    buildId: createLlamaCppBuildId("fixture-build"),
    resource: localResource("/fixtures/generated/llama-router/build.ini"),
    generatorVersion: "fixture-v1",
    sourceRevision: "fixture-source",
    contentHash: "fixture-hash",
    freshness: "current",
    validationState: "not_validated",
    warnings: [],
    errors: [],
  };
  const launch: RouterLaunchPreview = {
    kind: "router_launch",
    artifact,
    policy: { modelsMax: 1, modelsAutoload: true },
    command: {
      executable: "/fixtures/llama-server",
      args: ["--models-preset", artifact.resource.locator],
      displayCommand: "fixture",
      commandHash: "fixture",
    },
  };
  const preset: RouterPresetPreview = {
    kind: "model_preset",
    buildId: artifact.buildId,
    artifact,
    content: "[fixture]",
    configuredModelIds: [createConfiguredModelId("fixture")],
  };

  assert.equal(artifact.authority, "derived");
  assert.notEqual(launch.kind, preset.kind);
  assert.equal(launch.policy.modelsMax, 1);
});

test("migration fixtures preserve duplicate configurations and custom arguments", () => {
  const duplicateMappings = phase15ExpectedIdentityMappings.filter((mapping) =>
    mapping.legacyProfileId.startsWith("duplicate-"),
  );
  assert.equal(duplicateMappings.length, 2);
  assert.equal(
    duplicateMappings[0]?.artifactId,
    duplicateMappings[1]?.artifactId,
  );
  assert.notEqual(
    duplicateMappings[0]?.configuredModelId,
    duplicateMappings[1]?.configuredModelId,
  );

  const differentBuild = phase15ExpectedIdentityMappings.find(
    (mapping) => mapping.legacyProfileId === "different-build",
  );
  assert.equal(differentBuild?.artifactId, duplicateMappings[0]?.artifactId);
  assert.notEqual(differentBuild?.buildId, duplicateMappings[0]?.buildId);

  const custom = phase15LegacyProfiles.find(
    (profile) => profile.id === "custom-arguments",
  );
  assert.deepEqual(custom?.flagOverrides, [
    { flag: "--custom-flag", values: ["safe-value"] },
  ]);
  assert.deepEqual(custom?.extraArgs, ["--future-option", "preserve-me"]);
  assert.equal(custom?.llamaArgs?.ctxSize, 32768);
  const customMapping = phase15CompletedMigration.mappings.find(
    (mapping) => mapping.legacyProfileId === "custom-arguments",
  );
  assert.deepEqual(customMapping?.preservedFields, [
    "llamaArgs",
    "flagOverrides",
    "extraArgs",
  ]);
});

test("missing references, repeat detection, and interrupted recovery remain explicit", () => {
  assert.deepEqual(
    phase15CompletedMigration.invalidReferences
      .map((reference) => reference.kind)
      .sort(),
    ["build", "model", "projector"],
  );
  assert.equal(phase15MissingReferenceConfigurations.length, 2);
  assert.ok(
    phase15MissingReferenceConfigurations.every(
      (configuration) =>
        !configuration.enabled && configuration.validationStatus === "invalid",
    ),
  );
  assert.equal(
    phase15MissingReferenceConfigurations.find(
      (configuration) => configuration.displayName === "missing-model",
    )?.referenceStatus.artifact,
    "missing",
  );
  assert.equal(
    phase15MissingReferenceConfigurations.find(
      (configuration) => configuration.displayName === "missing-build",
    )?.referenceStatus.build,
    "missing",
  );
  assert.equal(
    phase15MissingProjectorConfiguration.projector?.validationStatus,
    "invalid",
  );
  assert.equal(phase15MissingProjectorConfiguration.enabled, false);
  assert.equal(
    phase15RepeatedMigrationInput.priorMigration?.status,
    "completed",
  );
  assert.equal(
    phase15RepeatedMigrationInput.sourceRevision,
    phase15RepeatedMigrationInput.priorMigration?.sourceRevision,
  );
  assert.equal(phase15InterruptedMigration.status, "interrupted");
  assert.equal(phase15InterruptedMigration.backup?.verified, true);
  assert.equal(phase15InterruptedMigration.recoverable, true);
});

test("one artifact supports text-only and explicit projector configurations", () => {
  const artifact: ModelArtifact = {
    schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION,
    id: phase15MultimodalFixture.modelArtifactId,
    resource: localResource(phase15MultimodalFixture.legacyProfile.modelPath),
    kind: "model",
    referenceStatus: "available",
  };
  const base: ConfiguredModel = {
    schemaVersion: MODEL_CONFIGURATION_SCHEMA_VERSION,
    id: phase15MultimodalFixture.textConfiguredModelId,
    displayName: "Vision model text-only",
    routerAlias: createRouterAlias(
      "Vision model text-only",
      phase15MultimodalFixture.textConfiguredModelId,
    ),
    artifactId: artifact.id,
    buildId: createLlamaCppBuildId("vision-build"),
    enabled: true,
    referenceStatus: { artifact: "available", build: "available" },
    validationStatus: "not_validated",
  };
  const vision: ConfiguredModel = {
    ...base,
    id: phase15MultimodalFixture.visionConfiguredModelId,
    displayName: "Vision model projector A",
    routerAlias: createRouterAlias(
      "Vision model projector A",
      phase15MultimodalFixture.visionConfiguredModelId,
      [base.routerAlias],
    ),
    projector: {
      artifactId: phase15MultimodalFixture.projectorArtifactId,
      selection: phase15MultimodalFixture.selection,
      validationStatus: "not_validated",
    },
  };

  assert.equal(base.artifactId, vision.artifactId);
  assert.equal(base.projector, undefined);
  assert.equal(vision.projector?.selection, "explicit");
});
