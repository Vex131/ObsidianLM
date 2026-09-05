import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSettings } from "@obsidianlm/shared";
import { discoverLlamaBuilds } from "../src/discovery/llama-builds.js";
import { discoverModels } from "../src/discovery/models.js";
import { synchronizeDiscoveryCatalog } from "../src/discovery/catalog-sync.js";
import {
  createConfiguredModelInSnapshot,
  findOrRegisterLegacyBuildInSnapshot,
  findOrRegisterLocalArtifactInSnapshot,
  loadPhase15Domain,
  mutatePhase15Domain,
  validatePhase15DomainSnapshot,
} from "../src/config/phase15-domain.js";
import { createServer, type CreateServerOptions } from "../src/server.js";
import type { LlamaBuildCapabilitiesManifest } from "@obsidianlm/shared";

const u32 = (value: number) => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
const i32 = (value: number) => { const out = Buffer.alloc(4); out.writeInt32LE(value); return out; };
const u64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const ggufText = (value: string) => Buffer.concat([u64(BigInt(Buffer.byteLength(value))), Buffer.from(value)]);
const ggufString = (key: string, value: string) => Buffer.concat([ggufText(key), i32(8), ggufText(value)]);
const gguf = (entries: Buffer[]) => Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0n), u64(BigInt(entries.length)), ...entries]);

const validationManifest = (
  buildId: string,
): LlamaBuildCapabilitiesManifest => ({
  buildId,
  serverPath: "fixture-server",
  inspectedAt: "2026-08-28T00:00:00.000Z",
  origin: { classification: "official", source: "path_hint", evidence: [] },
  status: "ready",
  devices: [],
  backendHints: [],
  flags: [
    ...[
      "--host",
      "--port",
      "--models-preset",
      "--models-max",
      "--ctx-size",
    ].map((canonicalName) => ({
      canonicalName,
      aliases: [],
      valuePlaceholder: "VALUE",
    })),
    { canonicalName: "--models-autoload", aliases: [] },
  ],
  router: {
    status: "candidate",
    evidence: { modelsPreset: true, modelsMax: true, modelsAutoload: true },
    missingRequiredFlags: [],
    compatibilityHints: [],
  },
  warnings: [],
});

