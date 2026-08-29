import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSettings } from "@obsidianlm/shared";
import { hashAdminToken } from "../src/auth/admin-token.js";
import { discoverLlamaBuilds } from "../src/discovery/llama-builds.js";
import { discoverModels } from "../src/discovery/models.js";
import { createConfiguredModelInSnapshot, findOrRegisterLegacyBuildInSnapshot, findOrRegisterLocalArtifactInSnapshot, loadPhase15Domain, mutatePhase15Domain, validatePhase15DomainSnapshot } from "../src/config/phase15-domain.js";
import { createServer, type CreateServerOptions } from "../src/server.js";
import type { LlamaBuildCapabilitiesManifest } from "@obsidianlm/shared";

const token = "phase15-test-token";

const validationManifest = (buildId: string): LlamaBuildCapabilitiesManifest => ({
  buildId,
  serverPath: "fixture-server",
  inspectedAt: "2026-08-28T00:00:00.000Z",
  origin: { classification: "official", source: "path_hint", evidence: [] },
  status: "ready",
  devices: [],
  backendHints: [],
  flags: [...["--host", "--port", "--models-preset", "--models-max", "--ctx-size"].map((canonicalName) => ({ canonicalName, aliases: [], valuePlaceholder: "VALUE" })), { canonicalName: "--models-autoload", aliases: [] }],
  router: { status: "candidate", evidence: { modelsPreset: true, modelsMax: true, modelsAutoload: true }, missingRequiredFlags: [], compatibilityHints: [] },
  warnings: []
});

async function fixture(t: test.TestContext, options: CreateServerOptions = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase15-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const models = path.join(dir, "models");
  const builds = path.join(dir, "builds");
  await mkdir(models, { recursive: true }); await mkdir(builds, { recursive: true });
  const model = path.join(models, "vision-Q4_K_M.gguf");
  const projector = path.join(models, "vision-mmproj-f16.gguf");
  const text = path.join(models, "text-Q8_0.gguf");
  const server = path.join(builds, "llama-server.exe");
  await Promise.all([writeFile(model, "gguf"), writeFile(projector, "gguf"), writeFile(text, "gguf"), writeFile(server, "exe")]);
  await writeFile(path.join(dir, "settings.json"), JSON.stringify({ ...defaultSettings, modelFolders: [models], llamaCppFolders: [builds], adminTokenHash: await hashAdminToken(token) }));
  await writeFile(path.join(dir, "profiles.json"), "[]");
  const oldData = process.env.OBSIDIANLM_DATA_DIR; const oldLogs = process.env.OBSIDIANLM_LOG_DIR;
  process.env.OBSIDIANLM_DATA_DIR = dir; process.env.OBSIDIANLM_LOG_DIR = path.join(dir, "logs");
  t.after(() => { if (oldData === undefined) delete process.env.OBSIDIANLM_DATA_DIR; else process.env.OBSIDIANLM_DATA_DIR = oldData; if (oldLogs === undefined) delete process.env.OBSIDIANLM_LOG_DIR; else process.env.OBSIDIANLM_LOG_DIR = oldLogs; });
  const app = await createServer(options); t.after(() => app.close());
  const auth = { authorization: `Bearer ${token}` };
  const modelsFound = await discoverModels(); const buildsFound = await discoverLlamaBuilds();
  return { dir, model, projector, text, server, app, auth, modelId: modelsFound.models.find((m) => m.path === model)!.id, projectorId: modelsFound.models.find((m) => m.path === projector)!.id, textId: modelsFound.models.find((m) => m.path === text)!.id, buildId: buildsFound.builds.find((b) => b.serverPath === server)!.id };
}

