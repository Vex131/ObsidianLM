import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import Fastify from "fastify";
import { defaultSettings, type RuntimeProfile } from "@obsidianlm/shared";
import {
  ensureStorageFiles,
  saveProfiles,
  saveSettings,
} from "../src/config/storage.js";
import { mutatePhase15Domain } from "../src/config/phase15-domain.js";
import { discoverLlamaBuilds } from "../src/discovery/llama-builds.js";
import { discoverModels } from "../src/discovery/models.js";
import { registerStatusRoutes } from "../src/api/status.js";
import { createServer } from "../src/server.js";
const u32 = (value: number) => { const out = Buffer.alloc(4); out.writeUInt32LE(value); return out; };
const u64 = (value: bigint) => { const out = Buffer.alloc(8); out.writeBigUInt64LE(value); return out; };
const ggufText = (value: string) => Buffer.concat([u64(BigInt(Buffer.byteLength(value))), Buffer.from(value)]);
const ggufType = (value: string) => Buffer.concat([ggufText("general.type"), u32(8), ggufText(value)]);
const gguf = (type: string) => Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0n), u64(1n), ggufType(type)]);
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
      throw Object.assign(new Error("nvidia-smi unavailable in test"), {
        code: "ENOENT",
      });
    },
  };
}
async function createReadinessServer(t: TestContext) {
  const app = await createServer({
    gpuMonitorOptions: gpuUnavailableOptions(),
  });
  t.after(async () => app.close());
  return app;
}
async function createPhase15ReadinessFixture(
  t: TestContext,
  options: { configuredModel: boolean; eligibleBuild: boolean },
) {
  const fixture = await makeFixture(t);
  const modelPath = path.join(fixture.modelDir, "configured.gguf");
  const serverPath = path.join(
    fixture.buildDir,
    process.platform === "win32" ? "llama-server.exe" : "llama-server",
  );
  await Promise.all([
    writeFile(modelPath, "model", "utf8"),
    writeFile(serverPath, "server", "utf8"),
  ]);
  await ensureStorageFiles();
  await saveProfiles([]);
  await saveSettings({
    ...defaultSettings,
    modelFolders: [fixture.modelDir],
    llamaCppFolders: [path.join(fixture.root, "llama")],
    managedLlamaPort: 18093,
  });
  const app = await createReadinessServer(t);
  const models = await discoverModels();
  const builds = await discoverLlamaBuilds();
  const artifactResponse = await app.inject({
    method: "GET",
    url: "/api/model-artifacts",
  });
  const artifact = artifactResponse.json().artifacts[0];
  const buildResponse = await app.inject({ method: "GET", url: "/api/builds" });
  const build = buildResponse.json().builds[0];
  if (options.configuredModel) {
    const created = await app.inject({
      method: "POST",
      url: "/api/configured-models",

      payload: {
        displayName: "Configured",
        artifactId: artifact.id,
        buildId: build.id,
        enabled: true,
      },
    });
    assert.equal(created.statusCode, 201);
  }
  if (options.eligibleBuild) {
    await mutatePhase15Domain((snapshot) => {
      const registered = snapshot.builds.find(
        (entry) => entry.id === build.id,
      )!;
      registered.serverFingerprint = build.serverFingerprint;
      registered.managedInferenceEligibility = "eligible";
      registered.functionalEvidence = {
        kind: "functional",
        state: "eligible",
        validationProtocolVersion: 1,
        serverFingerprint: build.serverFingerprint,
        launchAttempted: true,
        presetAccepted: true,
        healthVerified: true,
        modelsVerified: true,
        catalogBoundaryVerified: true,
        requiredBehaviorVerified: true,
        warnings: [],
        failures: [],
      };
    });
  }
  return { app };
}
test("readiness is public and reports fresh empty state", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  const app = await createReadinessServer(t);
  const beforeSetup = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(beforeSetup.statusCode, 200);
  const response = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.counts, {
    discoveredArtifacts: 0,
    configuredModels: 0,
    discoveredBuilds: 0,
    eligibleBuilds: 0,
    ggufModels: 0,
    serverBuilds: 0,
    llamaBenchTools: 0,
    llamaPerplexityTools: 0,
    toolInputs: 0,
    profiles: 0,
  });
  assert.ok(
    body.blockingChecks.some(
      (item: { id: string }) => item.id === "gguf-models",
    ),
  );
  assert.ok(body.nextActions.length > 0);
});
test("readiness summarizes partially configured discovery without exposing local paths", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  await saveSettings({
    ...defaultSettings,
    modelFolders: [path.join(fixture.root, "missing-models")],
    llamaCppFolders: [path.dirname(fixture.buildDir)],
    toolInputFolders: [],
    managedLlamaPort: 18091,
  });
  await writeFile(
    path.join(
      fixture.buildDir,
      process.platform === "win32" ? "llama-server.exe" : "llama-server",
    ),
    "fake server",
    "utf8",
  );
  const app = await createReadinessServer(t);
  const response = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(response.statusCode, 200);
  const bodyText = response.body;
  const body = response.json();
  assert.equal(body.configured.modelFolders, true);
  assert.equal(body.counts.ggufModels, 0);
  assert.equal(body.counts.serverBuilds, 1);
  assert.equal(body.configured.toolInputFolders, false);
  assert.doesNotMatch(
    bodyText,
    new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"),
  );
});
test("readiness counts authoritative base artifacts and usable llama-server Builds", async (t) => {
  const fixture = await makeFixture(t);
  const server = path.join(fixture.buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const cli = path.join(fixture.buildDir, process.platform === "win32" ? "llama-cli.exe" : "llama-cli");
  await Promise.all([
    writeFile(path.join(fixture.modelDir, "base.gguf"), gguf("model")),
    writeFile(path.join(fixture.modelDir, "ambiguous-name.gguf"), gguf("projector")),
    writeFile(cli, "cli"),
  ]);
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, modelFolders: [fixture.modelDir], llamaCppFolders: [path.join(fixture.root, "llama")], managedLlamaPort: 18094 });
  const app = await createReadinessServer(t);
  const brokenOnly = await app.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(brokenOnly.statusCode, 200);
  let body = brokenOnly.json();
  assert.equal(body.counts.discoveredArtifacts, 2);
  assert.equal(body.counts.ggufModels, 1);
  assert.equal(body.counts.discoveredBuilds, 1);
  assert.equal(body.counts.serverBuilds, 0);
  assert.equal(body.checks.find((item: any) => item.id === "server-builds").status, "block");
  await writeFile(server, "server");
  const restored = await app.inject({ method: "GET", url: "/api/readiness" });
  assert.equal(restored.statusCode, 200);
  body = restored.json();
  assert.equal(body.counts.serverBuilds, 1);
  assert.equal(body.checks.find((item: any) => item.id === "server-builds").label, "Usable llama-server Builds");
  assert.equal(body.checks.find((item: any) => item.id === "server-builds").status, "pass");
});
test("readiness and Models reject a persisted base role contradicted by GGUF metadata", async (t) => {
  const fixture = await makeFixture(t);
  const modelPath = path.join(fixture.modelDir, "role-conflict.gguf");
  const serverPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  await Promise.all([writeFile(modelPath, "uninspected"), writeFile(serverPath, "server")]);
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, modelFolders: [fixture.modelDir], llamaCppFolders: [path.join(fixture.root, "llama")], managedLlamaPort: 18095 });
  const app = await createReadinessServer(t);
  const artifact = (await app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts[0];
  const build = (await app.inject({ method: "GET", url: "/api/builds" })).json().builds[0];
  assert.equal((await app.inject({ method: "PATCH", url: `/api/model-artifacts/${artifact.id}`, payload: { kind: "model" } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/configured-models", payload: { displayName: "Historical base", artifactId: artifact.id, buildId: build.id, enabled: true } })).statusCode, 201);

  await writeFile(modelPath, gguf("projector"));
  const readiness = (await app.inject({ method: "GET", url: "/api/readiness" })).json();
  assert.equal(readiness.counts.ggufModels, 0);
  const reconciled = (await app.inject({ method: "GET", url: "/api/model-artifacts" })).json().artifacts.find((entry: any) => entry.id === artifact.id);
  assert.equal(reconciled.kind, "model");
  assert.equal(reconciled.metadata.artifactKind, "mmproj");
  assert.equal(reconciled.role, "conflict");
  assert.equal(reconciled.selectionStatus, "invalid");
});
test("readiness reports ready-ish discovered counts from temp folders", async (t) => {
  const fixture = await makeFixture(t);
  const modelPath = path.join(fixture.modelDir, "Tiny-Q4_K_M.gguf");
  const serverPath = path.join(
    fixture.buildDir,
    process.platform === "win32" ? "llama-server.exe" : "llama-server",
  );
  const benchPath = path.join(
    fixture.buildDir,
    process.platform === "win32" ? "llama-bench.exe" : "llama-bench",
  );
  const perplexityPath = path.join(
    fixture.buildDir,
    process.platform === "win32" ? "llama-perplexity.exe" : "llama-perplexity",
  );
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
    managedLlamaPort: 18092,
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
      extraArgs: [],
    } satisfies RuntimeProfile,
  ]);
  const app = await createReadinessServer(t);
  const response = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, false);
  assert.deepEqual(body.counts, {
    discoveredArtifacts: 1,
    configuredModels: 1,
    discoveredBuilds: 1,
    eligibleBuilds: 0,
    ggufModels: 1,
    serverBuilds: 1,
    llamaBenchTools: 1,
    llamaPerplexityTools: 1,
    toolInputs: 1,
    profiles: 1,
  });
  assert.ok(
    body.blockingChecks.some(
      (item: { id: string }) => item.id === "eligible-builds",
    ),
  );
  assert.equal(body.runtime.active, false);
  assert.equal(body.runtime.health, "inactive");
  assert.equal(body.runtime.routerHealth, "unknown");
  assert.equal(body.gpu.available, false);
});
test("startup fails safely on malformed profile storage without exposing raw paths", async (t) => {
  const fixture = await makeFixture(t);
  await writeFile(
    path.join(fixture.dataDir, "settings.json"),
    `${JSON.stringify({ ...defaultSettings }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(fixture.dataDir, "profiles.json"),
    "{ invalid json",
    "utf8",
  );
  await assert.rejects(
    () => createReadinessServer(t),
    (error: Error) => {
      assert.match(error.message, /profiles\.json is invalid JSON/u);
      assert.doesNotMatch(
        error.message,
        new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"),
      );
      return true;
    },
  );
  assert.equal(
    await readFile(path.join(fixture.dataDir, "profiles.json"), "utf8"),
    "{ invalid json",
  );
  assert.ok(
    (await readdir(fixture.dataDir)).some((file) =>
      /^profiles\.json\.phase15-.*\.bak$/u.test(file),
    ),
  );
});
test("readiness does not repair or back up storage files during the request", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings });
  const app = await createReadinessServer(t);
  const profilesPath = path.join(fixture.dataDir, "profiles.json");
  await writeFile(profilesPath, "{ invalid json", "utf8");
  const response = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().counts.profiles, 0);
  assert.equal(await readFile(profilesPath, "utf8"), "{ invalid json");
  const files = await readdir(fixture.dataDir);
  assert.equal(
    files.some((file) => file.startsWith("profiles.json.invalid-")),
    false,
  );
});
test("readiness works without credentials", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings });
  const app = await createReadinessServer(t);
  const response = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(response.statusCode, 200);
});
test("status uses router identity without a compatibility Profile", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const app = Fastify();
  t.after(() => app.close());
  await registerStatusRoutes(app, {
    getRouterState: () => ({
      activeRuntimeId: "router_test",
      activeBuildId: "build_test",
      pid: 4321,
      port: 19001,
      status: "running",
      compatibilityProfileId: null,
    }),
    getDetectionSummary: () => ({
      categories: [],
      warnings: [],
      actions: [],
      processes: [],
      ports: [],
      previousState: null,
      checkedAt: "2026-08-29T00:00:00.000Z",
    }),
    getGpuStatusSnapshot: () => null,
    refreshDetection: async () => {
      throw new Error("status must not refresh detection");
    },
    refreshProcessAwareness: async () => {
      throw new Error("status must not enumerate processes");
    },
    getWarnings: () => [],
  } as any);
  const response = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.activeRuntime, {
    runtimeId: "router_test",
    buildId: "build_test",
    type: "llama.cpp",
    status: "running",
    pid: 4321,
    profileId: null,
    profileName: null,
    apiUrl: "http://localhost:19001/v1",
  });
  assert.doesNotMatch(
    response.body,
    new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"),
  );
});
test("readiness accepts a valid Phase 15 domain with zero Profiles", async (t) => {
  const { app } = await createPhase15ReadinessFixture(t, {
    configuredModel: true,
    eligibleBuild: true,
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(
    {
      configuredModels: body.counts.configuredModels,
      discoveredBuilds: body.counts.discoveredBuilds,
      eligibleBuilds: body.counts.eligibleBuilds,
      profiles: body.counts.profiles,
    },
    {
      configuredModels: 1,
      discoveredBuilds: 1,
      eligibleBuilds: 1,
      profiles: 0,
    },
  );
  assert.deepEqual(
    {
      runtimeId: body.runtime.runtimeId,
      buildId: body.runtime.buildId,
      loadedConfiguredModelIds: body.runtime.loadedConfiguredModelIds,
      health: body.runtime.health,
      routerHealth: body.runtime.routerHealth,
    },
    {
      runtimeId: null,
      buildId: null,
      loadedConfiguredModelIds: [],
      health: "inactive",
      routerHealth: "unknown",
    },
  );
  assert.equal(
    body.blockingChecks.some((item: { id: string }) => item.id === "profiles"),
    false,
  );
});
test("readiness blocks missing configured models and ineligible Builds", async (t) => {
  const missingModel = await createPhase15ReadinessFixture(t, {
    configuredModel: false,
    eligibleBuild: true,
  });
  const missingModelResponse = await missingModel.app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.ok(
    missingModelResponse
      .json()
      .blockingChecks.some(
        (item: { id: string }) => item.id === "configured-models",
      ),
  );
  const ineligibleBuild = await createPhase15ReadinessFixture(t, {
    configuredModel: true,
    eligibleBuild: false,
  });
  const ineligibleBuildResponse = await ineligibleBuild.app.inject({
    method: "GET",
    url: "/api/readiness",
  });
  assert.ok(
    ineligibleBuildResponse
      .json()
      .blockingChecks.some(
        (item: { id: string }) => item.id === "eligible-builds",
      ),
  );
});