async function fixture(t: test.TestContext, options: CreateServerOptions = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase15-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const models = path.join(dir, "models");
  const builds = path.join(dir, "builds");
  await mkdir(models, { recursive: true });
  await mkdir(builds, { recursive: true });
  const model = path.join(models, "vision-Q4_K_M.gguf");
  const projector = path.join(models, "vision-mmproj-f16.gguf");
  const text = path.join(models, "text-Q8_0.gguf");
  const buildFolder = path.join(builds, "fixture-build");
  const server = path.join(buildFolder, "llama-server.exe");
  await Promise.all([
    writeFile(model, "gguf"),
    writeFile(projector, "gguf"),
    writeFile(text, "gguf"),
    mkdir(buildFolder, { recursive: true }).then(() => writeFile(server, "exe")),
  ]);
  await writeFile(
    path.join(dir, "settings.json"),
    JSON.stringify({
      ...defaultSettings,
      modelFolders: [models],
      llamaCppFolders: [builds],
    }),
  );
  await writeFile(path.join(dir, "profiles.json"), "[]");
  const oldData = process.env.OBSIDIANLM_DATA_DIR;
  const oldLogs = process.env.OBSIDIANLM_LOG_DIR;
  process.env.OBSIDIANLM_DATA_DIR = dir;
  process.env.OBSIDIANLM_LOG_DIR = path.join(dir, "logs");
  t.after(() => {
    if (oldData === undefined) delete process.env.OBSIDIANLM_DATA_DIR;
    else process.env.OBSIDIANLM_DATA_DIR = oldData;
    if (oldLogs === undefined) delete process.env.OBSIDIANLM_LOG_DIR;
    else process.env.OBSIDIANLM_LOG_DIR = oldLogs;
  });
  const app = await createServer(options);
  t.after(() => app.close());
  const modelsFound = await discoverModels();
  const buildsFound = await discoverLlamaBuilds();
  const artifacts = (await app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  const syncedBuilds = (await app.inject({ method: "GET", url: "/api/builds" })).json().builds;
  const findArtifact = (discoveryId: string, locator: string, kind: string) =>
    artifacts.find((entry: { discoveryId: string; resource: { locator: string }; kind: string }) =>
      entry.discoveryId === discoveryId && entry.resource.locator === locator && entry.kind === kind)!.id;
  const findBuild = (discoveryId: string, serverPath: string) =>
    syncedBuilds.find((entry: { discoveryId: string; server: { locator: string } }) =>
      entry.discoveryId === discoveryId && entry.server.locator === serverPath)!.id;
  return {
    dir,
    model,
    projector,
    text,
    server,
    app,
    modelId: modelsFound.models.find((m) => m.path === model)!.id,
    projectorId: modelsFound.models.find((m) => m.path === projector)!.id,
    textId: modelsFound.models.find((m) => m.path === text)!.id,
    buildId: buildsFound.builds.find((b) => b.serverPath === server)!.id,
    artifactId: findArtifact(modelsFound.models.find((m) => m.path === model)!.id, model, "unknown"),
    projectorArtifactId: findArtifact(modelsFound.models.find((m) => m.path === projector)!.id, projector, "mmproj"),
    textArtifactId: findArtifact(modelsFound.models.find((m) => m.path === text)!.id, text, "unknown"),
    syncedBuildId: findBuild(buildsFound.builds.find((b) => b.serverPath === server)!.id, server),
  };
}

test("Phase 15 domain APIs are public and expose stable discovery identities", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.app.inject({ method: "GET", url: "/api/model-artifacts" }))
      .statusCode,
    200,
  );
  const registered = await f.app.inject({
    method: "GET",
    url: "/api/model-artifacts",
  });
  const artifact = registered
    .json()
    .artifacts.find(
      (entry: { discoveryId: string }) => entry.discoveryId === f.modelId,
    )!;
  const repeated = await f.app.inject({
    method: "GET",
    url: "/api/model-artifacts",
  });
  assert.equal(
    repeated.json().artifacts.find((entry: { id: string }) => entry.id === artifact.id).resource.locator,
    artifact.resource.locator,
  );
  const build = await f.app.inject({ method: "GET", url: "/api/builds" });
  const selectedBuild = build
    .json()
    .builds.find(
      (entry: { discoveryId: string }) => entry.discoveryId === f.buildId,
    )!;
  assert.equal(selectedBuild.managedInferenceEligibility, "not_validated");
  const capabilities = await f.app.inject({
    method: "GET",
    url: `/api/builds/${selectedBuild.id}/capabilities`,
  });
  assert.equal(capabilities.statusCode, 200);
  assert.equal(capabilities.json().buildId, selectedBuild.id);
  assert.equal(capabilities.json().serverPath, f.server);
  assert.equal(capabilities.json().status, "failed");
  assert.equal(
    (
      await f.app.inject({
        method: "PATCH",
        url: `/api/builds/${selectedBuild.id}`,

        payload: {
          managedInferenceEligibility: "eligible",
          functionalEvidence: {},
          validatedAt: "forged",
          serverFingerprint: "forged",
          catalogBoundaryVerified: true,
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await f.app.inject({
        method: "POST",
        url: "/api/model-artifacts",
      })
    ).statusCode,
    404,
  );
  const listed = await f.app.inject({
    method: "GET",
    url: "/api/model-artifacts",
  });
  assert.equal(listed.json().artifacts[0].configuredModelIds.length, 0);
});

async function catalog(f: Awaited<ReturnType<typeof fixture>>) {
  const artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  const builds = (await f.app.inject({ method: "GET", url: "/api/builds" })).json().builds;
  const artifact = (discoveryId: string, locator: string, kind: string) =>
    artifacts.find((entry: any) => entry.discoveryId === discoveryId && entry.resource.locator === locator && entry.kind === kind)!;
  const build = builds.find((entry: any) => entry.discoveryId === f.buildId && entry.server.locator === f.server)!;
  return { artifact: artifact(f.modelId, f.model, "unknown"), projector: artifact(f.projectorId, f.projector, "mmproj"), text: artifact(f.textId, f.text, "unknown"), build };
}

test("configured model API validates references, aliases, projector choice, and dependencies", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  const created = await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Vision", artifactId: c.artifact.id, buildId: c.build.id, enabled: false, llamaArgs: { ctxSize: 2048 } } });
  assert.equal(created.statusCode, 201); const model = created.json().model; assert.equal(model.validationStatus, "not_validated"); assert.equal(model.routerAlias, "vision");
  await mutatePhase15Domain((snapshot) => snapshot.compatibilityBindings.push({ legacyProfileId: "legacy-vision", configuredModelId: model.id, legacyRuntimeEndpoint: { host: "127.0.0.1", port: 8085 } }), f.dir);
  const detail = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}` })).json().model;
  assert.equal(detail.artifact.id, c.artifact.id); assert.equal(detail.build.id, c.build.id); assert.equal(detail.validation.structural, true); assert.deepEqual(detail.compatibilityProfileIds, ["legacy-vision"]);
  assert.deepEqual((await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts.find((entry: any) => entry.id === c.artifact.id).configuredModelIds, [model.id]);
  assert.deepEqual((await f.app.inject({ method: "GET", url: "/api/builds" })).json().builds.find((entry: any) => entry.id === c.build.id).configuredModelIds, [model.id]);
  const renamed = await f.app.inject({ method: "PATCH", url: `/api/configured-models/${model.id}`, payload: { displayName: "Renamed" } }); assert.equal(renamed.json().model.routerAlias, "vision");
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/configured-models/${model.id}`, payload: { routerAlias: "vision" } })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Other", routerAlias: "vision", artifactId: c.text.id, buildId: c.build.id, enabled: false } })).statusCode, 409);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Vision projector", artifactId: c.artifact.id, buildId: c.build.id, enabled: false, projector: { artifactId: c.projector.id, selection: "explicit", validationStatus: "not_validated" } } })).statusCode, 201);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Bad", artifactId: c.artifact.id, buildId: "missing", enabled: false } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Bad", artifactId: c.artifact.id, buildId: c.build.id, enabled: false, projector: { artifactId: c.projector.id, selection: "auto" } } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "DELETE", url: `/api/model-artifacts/${c.artifact.id}` })).statusCode, 409);
  assert.equal((await f.app.inject({ method: "DELETE", url: `/api/model-artifacts/${c.text.id}` })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/configured-models" })).json().configuredModels.length, 2);
});

