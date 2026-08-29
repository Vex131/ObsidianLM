import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { defaultSettings, type RuntimeProfile } from "@obsidianlm/shared";
import { hashAdminToken } from "../src/auth/admin-token.js";
import { ensureStorageFiles, saveProfiles, saveSettings } from "../src/config/storage.js";
import { mutatePhase15Domain } from "../src/config/phase15-domain.js";
import { discoverLlamaBuilds } from "../src/discovery/llama-builds.js";
import { discoverModels } from "../src/discovery/models.js";
import { registerStatusRoutes } from "../src/api/status.js";
import { createServer } from "../src/server.js";

const adminToken = "phase13-valid-admin-token";

function authHeader(token = adminToken): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

function setOrDeleteEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function makeFixture(t: TestContext) {
  const originalDataDir = process.env.OBSIDIANLM_DATA_DIR;
  const originalLogDir = process.env.OBSIDIANLM_LOG_DIR;
  const originalLogsDir = process.env.OBSIDIANLM_LOGS_DIR;
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase13-"));
  const dataDir = path.join(root, "data");
  const logsDir = path.join(root, "logs");
  const modelDir = path.join(root, "models");
  const buildDir = path.join(root, "llama", "build");
  const inputDir = path.join(root, "inputs");
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await mkdir(inputDir, { recursive: true });
  process.env.OBSIDIANLM_DATA_DIR = dataDir;
  process.env.OBSIDIANLM_LOG_DIR = logsDir;
  delete process.env.OBSIDIANLM_LOGS_DIR;
  t.after(() => {
    setOrDeleteEnv("OBSIDIANLM_DATA_DIR", originalDataDir);
    setOrDeleteEnv("OBSIDIANLM_LOG_DIR", originalLogDir);
    setOrDeleteEnv("OBSIDIANLM_LOGS_DIR", originalLogsDir);
  });
  return { root, dataDir, logsDir, modelDir, buildDir, inputDir };
}

function gpuUnavailableOptions() {
  return {
    commandRunner: async () => {
      throw Object.assign(new Error("nvidia-smi unavailable in test"), { code: "ENOENT" });
    }
  };
}

async function createReadinessServer(t: TestContext) {
  const app = await createServer({ gpuMonitorOptions: gpuUnavailableOptions() });
  t.after(async () => app.close());
  return app;
}

async function createPhase15ReadinessFixture(t: TestContext, options: { configuredModel: boolean; eligibleBuild: boolean }) {
  const fixture = await makeFixture(t);
  const modelPath = path.join(fixture.modelDir, "configured.gguf");
  const serverPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  await Promise.all([writeFile(modelPath, "model", "utf8"), writeFile(serverPath, "server", "utf8")]);
  await ensureStorageFiles();
  await saveProfiles([]);
  await saveSettings({ ...defaultSettings, modelFolders: [fixture.modelDir], llamaCppFolders: [path.join(fixture.root, "llama")], adminTokenHash: await hashAdminToken(adminToken), managedLlamaPort: 18093 });
  const app = await createReadinessServer(t);
  const auth = authHeader();
  const models = await discoverModels();
  const builds = await discoverLlamaBuilds();
  const artifact = (await app.inject({ method: "POST", url: "/api/model-artifacts/register", headers: auth, payload: { discoveryId: models.models[0]!.id } })).json().artifact;
  const build = (await app.inject({ method: "POST", url: "/api/builds/register", headers: auth, payload: { discoveryId: builds.builds[0]!.id } })).json().build;
  if (options.configuredModel) {
    const created = await app.inject({ method: "POST", url: "/api/configured-models", headers: auth, payload: { displayName: "Configured", artifactId: artifact.id, buildId: build.id, enabled: true } });
    assert.equal(created.statusCode, 201);
  }
  if (options.eligibleBuild) {
    await mutatePhase15Domain((snapshot) => {
      const registered = snapshot.builds.find((entry) => entry.id === build.id)!;
      registered.serverFingerprint = "phase13-test";
      registered.managedInferenceEligibility = "eligible";
      registered.functionalEvidence = { kind: "functional", state: "eligible", validationProtocolVersion: 1, serverFingerprint: "phase13-test", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] };
    });
  }
  return { app, auth };
}