test("Phase 15 domain APIs are protected and register stable discovery identities", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/model-artifacts" })).statusCode, 401);
  const registered = await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } });
  assert.equal(registered.statusCode, 201); const artifact = registered.json().artifact;
  const repeated = await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } });
  assert.equal(repeated.json().artifact.id, artifact.id);
  const build = await f.app.inject({ method: "POST", url: "/api/builds/register", headers: f.auth, payload: { discoveryId: f.buildId } });
  assert.equal(build.statusCode, 201); assert.equal(build.json().build.managedInferenceEligibility, "not_validated");
  const capabilities = await f.app.inject({ method: "GET", url: `/api/builds/${build.json().build.id}/capabilities`, headers: f.auth });
  assert.equal(capabilities.statusCode, 200); assert.equal(capabilities.json().buildId, build.json().build.id); assert.equal(capabilities.json().serverPath, f.server); assert.equal(capabilities.json().status, "failed");
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/builds/${build.json().build.id}`, headers: f.auth, payload: { managedInferenceEligibility: "eligible", functionalEvidence: {}, validatedAt: "forged", serverFingerprint: "forged", catalogBoundaryVerified: true } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: {} })).statusCode, 400);
  const listed = await f.app.inject({ method: "GET", url: "/api/model-artifacts", headers: f.auth });
  assert.equal(listed.json().artifacts[0].configuredModelIds.length, 0);
});

test("configured model API validates references, aliases, projector choice, and dependencies", async (t) => {
  const f = await fixture(t); const a = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } })).json().artifact;
  const p = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.projectorId } })).json().artifact;
  const text = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.textId } })).json().artifact;
  const b = (await f.app.inject({ method: "POST", url: "/api/builds/register", headers: f.auth, payload: { discoveryId: f.buildId } })).json().build;
  const created = await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Vision", artifactId: a.id, buildId: b.id, enabled: false, llamaArgs: { ctxSize: 2048 } } });
  assert.equal(created.statusCode, 201); const model = created.json().model; assert.equal(model.validationStatus, "not_validated"); assert.equal(model.routerAlias, "vision");
  await mutatePhase15Domain((snapshot) => snapshot.compatibilityBindings.push({ legacyProfileId: "legacy-vision", configuredModelId: model.id, legacyRuntimeEndpoint: { host: "127.0.0.1", port: 8085 } }), f.dir);
  const detail = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}`, headers: f.auth })).json().model;
  assert.equal(detail.artifact.id, a.id); assert.equal(detail.build.id, b.id); assert.equal(detail.validation.structural, true); assert.deepEqual(detail.compatibilityProfileIds, ["legacy-vision"]);
  const artifactList = (await f.app.inject({ method: "GET", url: "/api/model-artifacts", headers: f.auth })).json(); assert.deepEqual(artifactList.artifacts.find((entry: any) => entry.id === a.id).configuredModelIds, [model.id]);
  const buildList = (await f.app.inject({ method: "GET", url: "/api/builds", headers: f.auth })).json(); assert.deepEqual(buildList.builds.find((entry: any) => entry.id === b.id).configuredModelIds, [model.id]);
  const renamed = await f.app.inject({ method: "PATCH", url: `/api/configured-models/${model.id}`, headers: f.auth, payload: { displayName: "Renamed" } }); assert.equal(renamed.json().model.routerAlias, "vision");
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/configured-models/${model.id}`, headers: f.auth, payload: { routerAlias: "vision" } })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Other", routerAlias: "vision", artifactId: text.id, buildId: b.id, enabled: false } })).statusCode, 409);
  const withProjector = await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Vision projector", artifactId: a.id, buildId: b.id, enabled: false, projector: { artifactId: p.id, selection: "explicit", validationStatus: "not_validated" } } }); assert.equal(withProjector.statusCode, 201);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Bad", artifactId: a.id, buildId: "missing", enabled: false } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Bad", artifactId: a.id, buildId: b.id, enabled: false, projector: { artifactId: p.id, selection: "auto" } } })).statusCode, 400);
  assert.equal((await f.app.inject({ method: "DELETE", url: `/api/model-artifacts/${a.id}`, headers: f.auth })).statusCode, 409);
  assert.equal((await f.app.inject({ method: "DELETE", url: `/api/model-artifacts/${text.id}`, headers: f.auth })).statusCode, 200);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/configured-models", headers: f.auth })).json().configuredModels.length, 2);
});

test("reconcile disables missing dependencies and re-registering does not auto-enable", async (t) => {
  const f = await fixture(t); const a = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } })).json().artifact; const b = (await f.app.inject({ method: "POST", url: "/api/builds/register", headers: f.auth, payload: { discoveryId: f.buildId } })).json().build;
  const m = (await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Reconcile", artifactId: a.id, buildId: b.id, enabled: true } })).json().model;
  await rm(f.model); const missing = await f.app.inject({ method: "POST", url: `/api/model-artifacts/${a.id}/reconcile`, headers: f.auth }); assert.equal(missing.statusCode, 200); assert.equal(missing.json().artifact.referenceStatus, "missing");
  let after = (await f.app.inject({ method: "GET", url: `/api/configured-models/${m.id}`, headers: f.auth })).json().model; assert.equal(after.enabled, false); assert.equal(after.validationStatus, "invalid");
  await writeFile(f.model, "recreated"); const reconciled = await f.app.inject({ method: "POST", url: `/api/model-artifacts/${a.id}/reconcile`, headers: f.auth }); assert.equal(reconciled.json().artifact.id, a.id); after = (await f.app.inject({ method: "GET", url: `/api/configured-models/${m.id}`, headers: f.auth })).json().model; assert.equal(after.enabled, false); assert.equal(after.validationStatus, "not_validated");
  assert.equal((await f.app.inject({ method: "GET", url: "/api/model-artifacts/nope", headers: f.auth })).statusCode, 404); assert.equal((await f.app.inject({ method: "DELETE", url: "/api/builds/nope", headers: f.auth })).statusCode, 404);
});

test("reconciliation requires all references and persisted eligibility cannot be forged", async (t) => {
  const f = await fixture(t);
  const artifact = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } })).json().artifact;
  const projector = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.projectorId } })).json().artifact;
  const build = (await f.app.inject({ method: "POST", url: "/api/builds/register", headers: f.auth, payload: { discoveryId: f.buildId } })).json().build;
  const model = (await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Aggregate", artifactId: artifact.id, buildId: build.id, enabled: true, projector: { artifactId: projector.id, selection: "explicit", validationStatus: "not_validated" } } })).json().model;

  await rm(f.server);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/reconcile`, headers: f.auth })).statusCode, 200);
  await rm(f.model);
  await f.app.inject({ method: "POST", url: `/api/model-artifacts/${artifact.id}/reconcile`, headers: f.auth });
  await writeFile(f.model, "restored");
  assert.equal((await f.app.inject({ method: "POST", url: `/api/model-artifacts/${artifact.id}/reconcile`, headers: f.auth })).statusCode, 200);
  let detail = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}`, headers: f.auth })).json().model;
  assert.equal(detail.referenceStatus.artifact, "available");
  assert.equal(detail.referenceStatus.build, "missing");
  assert.equal(detail.validationStatus, "invalid");

  await writeFile(f.server, "restored");
  assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/reconcile`, headers: f.auth })).statusCode, 200);
  detail = (await f.app.inject({ method: "GET", url: `/api/configured-models/${model.id}`, headers: f.auth })).json().model;
  assert.equal(detail.validationStatus, "not_validated");
  assert.equal(detail.enabled, false);

  await assert.rejects(() => mutatePhase15Domain((snapshot) => {
    snapshot.builds.find((entry) => entry.id === build.id)!.managedInferenceEligibility = "eligible";
  }, f.dir), /eligibility evidence/u);
  await assert.rejects(() => mutatePhase15Domain((snapshot) => {
    findOrRegisterLocalArtifactInSnapshot(snapshot, f.projector, { kind: "model" });
  }, f.dir), /kind conflicts/u);
  validatePhase15DomainSnapshot(await loadPhase15Domain(f.dir));
});