test("artifact DTO keeps vision capability metadata-based and projector associations current", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  let artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  assert.deepEqual(artifacts.find((entry: any) => entry.id === c.artifact.id).vision, { capability: "unknown", module: "unknown" });
  const created = await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Vision", artifactId: c.artifact.id, buildId: c.build.id, enabled: false, projector: { artifactId: c.projector.id, selection: "explicit", validationStatus: "not_validated" } } });
  assert.equal(created.statusCode, 201);
  artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  assert.deepEqual(artifacts.find((entry: any) => entry.id === c.artifact.id).vision, { capability: "unknown", module: "installed" });
  assert.deepEqual(artifacts.find((entry: any) => entry.id === c.text.id).vision, { capability: "unknown", module: "unknown" });
  await rm(f.projector);
  artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  assert.deepEqual(artifacts.find((entry: any) => entry.id === c.artifact.id).vision, { capability: "unknown", module: "not_found" });
  const missingProjector = artifacts.find((entry: any) => entry.id === c.projector.id);
  assert.equal(missingProjector.id, c.projector.id);
  assert.equal(missingProjector.referenceStatus, "missing");
  const model = (await f.app.inject({ method: "GET", url: "/api/configured-models" })).json().configuredModels.find((entry: any) => entry.id === created.json().model.id);
  assert.equal(model.projectorAssociation.artifactId, c.projector.id);
  assert.equal(model.projectorAssociation.validationStatus, "invalid");
  assert.equal(model.validation.status, "invalid");
});

test("artifact DTO derives positive and negative vision capability from GGUF metadata", async (t) => {
  const f = await fixture(t);
  await Promise.all([
    writeFile(f.model, gguf([ggufString("general.type", "model"), ggufString("general.architecture", "qwen2vl")])),
    writeFile(f.text, gguf([ggufString("general.type", "text"), ggufString("general.architecture", "llama")])),
  ]);
  const artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  assert.deepEqual(artifacts.find((entry: any) => entry.resource.locator === f.model).vision, { capability: "yes", module: "not_found" });
  assert.deepEqual(artifacts.find((entry: any) => entry.resource.locator === f.text).vision, { capability: "no", module: "not_required" });
});

