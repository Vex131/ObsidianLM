import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { defaultRuntimeState, defaultSettings, type LlamaCppProfile } from "@obsidianlm/shared";
import { hashAdminToken } from "../src/auth/admin-token.js";
import { ensureStorageFiles, loadJobs, loadProfiles, loadRuntimeState, loadSettings, saveProfiles, saveRuntimeState, saveSettings } from "../src/config/storage.js";
import { createServer } from "../src/server.js";

const adminToken = "phase11-valid-admin-token";

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
    port: 8085
  };
  await saveSettings({ ...defaultSettings, adminTokenHash: await hashAdminToken(adminToken) });
  await saveProfiles([profile]);
  await saveRuntimeState({ ...defaultRuntimeState, activeRuntimeId: "runtime-test", activeProfileId: profile.id, port: profile.port, status: "running", startedAt: new Date().toISOString(), startedByObsidianLM: true });
  return { ...fixture, profile };
}

function installMockFetch(t: TestContext, handler: (url: string, init?: RequestInit) => Promise<Response> | Response): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => handler(String(input), init)) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

test("runtime health and test chat routes are protected after auth setup", async (t) => {
  await configureRuntime(t);
  installMockFetch(t, (url) => {
    if (url.endsWith("/models")) {
      return Response.json({ data: [] });
    }
    return Response.json({ choices: [{ message: { content: "OK" } }] });
  });
  const app = await createServer();
  t.after(async () => app.close());

  for (const route of [
    { method: "GET", url: "/api/runtime/health" },
    { method: "POST", url: "/api/runtime/test-chat" }
  ] as const) {
    const noToken = await app.inject(route);
    assert.equal(noToken.statusCode, 401, `${route.method} ${route.url} without token`);
    const goodToken = await app.inject({ ...route, headers: authHeader() });
    assert.equal(goodToken.statusCode, 200, `${route.method} ${route.url} with token`);
  }
});

test("runtime health checks /v1/models with local host mapping", async (t) => {
  await configureRuntime(t);
  const calls: string[] = [];
  installMockFetch(t, (url) => {
    calls.push(url);
    return Response.json({ data: [{ id: "tiny" }] });
  });
  const app = await createServer();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/runtime/health", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().status, "healthy");
  assert.equal(response.json().endpoint, "http://127.0.0.1:8085/v1");
  assert.equal(response.json().modelsCount, 1);
  assert.deepEqual(calls, ["http://127.0.0.1:8085/v1/models"]);
});

test("runtime test chat bounds request body and returns preview", async (t) => {
  await configureRuntime(t);
  let capturedPromptLength = 0;
  let capturedMaxTokens = 0;
  installMockFetch(t, async (url, init) => {
    assert.equal(url, "http://127.0.0.1:8085/v1/chat/completions");
    const requestBody = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }>; max_tokens: number };
    capturedPromptLength = requestBody.messages[0]?.content.length ?? 0;
    capturedMaxTokens = requestBody.max_tokens;
    return Response.json({ choices: [{ message: { content: "OK. The runtime is responding." } }] });
  });
  const app = await createServer();
  t.after(async () => app.close());

  const response = await app.inject({ method: "POST", url: "/api/runtime/test-chat", headers: authHeader(), payload: { prompt: "x".repeat(900), maxTokens: 999, timeoutMs: 1 } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().ok, true);
  assert.equal(response.json().promptLength, 500);
  assert.equal(response.json().maxTokens, 64);
  assert.equal(response.json().responsePreview, "OK. The runtime is responding.");
  assert.equal(capturedPromptLength, 500);
  assert.equal(capturedMaxTokens, 64);
});

test("runtime diagnostics return safe timeout and network errors", async (t) => {
  await configureRuntime(t);
  installMockFetch(t, () => {
    const error = new Error("connect ENOENT C:\\private\\model.gguf");
    throw error;
  });
  const app = await createServer();
  t.after(async () => app.close());

  const health = await app.inject({ method: "GET", url: "/api/runtime/health", headers: authHeader() });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().ok, false);
  assert.equal(health.json().error, "runtime_unreachable");
  assert.doesNotMatch(JSON.stringify(health.json()), /private|model\.gguf/u);

  const chat = await app.inject({ method: "POST", url: "/api/runtime/test-chat", headers: authHeader(), payload: { prompt: "Say OK" } });
  assert.equal(chat.statusCode, 200);
  assert.equal(chat.json().ok, false);
  assert.equal(chat.json().error, "runtime_unreachable");
  assert.doesNotMatch(JSON.stringify(chat.json()), /private|model\.gguf/u);
});

test("malformed JSON files are backed up, defaulted, and surfaced through status", async (t) => {
  const fixture = await makeFixture(t);
  for (const fileName of ["settings.json", "profiles.json", "runtime-state.json", "jobs.json"]) {
    await writeFile(path.join(fixture.dataDir, fileName), "{ invalid json", "utf8");
  }

  await ensureStorageFiles();
  assert.deepEqual(await loadProfiles(), []);
  assert.deepEqual(await loadRuntimeState(), defaultRuntimeState);
  assert.deepEqual(await loadJobs(), []);
  assert.equal((await loadSettings()).uiPort, defaultSettings.uiPort);

  const files = await readdir(fixture.dataDir);
  for (const fileName of ["settings.json", "profiles.json", "runtime-state.json", "jobs.json"]) {
    assert.ok(files.some((candidate) => candidate.startsWith(`${fileName}.invalid-`) && candidate.endsWith(".bak")), `${fileName} backup missing`);
  }

  const app = await createServer();
  t.after(async () => app.close());
  const status = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(status.statusCode, 200);
  assert.match(status.json().warnings.join("\n"), /settings\.json was invalid JSON/u);
});

test("saveRuntimeState writes atomically without leaving temp files", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const state = { ...defaultRuntimeState, activeRuntimeId: "runtime-atomic", activeProfileId: "profile-atomic", status: "running" as const, port: 8085 };
  await saveRuntimeState(state);
  assert.deepEqual(JSON.parse(await readFile(path.join(fixture.dataDir, "runtime-state.json"), "utf8")), state);
  const files = await readdir(fixture.dataDir);
  assert.equal(files.some((fileName) => fileName.startsWith("runtime-state.json.") && fileName.endsWith(".tmp")), false);
});