test("router validation API authenticates, validates payloads, and exposes injected outcomes", async (t) => {
  let probeOutcome: "eligible" | "ineligible" | "failed" = "eligible";
  let holdProbe: Promise<void> | undefined;
  let announceProbe: (() => void) | undefined;
  const options: CreateServerOptions = {
    functionalRouterValidatorDependencies: {
      fingerprint: async () => "api-fingerprint",
      staticProbe: async (build) => validationManifest(build.id),
      resourceAvailable: async () => true,
      managedPort: async () => 8085,
      probe: async ({ routerAlias }) => { announceProbe?.(); await holdProbe; return probeOutcome === "eligible"
        ? { launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, models: [{ id: routerAlias, status: "unloaded" }], classification: "eligible", reason: "fixture", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } }
        : { launchAttempted: true, presetAccepted: false, healthVerified: probeOutcome === "ineligible", modelsVerified: false, classification: probeOutcome, reason: probeOutcome === "failed" ? "validation timed out" : "router controls incompatible", warnings: [], failures: probeOutcome === "failed" ? ["probe_timeout"] : [], cleanup: { childTerminated: true, workspaceRemoved: true } }; }
    }
  };
  const f = await fixture(t, options);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/builds/unknown/validate-router" })).statusCode, 401);
  assert.equal((await f.app.inject({ method: "POST", url: "/api/builds/unknown/validate-router", headers: f.auth })).statusCode, 404);
  const malformed = await f.app.inject({ method: "POST", url: "/api/builds/unknown/validate-router", headers: f.auth, payload: { configuredModelId: 42 } });
  assert.equal(malformed.statusCode, 400);

  const build = (await f.app.inject({ method: "POST", url: "/api/builds/register", headers: f.auth, payload: { discoveryId: f.buildId } })).json().build;
  const missing = await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth });
  assert.equal(missing.statusCode, 409);
  const artifact = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } })).json().artifact;
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/model-artifacts/${artifact.id}`, headers: f.auth, payload: { kind: "model" } })).statusCode, 200);
  const configured = (await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "API model", artifactId: artifact.id, buildId: build.id, enabled: false } })).json().model;
  const eligible = await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth, payload: { configuredModelId: configured.id } });
  assert.equal(eligible.statusCode, 200);
  assert.equal(eligible.json().outcome, "eligible");
  assert.equal(eligible.json().build.functionalEvidence.serverFingerprint, "api-fingerprint");
  assert.equal(eligible.json().build.functionalEvidence.catalogBoundaryVerified, true);
  probeOutcome = "ineligible";
  const ineligible = await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth, payload: { configuredModelId: configured.id } });
  assert.equal(ineligible.statusCode, 200); assert.equal(ineligible.json().outcome, "ineligible");
  probeOutcome = "failed";
  const failed = await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth, payload: { configuredModelId: configured.id } });
  assert.equal(failed.statusCode, 200); assert.equal(failed.json().outcome, "failed");
  probeOutcome = "eligible"; let release!: () => void; holdProbe = new Promise<void>((resolve) => { release = resolve; }); let started!: () => void; const probeStarted = new Promise<void>((resolve) => { started = resolve; }); announceProbe = started;
  const first = f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth, payload: { configuredModelId: configured.id } });
  await probeStarted;
  const concurrent = await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth, payload: { configuredModelId: configured.id } });
  assert.equal(concurrent.statusCode, 409); release(); assert.equal((await first).statusCode, 200);
});

test("router preset and launch APIs are authenticated, read-only until generation, and share exact artifact bytes", async (t) => {
  const options: CreateServerOptions = {
    functionalRouterValidatorDependencies: {
      fingerprint: async () => "api-preset-fingerprint",
      staticProbe: async (build) => validationManifest(build.id),
      resourceAvailable: async () => true,
      managedPort: async () => 8085,
      probe: async ({ routerAlias }) => ({ launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, models: [{ id: routerAlias, status: "unloaded" }], classification: "eligible", reason: "fixture", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } })
    },
    routerPresetDependencies: {
      fingerprint: async () => "api-preset-fingerprint",
      capabilities: async (_server, id) => validationManifest(id)
    }
  };
  const f = await fixture(t, options);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/builds/unknown/router-preset/preview" })).statusCode, 401);
  assert.equal((await f.app.inject({ method: "GET", url: "/api/builds/unknown/router-preset/preview", headers: f.auth })).statusCode, 404);
  const build = (await f.app.inject({ method: "POST", url: "/api/builds/register", headers: f.auth, payload: { discoveryId: f.buildId } })).json().build;
  const artifact = (await f.app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: f.auth, payload: { discoveryId: f.modelId } })).json().artifact;
  assert.equal((await f.app.inject({ method: "PATCH", url: `/api/model-artifacts/${artifact.id}`, headers: f.auth, payload: { kind: "model" } })).statusCode, 200);
  const model = (await f.app.inject({ method: "POST", url: "/api/configured-models", headers: f.auth, payload: { displayName: "Preset API", artifactId: artifact.id, buildId: build.id, enabled: true, llamaArgs: { ctxSize: 4096 } } })).json().model;
  assert.equal((await f.app.inject({ method: "GET", url: `/api/builds/${build.id}/router-preset/preview`, headers: f.auth })).statusCode, 409);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/validate-router`, headers: f.auth, payload: { configuredModelId: model.id } })).statusCode, 200);
  const expectedPath = path.join(f.dir, "generated", "llama-router", `${build.id}.ini`);
  const preview = await f.app.inject({ method: "GET", url: `/api/builds/${build.id}/router-preset/preview`, headers: f.auth }); assert.equal(preview.statusCode, 200); assert.equal(preview.json().artifact.freshness, "unknown"); assert.equal(preview.json().artifact.resource.locator, expectedPath); await assert.rejects(() => readFile(expectedPath));
  const launch = await f.app.inject({ method: "GET", url: `/api/builds/${build.id}/router-launch/preview`, headers: f.auth }); assert.equal(launch.statusCode, 200); assert.equal(launch.json().artifact.resource.locator, expectedPath); assert.equal(launch.json().command.args.includes(expectedPath), true); await assert.rejects(() => readFile(expectedPath));
  const generated = await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/router-preset/generate`, headers: f.auth }); assert.equal(generated.statusCode, 200); assert.equal(generated.json().artifact.freshness, "current"); assert.equal((await readFile(expectedPath)).toString(), preview.json().content);
  assert.equal((await f.app.inject({ method: "POST", url: `/api/builds/${build.id}/router-preset/generate`, headers: f.auth, payload: { content: "forged" } })).statusCode, 400);
  await writeFile(expectedPath, `${preview.json().content}# manual edit\n`); const stale = await f.app.inject({ method: "GET", url: `/api/builds/${build.id}/router-preset/preview`, headers: f.auth }); assert.equal(stale.json().artifact.freshness, "stale"); assert.equal((await loadPhase15Domain(f.dir)).configuredModels[0]!.id, model.id);
});