test("configured-model DTO exposes metadata vision capability independent of projector", async (t) => {
  const f = await fixture(t);
  await Promise.all([
    writeFile(f.model, gguf([ggufString("general.type", "model"), ggufString("general.architecture", "qwen2vl")])),
    writeFile(f.text, gguf([ggufString("general.type", "text"), ggufString("general.architecture", "llama")])),
  ]);
  const artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  const builds = (await f.app.inject({ method: "GET", url: "/api/builds" })).json().builds;
  const visionArtifact = artifacts.find((entry: any) => entry.resource.locator === f.model)!;
  const textArtifact = artifacts.find((entry: any) => entry.resource.locator === f.text)!;
  const projectorArtifact = artifacts.find((entry: any) => entry.resource.locator === f.projector)!;
  const build = builds.find((entry: any) => entry.server.locator === f.server)!;

  const unpairedId = (await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Vision unpaired", artifactId: visionArtifact.id, buildId: build.id, enabled: false } })).json().model.id;
  const unpaired = (await f.app.inject({ method: "GET", url: `/api/configured-models/${unpairedId}` })).json().model;
  assert.deepEqual(unpaired.artifact.vision, { capability: "yes", module: "not_found" });
  assert.equal(unpaired.projector, undefined);

  const withProjectorId = (await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Vision paired", artifactId: visionArtifact.id, buildId: build.id, enabled: false, projector: { artifactId: projectorArtifact.id, selection: "explicit", validationStatus: "not_validated" } } })).json().model.id;
  const withProjector = (await f.app.inject({ method: "GET", url: `/api/configured-models/${withProjectorId}` })).json().model;
  assert.deepEqual(withProjector.artifact.vision, { capability: "yes", module: "installed" });
  assert.equal(withProjector.projector.id, projectorArtifact.id);
  assert.equal(withProjector.artifact.vision.capability, unpaired.artifact.vision.capability);

  // Text-only general.type yields capability "no" (and kind "other"); assert via artifact authority shared by configured-model DTOs.
  assert.deepEqual(textArtifact.vision, { capability: "no", module: "not_required" });
  const refreshedText = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts.find((entry: any) => entry.id === textArtifact.id);
  assert.deepEqual(refreshedText.vision, { capability: "no", module: "not_required" });

  const unknownBase = await fixture(t);
  const unknownArtifacts = (await unknownBase.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  const unknownBuilds = (await unknownBase.app.inject({ method: "GET", url: "/api/builds" })).json().builds;
  const unknownModel = unknownArtifacts.find((entry: any) => entry.resource.locator === unknownBase.model)!;
  const unknownProjector = unknownArtifacts.find((entry: any) => entry.resource.locator === unknownBase.projector)!;
  const unknownBuild = unknownBuilds.find((entry: any) => entry.server.locator === unknownBase.server)!;
  const createdUnknownId = (await unknownBase.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Unknown base projector", artifactId: unknownModel.id, buildId: unknownBuild.id, enabled: false, projector: { artifactId: unknownProjector.id, selection: "explicit", validationStatus: "not_validated" } } })).json().model.id;
  const createdUnknown = (await unknownBase.app.inject({ method: "GET", url: `/api/configured-models/${createdUnknownId}` })).json().model;
  assert.equal(createdUnknown.artifact.vision.capability, "unknown");
  assert.equal(createdUnknown.artifact.vision.module, "installed");
  assert.equal(createdUnknown.projector.id, unknownProjector.id);
});

test("nearby similarly named projector is cataloged but never associated automatically", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  const created = await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Unpaired vision", artifactId: c.artifact.id, buildId: c.build.id, enabled: false } });
  assert.equal(created.statusCode, 201);
  const artifacts = (await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts;
  assert.equal(artifacts.find((entry: any) => entry.id === c.projector.id).kind, "mmproj");
  assert.deepEqual(artifacts.find((entry: any) => entry.id === c.artifact.id).vision, { capability: "unknown", module: "unknown" });
  const model = (await f.app.inject({ method: "GET", url: `/api/configured-models/${created.json().model.id}` })).json().model;
  assert.equal(model.projectorAssociation, undefined);
  assert.equal(model.projector, undefined);
});

test("first sync reconciles a missing legacy custom-bin Build without duplicating its identity", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase15-legacy-bin-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const models = path.join(dir, "models");
  const builds = path.join(dir, "builds");
  const buildFolder = path.join(builds, "qwen-custom");
  const server = path.join(buildFolder, "bin", process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const model = path.join(models, "qwen.gguf");
  await Promise.all([mkdir(models, { recursive: true }), mkdir(path.dirname(server), { recursive: true })]);
  await writeFile(model, "gguf");
  await writeFile(path.join(dir, "settings.json"), JSON.stringify({ ...defaultSettings, modelFolders: [models], llamaCppFolders: [builds] }));
  await writeFile(path.join(dir, "profiles.json"), JSON.stringify([{ id: "legacy-qwen", name: "Legacy Qwen", runtimeType: "llama.cpp", providerKind: "server", buildPath: server, modelPath: model, host: "127.0.0.1", port: 18085 }]));
  const oldData = process.env.OBSIDIANLM_DATA_DIR;
  const oldLogs = process.env.OBSIDIANLM_LOG_DIR;
  process.env.OBSIDIANLM_DATA_DIR = dir;
  process.env.OBSIDIANLM_LOG_DIR = path.join(dir, "logs");
  t.after(() => {
    if (oldData === undefined) delete process.env.OBSIDIANLM_DATA_DIR; else process.env.OBSIDIANLM_DATA_DIR = oldData;
    if (oldLogs === undefined) delete process.env.OBSIDIANLM_LOG_DIR; else process.env.OBSIDIANLM_LOG_DIR = oldLogs;
  });
  const app = await createServer();
  t.after(() => app.close());
  let response = await app.inject({ method: "GET", url: "/api/builds" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().builds.length, 1);
  const legacyBuild = response.json().builds[0];
  assert.equal(legacyBuild.resource.locator, buildFolder);
  assert.equal(legacyBuild.tools.some((tool: any) => tool.kind === "server" && tool.exists), false);
  let snapshot = await loadPhase15Domain(dir);
  const configured = snapshot.configuredModels[0]!;
  assert.equal(configured.buildId, legacyBuild.id);
  assert.equal(configured.referenceStatus.build, "missing");
  assert.equal(configured.validationStatus, "invalid");
  await writeFile(server, "restored");
  response = await app.inject({ method: "GET", url: "/api/builds" });
  assert.equal(response.json().builds.length, 1);
  assert.equal(response.json().builds[0].id, legacyBuild.id);
  assert.equal(response.json().builds[0].server.locator, server);
  assert.equal(response.json().builds[0].tools.some((tool: any) => tool.kind === "server" && tool.exists), true);
  snapshot = await loadPhase15Domain(dir);
  assert.equal(snapshot.configuredModels[0]!.buildId, legacyBuild.id);
  assert.equal(snapshot.configuredModels[0]!.referenceStatus.build, "available");
});

test("definitive artifact role conflicts retain identity but become invalid", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  const created = await mutatePhase15Domain((snapshot) => {
    const model = createConfiguredModelInSnapshot(snapshot, { displayName: "Historical mismatch", artifactId: c.artifact.id, buildId: c.build.id, enabled: true });
    const artifact = snapshot.artifacts.find((entry) => entry.id === c.projector.id)!;
    artifact.kind = "model";
    snapshot.configuredModels.find((entry) => entry.id === model.id)!.artifactId = artifact.id;
    return model;
  }, f.dir);
  const response = await f.app.inject({ method: "GET", url: "/api/model-artifacts" });
  const artifact = response.json().artifacts.find((entry: any) => entry.id === c.projector.id);
  assert.equal(artifact.id, c.projector.id);
  assert.equal(artifact.role, "conflict");
  assert.equal(artifact.selectionStatus, "invalid");
  const model = (await loadPhase15Domain(f.dir)).configuredModels.find((entry) => entry.id === created.result.id)!;
  assert.equal(model.enabled, false);
  assert.equal(model.validationStatus, "invalid");
  assert.ok(model.warnings?.includes("Artifact metadata conflicts with its configured model role."));
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/configured-models/${model.id}`, payload: { enabled: true } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models/preview", payload: { existingId: model.id, draft: { displayName: model.displayName, artifactId: model.artifactId, buildId: model.buildId, enabled: true } } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/configured-models/${model.id}/duplicate` })).statusCode, 400);
  const revalidated = await f.app.inject({ method: "POST", url: `/api/configured-models/${model.id}/revalidate` });
  assert.equal(revalidated.statusCode, 200);
  assert.equal(revalidated.json().model.enabled, false);
  assert.equal(revalidated.json().model.validationStatus, "invalid");
});