test("readiness is setup-protected before admin token setup and reports fresh empty state after setup", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  const app = await createReadinessServer(t);

  const beforeSetup = await app.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(beforeSetup.statusCode, 423);

  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);

  const response = await app.inject({ method: "GET", url: "/api/readiness", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.equal(body.configured.adminToken, true);
  assert.deepEqual(body.counts, { registeredArtifacts: 0, configuredModels: 0, registeredBuilds: 0, eligibleBuilds: 0, ggufModels: 0, serverBuilds: 0, llamaBenchTools: 0, llamaPerplexityTools: 0, toolInputs: 0, profiles: 0 });
  assert.ok(body.blockingChecks.some((item: { id: string }) => item.id === "gguf-models"));
  assert.ok(body.nextActions.length > 0);
});

test("readiness summarizes partially configured discovery without exposing local paths", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  await saveSettings({
    ...defaultSettings,
    modelFolders: [path.join(fixture.root, "missing-models")],
    llamaCppFolders: [fixture.buildDir],
    toolInputFolders: [],
    adminTokenHash: await hashAdminToken(adminToken),
    managedLlamaPort: 18091
  });
  await writeFile(path.join(fixture.buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server"), "fake server", "utf8");
  const app = await createReadinessServer(t);

  const response = await app.inject({ method: "GET", url: "/api/readiness", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const bodyText = response.body;
  const body = response.json();
  assert.equal(body.configured.modelFolders, true);
  assert.equal(body.counts.ggufModels, 0);
  assert.equal(body.counts.serverBuilds, 1);
  assert.equal(body.configured.toolInputFolders, false);
  assert.doesNotMatch(bodyText, new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"));
});

test("readiness reports ready-ish discovered counts from temp folders", async (t) => {
  const fixture = await makeFixture(t);
  const modelPath = path.join(fixture.modelDir, "Tiny-Q4_K_M.gguf");
  const serverPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const benchPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-bench.exe" : "llama-bench");
  const perplexityPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-perplexity.exe" : "llama-perplexity");
  const datasetPath = path.join(fixture.inputDir, "sample.txt");
  await writeFile(modelPath, "fake model", "utf8");
  await writeFile(serverPath, "fake server", "utf8");
  await writeFile(benchPath, "fake bench", "utf8");
  await writeFile(perplexityPath, "fake perplexity", "utf8");
  await writeFile(datasetPath, "hello", "utf8");
  await ensureStorageFiles();
  await saveSettings({
    ...defaultSettings,
    modelFolders: [fixture.modelDir],
    llamaCppFolders: [path.join(fixture.root, "llama")],
    toolInputFolders: [fixture.inputDir],
    adminTokenHash: await hashAdminToken(adminToken),
    managedLlamaPort: 18092
  });
  await saveProfiles([
    {
      id: "tiny-profile",
      name: "Tiny Profile",
      runtimeType: "llama.cpp",
      providerKind: "server",
      buildPath: serverPath,
      modelPath,
      host: "127.0.0.1",
      port: 18095,
      llamaArgs: { ctxSize: 512 },
      extraArgs: []
    } satisfies RuntimeProfile
  ]);
  const app = await createReadinessServer(t);

  const response = await app.inject({ method: "GET", url: "/api/readiness", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.counts, { registeredArtifacts: 1, configuredModels: 1, registeredBuilds: 1, eligibleBuilds: 0, ggufModels: 1, serverBuilds: 1, llamaBenchTools: 1, llamaPerplexityTools: 1, toolInputs: 1, profiles: 1 });
  assert.ok(body.blockingChecks.some((item: { id: string }) => item.id === "eligible-builds"));
  assert.equal(body.runtime.active, false);
  assert.equal(body.runtime.health, "inactive");
  assert.equal(body.runtime.routerHealth, "unknown");
  assert.equal(body.gpu.available, false);
});

test("startup fails safely on malformed profile storage without exposing raw paths", async (t) => {
  const fixture = await makeFixture(t);
  await writeFile(path.join(fixture.dataDir, "settings.json"), `${JSON.stringify({ ...defaultSettings, adminTokenHash: await hashAdminToken(adminToken) }, null, 2)}\n`, "utf8");
  await writeFile(path.join(fixture.dataDir, "profiles.json"), "{ invalid json", "utf8");
  await assert.rejects(() => createReadinessServer(t), (error: Error) => {
    assert.match(error.message, /profiles\.json is invalid JSON/u);
    assert.doesNotMatch(error.message, new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"));
    return true;
  });
  assert.equal(await readFile(path.join(fixture.dataDir, "profiles.json"), "utf8"), "{ invalid json");
  assert.ok((await readdir(fixture.dataDir)).some((file) => /^profiles\.json\.phase15-.*\.bak$/u.test(file)));
});

test("readiness does not repair or back up storage files during the request", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, adminTokenHash: await hashAdminToken(adminToken) });
  const app = await createReadinessServer(t);
  const profilesPath = path.join(fixture.dataDir, "profiles.json");
  await writeFile(profilesPath, "{ invalid json", "utf8");

  const response = await app.inject({ method: "GET", url: "/api/readiness", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().counts.profiles, 0);
  assert.equal(await readFile(profilesPath, "utf8"), "{ invalid json");
  const files = await readdir(fixture.dataDir);
  assert.equal(files.some((file) => file.startsWith("profiles.json.invalid-")), false);
});

test("readiness requires auth after admin setup", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, adminTokenHash: await hashAdminToken(adminToken) });
  const app = await createReadinessServer(t);

  const noToken = await app.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(noToken.statusCode, 401);
  const badToken = await app.inject({ method: "GET", url: "/api/readiness", headers: authHeader("wrong-token") });
  assert.ok([401, 403].includes(badToken.statusCode));
  const goodToken = await app.inject({ method: "GET", url: "/api/readiness", headers: authHeader() });
  assert.equal(goodToken.statusCode, 200);
});

test("status uses router identity without a compatibility Profile", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const app = Fastify();
  t.after(() => app.close());
  await registerStatusRoutes(app, {
    getRouterState: () => ({ activeRuntimeId: "router_test", activeBuildId: "build_test", pid: 4321, port: 19001, status: "running", compatibilityProfileId: null }),
    getDetectionSummary: () => ({ categories: [], warnings: [], actions: [], processes: [], ports: [], previousState: null, checkedAt: "2026-08-29T00:00:00.000Z" }),
    getGpuStatusSnapshot: () => null,
    refreshDetection: async () => { throw new Error("status must not refresh detection"); },
    refreshProcessAwareness: async () => { throw new Error("status must not enumerate processes"); },
    getWarnings: () => []
  } as any);
  const response = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.activeRuntime, { runtimeId: "router_test", buildId: "build_test", type: "llama.cpp", status: "running", pid: 4321, profileId: null, profileName: null, apiUrl: "http://localhost:19001/v1" });
  assert.doesNotMatch(response.body, new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"));
});

