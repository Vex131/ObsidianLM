import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  defaultRuntimeState,
  defaultSettings,
  type LlamaCppProfile,
} from "@obsidianlm/shared";
import {
  ensureStorageFiles,
  loadJobs,
  loadProfiles,
  loadRuntimeState,
  loadSettings,
  saveProfiles,
  saveRuntimeState,
  saveSettings,
} from "../src/config/storage.js";
import { createServer } from "../src/server.js";
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
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase11-"));
  const dataDir = path.join(root, "data");
  const logsDir = path.join(root, "logs");
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  process.env.OBSIDIANLM_DATA_DIR = dataDir;
  process.env.OBSIDIANLM_LOG_DIR = logsDir;
  delete process.env.OBSIDIANLM_LOGS_DIR;
  t.after(() => {
    setOrDeleteEnv("OBSIDIANLM_DATA_DIR", originalDataDir);
    setOrDeleteEnv("OBSIDIANLM_LOG_DIR", originalLogDir);
    setOrDeleteEnv("OBSIDIANLM_LOGS_DIR", originalLogsDir);
  });
  return { root, dataDir, logsDir };
}
async function configureRuntime(t: TestContext) {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const profile: LlamaCppProfile = {
    id: "local-test-runtime",
    name: "Local test runtime",
    runtimeType: "llama.cpp",
    providerKind: "server",
    buildPath: path.join(fixture.root, "llama-server.exe"),
    modelPath: path.join(fixture.root, "model.gguf"),
    host: "0.0.0.0",
    port: 8085,
  };
  await saveSettings({ ...defaultSettings });
  await saveProfiles([profile]);
  await saveRuntimeState({
    ...defaultRuntimeState,
    activeRuntimeId: "runtime-test",
    activeProfileId: profile.id,
    port: profile.port,
    status: "running",
    startedAt: new Date().toISOString(),
    startedByObsidianLM: true,
  });
  return { ...fixture, profile };
}
function installMockFetch(
  t: TestContext,
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}
test("runtime APIs work without credentials and preserve the no-inference diagnostic contract", async (t) => {
  await configureRuntime(t);
  const app = await createServer();
  t.after(async () => app.close());
  const health = await app.inject({
    method: "GET",
    url: "/api/runtime/health",
  });
  assert.equal(health.statusCode, 404);
  const chat = await app.inject({
    method: "POST",
    url: "/api/runtime/test-chat",
    payload: { prompt: "Say OK" },
  });
  assert.equal(chat.statusCode, 200);
  const diagnostic = await app.inject({
    method: "POST",
    url: "/api/runtime/test-chat",

    payload: { prompt: "Say OK" },
  });
  assert.equal(diagnostic.statusCode, 200);
  assert.equal(diagnostic.json().error, "router_model_selection_required");
  assert.match(diagnostic.json().message, /No inference request was sent/u);
});
test("runtime API exposes router state and strictly validates start/restart payloads", async (t) => {
  await configureRuntime(t);
  const app = await createServer();
  t.after(async () => app.close());
  const state = await app.inject({
    method: "GET",
    url: "/api/runtime",
  });
  assert.equal(state.statusCode, 200);
  assert.ok(state.json().state);
  assert.ok(state.json().routerState);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/runtime/start",

        payload: { buildId: "build-a", port: 9999 },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/runtime/restart",

        payload: { buildId: "build-a" },
      })
    ).statusCode,
    400,
  );
  for (const route of [
    "/api/runtime/switch-model",
    "/api/runtime/switch-build",
  ]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: route,
          payload: { configuredModelId: "model-a" },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: route,

          payload: { configuredModelId: "model-a", extra: true },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: route,

          payload: {},
        })
      ).statusCode,
      400,
    );
  }
});
test("runtime health and catalog report no current managed router without probing inference", async (t) => {
  await configureRuntime(t);
  const app = await createServer();
  t.after(async () => app.close());
  const health = await app.inject({
    method: "GET",
    url: "/api/runtime/health",
  });
  assert.equal(health.statusCode, 404);
  assert.equal(health.json().error, "not_running");
  const catalog = await app.inject({
    method: "GET",
    url: "/api/runtime/catalog",
  });
  assert.equal(catalog.statusCode, 404);
});
test("injected router start enables health/catalog APIs, while test-chat sends no inference", async (t) => {
  await configureRuntime(t);
  const child = new (class extends EventEmitter {
    pid = 9753;
    exitCode: number | null = null;
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    kill(signal: NodeJS.Signals) {
      this.exitCode = 0;
      this.emit("exit", 0, signal);
      return true;
    }
  })();
  let spawned = false;
  let healthCalls = 0;
  let modelCalls = 0;
  const artifact = {
    schemaVersion: 1 as const,
    authority: "derived" as const,
    buildId: "build-a" as `build_${string}`,
    resource: { owner: { scope: "local" as const }, locator: "router.ini" },
    generatorVersion: "test",
    sourceRevision: "revision",
    contentHash: "hash",
    freshness: "current" as const,
    validationState: "valid" as const,
    warnings: [],
    errors: [],
  };
  const app = await createServer({
    runtimeManagerOptions: {
      startupDetectorOptions: {
        processOptions: {
          platform: "linux",
          commandRunner: async () => {
            throw new Error("detector unavailable");
          },
        },
      },
      loadRouterState: async () => ({
        stateVersion: 1,
        activeRuntimeId: null,
        activeBuildId: null,
        pid: null,
        host: null,
        port: null,
        startedByObsidianLM: false,
        ownershipEvidence: "unproven",
        startedAt: null,
        commandHash: null,
        status: "stopped",
        health: { endpoint: "/health", state: "unknown" },
        configuredModelStates: [],
        warnings: [],
        errors: [],
        compatibilityProfileId: null,
      }),
      saveRouterState: async () => undefined,
      analyzePreset: async () =>
        ({ preview: { artifact, configuredModelIds: ["model-a"] } }) as any,
      buildLaunchPreview: async () => ({
        kind: "router_launch",
        command: {
          executable: "fixture-server",
          args: [
            "--host",
            "0.0.0.0",
            "--port",
            "8085",
            "--models-preset",
            "router.ini",
            "--models-max",
            "1",
            "--models-autoload",
          ],
          displayCommand:
            "fixture-server --host 0.0.0.0 --port 8085 --models-preset router.ini --models-max 1 --models-autoload",
          commandHash: "hash",
        },
        artifact,
        policy: { modelsMax: 1, modelsAutoload: true },
      }),
      loadDomain: async () =>
        ({
          configuredModels: [
            {
              id: "model-a",
              buildId: "build-a",
              enabled: true,
              routerAlias: "managed-model",
            },
          ],
        }) as any,
      portDetector: async (port, host = "127.0.0.1") => ({
        port,
        host,
        inUse: spawned && child.exitCode === null,
        ownerPid: spawned && child.exitCode === null ? child.pid : null,
        detectionMethod: "test",
        warnings: [],
      }),
      spawnRuntime: (() => {
        spawned = true;
        return child as any;
      }) as any,
      routerClient: {
        health: async () => {
          healthCalls += 1;
        },
        models: async () => {
          modelCalls += 1;
          return [{ id: "managed-model", status: "unloaded" }];
        },
        loadModel: async () => undefined,
      },
      sleep: async () => undefined,
      dataDir: () => process.env.OBSIDIANLM_DATA_DIR!,
      mkdir: async () => undefined,
    },
  });
  t.after(async () => app.close());
  const startedWithoutCredentials = await app.inject({
    method: "POST",
    url: "/api/runtime/start",
    payload: { buildId: "build-a" },
  });
  assert.equal(startedWithoutCredentials.statusCode, 200);
  const started = await app.inject({
    method: "POST",
    url: "/api/runtime/start",

    payload: { buildId: "build-a" },
  });
  assert.equal(started.statusCode, 409);
  const activeRuntimePort = await app.inject({
    method: "PATCH",
    url: "/api/settings/runtime",

    payload: { managedLlamaPort: 18080 },
  });
  assert.equal(activeRuntimePort.statusCode, 409);
  const health = await app.inject({
    method: "GET",
    url: "/api/runtime/health",
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().status, "healthy");
  const catalog = await app.inject({
    method: "GET",
    url: "/api/runtime/catalog",
  });
  assert.equal(catalog.statusCode, 200);
  assert.equal(catalog.json().catalog.entries[0].state, "unloaded");
  const chat = await app.inject({
    method: "POST",
    url: "/api/runtime/test-chat",

    payload: { prompt: "hello" },
  });
  assert.equal(chat.statusCode, 200);
  assert.equal(chat.json().error, "router_model_selection_required");
  assert.equal(healthCalls >= 2, true);
  assert.equal(modelCalls >= 2, true);
});
test("malformed JSON files are backed up, defaulted, and surfaced through status", async (t) => {
  const fixture = await makeFixture(t);
  for (const fileName of [
    "settings.json",
    "profiles.json",
    "runtime-state.json",
    "jobs.json",
  ]) {
    await writeFile(
      path.join(fixture.dataDir, fileName),
      "{ invalid json",
      "utf8",
    );
  }
  await ensureStorageFiles();
  assert.deepEqual(await loadProfiles(), []);
  assert.deepEqual(await loadRuntimeState(), defaultRuntimeState);
  assert.deepEqual(await loadJobs(), []);
  assert.equal((await loadSettings()).uiPort, defaultSettings.uiPort);
  const files = await readdir(fixture.dataDir);
  for (const fileName of [
    "settings.json",
    "profiles.json",
    "runtime-state.json",
    "jobs.json",
  ]) {
    assert.ok(
      files.some(
        (candidate) =>
          candidate.startsWith(`${fileName}.invalid-`) &&
          candidate.endsWith(".bak"),
      ),
      `${fileName} backup missing`,
    );
  }
  const app = await createServer();
  t.after(async () => app.close());
  const status = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(status.statusCode, 200);
  assert.match(
    status.json().warnings.join("\n"),
    /settings\.json was invalid JSON/u,
  );
});
test("saveRuntimeState writes atomically without leaving temp files", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const state = {
    ...defaultRuntimeState,
    activeRuntimeId: "runtime-atomic",
    activeProfileId: "profile-atomic",
    status: "running" as const,
    port: 8085,
  };
  await saveRuntimeState(state);
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(fixture.dataDir, "runtime-state.json"), "utf8"),
    ),
    state,
  );
  const files = await readdir(fixture.dataDir);
  assert.equal(
    files.some(
      (fileName) =>
        fileName.startsWith("runtime-state.json.") && fileName.endsWith(".tmp"),
    ),
    false,
  );
});