test("Build display names are discovery-owned", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  const rejected = await f.app.inject({ method: "PATCH", url: `/api/builds/${c.build.id}`, payload: { displayName: "Manual name" } });
  assert.equal(rejected.statusCode, 400);
  const classified = await f.app.inject({ method: "PATCH", url: `/api/builds/${c.build.id}`, payload: { classification: "custom" } });
  assert.equal(classified.statusCode, 200);
  assert.equal(classified.json().build.displayName, "fixture-build");
});

test("auto-sync disables missing dependencies and repaired resources stay disabled", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  const created = await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Reconcile", artifactId: c.artifact.id, buildId: c.build.id, enabled: true } }); const model = created.json().model;
  await rm(f.model); const missing = await f.app.inject({ method: "GET", url: "/api/model-artifacts" }); assert.equal(missing.statusCode, 200); assert.equal(missing.json().artifacts.find((entry: any) => entry.id === c.artifact.id).referenceStatus, "missing");
  let after = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}` })).json().model; assert.equal(after.enabled, false); assert.equal(after.validationStatus, "invalid");
  await writeFile(f.model, "recreated"); const repaired = await f.app.inject({ method: "GET", url: "/api/model-artifacts" }); assert.equal(repaired.statusCode, 200); assert.equal(repaired.json().artifacts.find((entry: any) => entry.id === c.artifact.id).id, c.artifact.id);
  after = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}` })).json().model; assert.equal(after.enabled, false); assert.equal(after.validationStatus, "not_validated");
  assert.equal((await f.app.inject({ method: "GET", url: "/api/model-artifacts/nope" })).statusCode, 404); assert.equal((await f.app.inject({ method: "DELETE", url: "/api/builds/nope" })).statusCode, 404);
});