test("readiness accepts a valid Phase 15 domain with zero Profiles", async (t) => {
  const { app, auth } = await createPhase15ReadinessFixture(t, { configuredModel: true, eligibleBuild: true });
  const response = await app.inject({ method: "GET", url: "/api/readiness", headers: auth });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.deepEqual({ configuredModels: body.counts.configuredModels, registeredBuilds: body.counts.registeredBuilds, eligibleBuilds: body.counts.eligibleBuilds, profiles: body.counts.profiles }, { configuredModels: 1, registeredBuilds: 1, eligibleBuilds: 1, profiles: 0 });
  assert.deepEqual({ runtimeId: body.runtime.runtimeId, buildId: body.runtime.buildId, loadedConfiguredModelIds: body.runtime.loadedConfiguredModelIds, health: body.runtime.health, routerHealth: body.runtime.routerHealth }, { runtimeId: null, buildId: null, loadedConfiguredModelIds: [], health: "inactive", routerHealth: "unknown" });
  assert.equal(body.blockingChecks.some((item: { id: string }) => item.id === "profiles"), false);
});

test("readiness blocks missing configured models and ineligible Builds", async (t) => {
  const missingModel = await createPhase15ReadinessFixture(t, { configuredModel: false, eligibleBuild: true });
  const missingModelResponse = await missingModel.app.inject({ method: "GET", url: "/api/readiness", headers: missingModel.auth });
  assert.ok(missingModelResponse.json().blockingChecks.some((item: { id: string }) => item.id === "configured-models"));

  const ineligibleBuild = await createPhase15ReadinessFixture(t, { configuredModel: true, eligibleBuild: false });
  const ineligibleBuildResponse = await ineligibleBuild.app.inject({ method: "GET", url: "/api/readiness", headers: ineligibleBuild.auth });
  assert.ok(ineligibleBuildResponse.json().blockingChecks.some((item: { id: string }) => item.id === "eligible-builds"));
});