test("domain mutations serialize and failed atomic rename preserves bytes", async (t) => {
  const f = await fixture(t); const seed = await mutatePhase15Domain((s) => { const a = findOrRegisterLocalArtifactInSnapshot(s, f.model, { kind: "model", referenceStatus: "available" }); const b = findOrRegisterLegacyBuildInSnapshot(s, f.server, "available"); return { a, b }; }, f.dir); const input = { displayName: "Concurrent", artifactId: seed.result.a.id, buildId: seed.result.b.id, enabled: false } as any;
  const results = await Promise.all([mutatePhase15Domain((s) => createConfiguredModelInSnapshot(s, { ...input, displayName: "A" }), f.dir), mutatePhase15Domain((s) => createConfiguredModelInSnapshot(s, { ...input, displayName: "B" }), f.dir)]); assert.equal((await loadPhase15Domain(f.dir)).configuredModels.length, 2); assert.equal(results.length, 2);
  const sameAlias = await Promise.allSettled([mutatePhase15Domain((s) => createConfiguredModelInSnapshot(s, { ...input, displayName: "C", routerAlias: "same-alias" }), f.dir), mutatePhase15Domain((s) => createConfiguredModelInSnapshot(s, { ...input, displayName: "D", routerAlias: "same-alias" }), f.dir)]); assert.equal(sameAlias.filter((result) => result.status === "fulfilled").length, 1);
  const before = await readFile(path.join(f.dir, "phase15-domain.json")); await assert.rejects(() => mutatePhase15Domain((s) => { s.builds[0]!.displayName = "lost"; }, f.dir, { rename: async () => { throw new Error("rename failed"); } })); assert.deepEqual(await readFile(path.join(f.dir, "phase15-domain.json")), before); validatePhase15DomainSnapshot(JSON.parse(before.toString()));
});