test("catalog sync keeps one stable Build when a server disappears and returns in bin", async (t) => {
  const f = await fixture(t);
  const initial = await catalog(f);
  assert.equal(initial.build.tools.some((tool: any) => tool.kind === "server" && tool.exists), true);
  const result = await synchronizeDiscoveryCatalog({ fingerprint: async () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); } });
  assert.equal(result.builds.length, 1);
  assert.deepEqual(result.brokenBuildCandidates, []);
  const retained = (await loadPhase15Domain(f.dir)).builds.find((build) => build.id === initial.build.id)!;
  assert.equal(retained.tools.some((tool) => tool.kind === "server" && tool.exists), false);
  await rm(f.server);
  const broken = await f.app.inject({ method: "GET", url: "/api/builds" });
  assert.equal(broken.json().builds.filter((build: any) => build.id === initial.build.id).length, 1);
  const moved = path.join(path.dirname(f.server), "bin", path.basename(f.server));
  await mkdir(path.dirname(moved), { recursive: true });
  await writeFile(moved, "restored");
  const restored = await f.app.inject({ method: "GET", url: "/api/builds" });
  const build = restored.json().builds.find((entry: any) => entry.id === initial.build.id)!;
  assert.equal(build.server.locator, moved);
  assert.equal(build.id, initial.build.id);
});

test("auto-sync requires all references and persisted eligibility cannot be forged", async (t) => {
  const f = await fixture(t); const c = await catalog(f);
  const model = (await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Aggregate", artifactId: c.artifact.id, buildId: c.build.id, enabled: true, projector: { artifactId: c.projector.id, selection: "explicit", validationStatus: "not_validated" } } })).json().model;
  await rm(f.server); assert.equal((await f.app.inject({ method: "GET", url: "/api/builds" })).statusCode, 200);
  await rm(f.model); await f.app.inject({ method: "GET", url: "/api/model-artifacts" }); await writeFile(f.model, "restored"); await f.app.inject({ method: "GET", url: "/api/model-artifacts" });
  let detail = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}` })).json().model; assert.equal(detail.referenceStatus.artifact, "available"); assert.equal(detail.referenceStatus.build, "missing"); assert.equal(detail.validationStatus, "invalid");
  await writeFile(f.server, "restored"); await f.app.inject({ method: "GET", url: "/api/builds" }); detail = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}` })).json().model; assert.equal(detail.validationStatus, "not_validated"); assert.equal(detail.enabled, false);
  await assert.rejects(() => mutatePhase15Domain((snapshot) => { snapshot.builds.find((entry) => entry.id === c.build.id)!.managedInferenceEligibility = "eligible"; }, f.dir), /eligibility evidence/u);
  await assert.rejects(() => mutatePhase15Domain((snapshot) => { findOrRegisterLocalArtifactInSnapshot(snapshot, f.projector, { kind: "model" }); }, f.dir), /kind conflicts/u); validatePhase15DomainSnapshot(await loadPhase15Domain(f.dir));
});

test("router validation API validates payloads and exposes injected outcomes", async (t) => {
  let probeOutcome: "eligible" | "ineligible" | "failed" = "eligible"; let holdProbe: Promise<void> | undefined; let announceProbe: (() => void) | undefined;
  const options: CreateServerOptions = { functionalRouterValidatorDependencies: { fingerprint: async () => "api-fingerprint", staticProbe: async (build) => validationManifest(build.id), resourceAvailable: async () => true, managedPort: async () => 8085, probe: async ({ routerAlias }) => { announceProbe?.(); await holdProbe; return probeOutcome === "eligible" ? { launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, models: [{ id: routerAlias, status: "unloaded" }], classification: "eligible", reason: "fixture", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } } : { launchAttempted: true, presetAccepted: false, healthVerified: probeOutcome === "ineligible", modelsVerified: false, classification: probeOutcome, reason: probeOutcome === "failed" ? "validation timed out" : "router controls incompatible", warnings: [], failures: probeOutcome === "failed" ? ["probe_timeout"] : [], cleanup: { childTerminated: true, workspaceRemoved: true } }; } } };
  const f = await fixture(t, options); const c = await catalog(f);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/builds/unknown/validate-router" })).statusCode, 404);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/builds/unknown/validate-router", payload: { configuredModelId: 42 } })).statusCode, 400);
  const missing = await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router` }); assert.equal(missing.statusCode, 409);
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/model-artifacts/${c.artifact.id}`, payload: { kind: "model" } })).statusCode, 200);
  const configured = (await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "API model", artifactId: c.artifact.id, buildId: c.build.id, enabled: false } })).json().model;
  const eligible = await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: configured.id } }); assert.equal(eligible.statusCode, 200); assert.equal(eligible.json().outcome, "eligible"); assert.equal(eligible.json().build.functionalEvidence.serverFingerprint, "api-fingerprint"); assert.equal(eligible.json().build.functionalEvidence.catalogBoundaryVerified, true);
  probeOutcome = "ineligible"; assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: configured.id } })).json().outcome, "ineligible");
  probeOutcome = "failed"; assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: configured.id } })).json().outcome, "failed");
  probeOutcome = "eligible"; let release!: () => void; holdProbe = new Promise<void>((resolve) => { release = resolve; }); let started!: () => void; const probeStarted = new Promise<void>((resolve) => { started = resolve; }); announceProbe = started;
  const first = f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: configured.id } }); await probeStarted;
  const concurrent = await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: configured.id } }); assert.equal(concurrent.statusCode, 409); release(); assert.equal((await first).statusCode, 200);
});

test("router preset and launch APIs are read-only until generation and share artifact bytes", async (t) => {
  const options: CreateServerOptions = { functionalRouterValidatorDependencies: { fingerprint: async () => "api-preset-fingerprint", staticProbe: async (build) => validationManifest(build.id), resourceAvailable: async () => true, managedPort: async () => 8085, probe: async ({ routerAlias }) => ({ launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, models: [{ id: routerAlias, status: "unloaded" }], classification: "eligible", reason: "fixture", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } }) }, routerPresetDependencies: { fingerprint: async () => "api-preset-fingerprint", capabilities: async (_server, id) => validationManifest(id) } };
  const f = await fixture(t, options); const c = await catalog(f);
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/model-artifacts/${c.artifact.id}`, payload: { kind: "model" } })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/builds/unknown/router-preset/preview" })).statusCode, 404);
  const model = (await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Preset API", artifactId: c.artifact.id, buildId: c.build.id, enabled: true, llamaArgs: { ctxSize: 4096 } } })).json().model;
  assert.equal((await f.app.inject({ method: "GET", url: `/api/builds/${c.build.id}/router-preset/preview` })).statusCode, 409);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: model.id } })).statusCode, 200);
  const expectedPath = path.join(f.dir, "generated", "llama-router", `${c.build.id}.ini`); const preview = await f.app.inject({ method: "GET", url: `/api/builds/${c.build.id}/router-preset/preview` }); assert.equal(preview.statusCode, 200); assert.equal(preview.json().artifact.freshness, "unknown"); assert.equal(preview.json().artifact.resource.locator, expectedPath); await assert.rejects(() => readFile(expectedPath));
  const launch = await f.app.inject({ method: "GET", url: `/api/builds/${c.build.id}/router-launch/preview` }); assert.equal(launch.statusCode, 200); assert.equal(launch.json().artifact.resource.locator, expectedPath); assert.equal(launch.json().command.args.includes(expectedPath), true); await assert.rejects(() => readFile(expectedPath));
  const generated = await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/router-preset/generate` }); assert.equal(generated.statusCode, 200); assert.equal(generated.json().artifact.freshness, "current"); assert.equal((await readFile(expectedPath)).toString(), preview.json().content);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/router-preset/generate`, payload: { content: "forged" } })).statusCode, 400); await writeFile(expectedPath, `${preview.json().content}# manual edit\n`); const stale = await f.app.inject({ method: "GET", url: `/api/builds/${c.build.id}/router-preset/preview` }); assert.equal(stale.json().artifact.freshness, "stale"); assert.equal((await loadPhase15Domain(f.dir)).configuredModels[0]!.id, model.id);
});

test("configured model draft previews are read-only and use draft content", async (t) => {
  const options: CreateServerOptions = { functionalRouterValidatorDependencies: { fingerprint: async () => "api-preview-fingerprint", staticProbe: async (build) => validationManifest(build.id), resourceAvailable: async () => true, managedPort: async () => 8085, probe: async ({ routerAlias }) => ({ launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, models: [{ id: routerAlias, status: "unloaded" }], classification: "eligible", reason: "fixture", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } }) }, routerPresetDependencies: { fingerprint: async () => "api-preview-fingerprint", capabilities: async (_server, id) => validationManifest(id) } };
  const f = await fixture(t, options); const c = await catalog(f); await f.app.inject({ method: "PATCH", url: `/api/model-artifacts/${c.artifact.id}`, payload: { kind: "model" } }); const model = (await f.app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Persisted", artifactId: c.artifact.id, buildId: c.build.id, enabled: true, llamaArgs: { ctxSize: 4096 } } })).json().model;
  await f.app.inject({ method: "POST", url: `/api/builds/${c.build.id}/validate-router`, payload: { configuredModelId: model.id } }); const draft = { displayName: "Draft", artifactId: c.artifact.id, buildId: c.build.id, enabled: true, llamaArgs: { ctxSize: 8192 } };
  const preview = await f.app.inject({ method: "POST", url: "/api/configured-models/preview", payload: { existingId: model.id, draft } }); assert.equal(preview.statusCode, 200); assert.match(preview.json().preset.content, /ctx-size = 8192/); assert.equal(preview.json().launch.command.args.includes("--models-preset"), true); assert.equal((await loadPhase15Domain(f.dir)).configuredModels.find((entry) => entry.id === model.id)!.llamaArgs!.ctxSize, 4096);
  const appended = await f.app.inject({ method: "POST", url: "/api/configured-models/preview", payload: { draft: { ...draft, displayName: "Temporary" } } }); assert.equal(appended.statusCode, 200); assert.equal(appended.json().preset.configuredModelIds.length, 2); assert.equal((await loadPhase15Domain(f.dir)).configuredModels.length, 1); await assert.rejects(() => readFile(path.join(f.dir, "generated", "llama-router", `${c.build.id}.ini`)));
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models/preview", payload: { existingId: model.id, draft: { ...draft, extraArgs: ["--model", "forged"] } } })).statusCode, 400); assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models/preview", payload: { draft: 42 } })).statusCode, 400);
});

test("domain mutations serialize and failed atomic rename preserves bytes", async (t) => {
  const f = await fixture(t);
  const seed = await mutatePhase15Domain((s) => {
    const a = findOrRegisterLocalArtifactInSnapshot(s, f.model, {
      kind: "model",
      referenceStatus: "available",
    });
    const b = findOrRegisterLegacyBuildInSnapshot(s, f.server, "available");
    return { a, b };
  }, f.dir);
  const input = {
    displayName: "Concurrent",
    artifactId: seed.result.a.id,
    buildId: seed.result.b.id,
    enabled: false,
  } as any;
  const results = await Promise.all([
    mutatePhase15Domain(
      (s) => createConfiguredModelInSnapshot(s, { ...input, displayName: "A" }),
      f.dir,
    ),
    mutatePhase15Domain(
      (s) => createConfiguredModelInSnapshot(s, { ...input, displayName: "B" }),
      f.dir,
    ),
  ]);
  assert.equal((await loadPhase15Domain(f.dir)).configuredModels.length, 2);
  assert.equal(results.length, 2);
  const sameAlias = await Promise.allSettled([
    mutatePhase15Domain(
      (s) =>
        createConfiguredModelInSnapshot(s, {
          ...input,
          displayName: "C",
          routerAlias: "same-alias",
        }),
      f.dir,
    ),
    mutatePhase15Domain(
      (s) =>
        createConfiguredModelInSnapshot(s, {
          ...input,
          displayName: "D",
          routerAlias: "same-alias",
        }),
      f.dir,
    ),
  ]);
  assert.equal(
    sameAlias.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const before = await readFile(path.join(f.dir, "phase15-domain.json"));
  await assert.rejects(() =>
    mutatePhase15Domain(
      (s) => {
        s.builds[0]!.displayName = "lost";
      },
      f.dir,
      {
        rename: async () => {
          throw new Error("rename failed");
        },
      },
    ),
  );
  assert.deepEqual(
    await readFile(path.join(f.dir, "phase15-domain.json")),
    before,
  );
  validatePhase15DomainSnapshot(JSON.parse(before.toString()));
});
