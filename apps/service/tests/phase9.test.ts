import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import { defaultSettings } from "@obsidianlm/shared";
import { hashAdminToken, verifyAdminTokenHash } from "../src/auth/admin-token.js";
import { registerAdminAuthProtection } from "../src/auth/protect.js";
import { registerAuthRoutes } from "../src/api/auth.js";
import { registerRuntimeRoutes } from "../src/api/runtime.js";
import { registerSettingsRoutes } from "../src/api/settings.js";
import { createServer } from "../src/server.js";
import { ensureStorageFiles, loadSettings } from "../src/config/storage.js";
import { RuntimeLogBuffer } from "../src/runtime/log-buffer.js";
import { RuntimeManager } from "../src/runtime/manager.js";

const validToken = "phase9-valid-admin-token";
const invalidToken = "phase9-invalid-admin-token";

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
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase9-"));
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

function authHeader(token = validToken): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function writeLegacySettings(dataDir: string, settings: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(dataDir, "settings.json"), `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function createConfiguredServer(t: TestContext) {
  await makeFixture(t);
  await ensureStorageFiles();
  const hash = await hashAdminToken(validToken);
  await writeLegacySettings(process.env.OBSIDIANLM_DATA_DIR!, { ...defaultSettings, adminTokenHash: hash });
  const app = await createServer();
  t.after(async () => app.close());
  return app;
}

async function createRuntimeLogsApp(t: TestContext, configured: boolean) {
  await makeFixture(t);
  await ensureStorageFiles();
  if (configured) {
    const hash = await hashAdminToken(validToken);
    await writeLegacySettings(process.env.OBSIDIANLM_DATA_DIR!, { ...defaultSettings, adminTokenHash: hash });
  }
  const logs = new RuntimeLogBuffer();
  const manager = new RuntimeManager(logs);
  const app = fastify({ logger: false });
  await registerAuthRoutes(app);
  await registerAdminAuthProtection(app);
  await registerRuntimeRoutes(app, manager);
  t.after(async () => app.close());
  return { app, logs };
}

test("default settings normalize adminTokenHash safely for old settings", async (t) => {
  const fixture = await makeFixture(t);
  await writeLegacySettings(fixture.dataDir, {
    uiPort: 11338,
    managedLlamaPort: 8080,
    startupMode: "service_only",
    staleProcessPolicy: "auto_stop_previous_managed_only",
    modelFolders: ["models", 1, null],
    llamaCppFolders: "not-an-array",
    adminTokenHash: "old-raw-token-value"
  });

  const settings = await loadSettings();

  assert.equal(settings.adminTokenHash, null);
  assert.deepEqual(settings.modelFolders, ["models"]);
  assert.deepEqual(settings.llamaCppFolders, []);
});

test("auth setup stores only a hash and verifies valid and invalid tokens", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const app = await createServer();
  t.after(async () => app.close());

  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: validToken } });
  assert.equal(setup.statusCode, 201);

  const storedText = await readFile(path.join(fixture.dataDir, "settings.json"), "utf8");
  assert.equal(storedText.includes(validToken), false);
  const settings = JSON.parse(storedText) as { adminTokenHash?: string | null };
  assert.match(settings.adminTokenHash ?? "", /^scrypt:v1:/u);
  assert.equal(await verifyAdminTokenHash(validToken, settings.adminTokenHash), true);
  assert.equal(await verifyAdminTokenHash(invalidToken, settings.adminTokenHash), false);

  const valid = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: validToken } });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.json().ok, true);

  const invalid = await app.inject({ method: "POST", url: "/api/auth/verify", payload: { token: invalidToken } });
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.json().ok, false);
});

test("auth setup is rejected after already configured", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  const app = await createServer();
  t.after(async () => app.close());

  const first = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: validToken } });
  const second = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: "another-valid-admin-token" } });

  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error, "auth_already_configured");
});

test("concurrent auth setup allows only one winning admin token", async (t) => {
  const fixture = await makeFixture(t);
  await ensureStorageFiles();
  const app = await createServer();
  t.after(async () => app.close());

  const firstToken = "phase9-concurrent-token-one";
  const secondToken = "phase9-concurrent-token-two";
  const [first, second] = await Promise.all([
    app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: firstToken } }),
    app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: secondToken } })
  ]);

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [201, 409]);
  const settings = JSON.parse(await readFile(path.join(fixture.dataDir, "settings.json"), "utf8")) as { adminTokenHash?: string | null };
  const firstVerifies = await verifyAdminTokenHash(firstToken, settings.adminTokenHash);
  const secondVerifies = await verifyAdminTokenHash(secondToken, settings.adminTokenHash);
  assert.equal(Number(firstVerifies) + Number(secondVerifies), 1);
});

test("configured auth protects routes while status and auth status remain public", async (t) => {
  const app = await createConfiguredServer(t);

  const noToken = await app.inject({ method: "GET", url: "/api/settings" });
  assert.equal(noToken.statusCode, 401);

  const badToken = await app.inject({ method: "GET", url: "/api/settings", headers: authHeader(invalidToken) });
  assert.ok([401, 403].includes(badToken.statusCode));

  const goodToken = await app.inject({ method: "GET", url: "/api/settings", headers: authHeader() });
  assert.equal(goodToken.statusCode, 200);
  assert.equal(goodToken.json().settings.adminTokenHash, null);

  const status = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(status.statusCode, 200);

  const authStatus = await app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(authStatus.statusCode, 200);
  assert.equal(authStatus.json().configured, true);
});

test("future api routes default to protected after the auth hook", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  const hash = await hashAdminToken(validToken);
  await writeLegacySettings(process.env.OBSIDIANLM_DATA_DIR!, { ...defaultSettings, adminTokenHash: hash });
  const app = fastify({ logger: false });
  await registerAdminAuthProtection(app);
  app.post("/api/future-control", async () => ({ ok: true }));
  t.after(async () => app.close());

  const noToken = await app.inject({ method: "POST", url: "/api/future-control" });
  assert.equal(noToken.statusCode, 401);

  const goodToken = await app.inject({ method: "POST", url: "/api/future-control", headers: authHeader() });
  assert.equal(goodToken.statusCode, 200);
  assert.equal(goodToken.json().ok, true);
});

test("POST /api/auth/setup works only before configuration", async (t) => {
  await makeFixture(t);
  await ensureStorageFiles();
  const app = await createServer();
  t.after(async () => app.close());

  const statusBefore = await app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(statusBefore.statusCode, 200);
  assert.equal(statusBefore.json().configured, false);

  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: validToken } });
  assert.equal(setup.statusCode, 201);

  const setupAgain = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: "another-valid-admin-token" } });
  assert.equal(setupAgain.statusCode, 409);
});

test("runtime logs routes require auth once configured", async (t) => {
  const { app } = await createRuntimeLogsApp(t, true);

  const logsNoToken = await app.inject({ method: "GET", url: "/api/runtime/logs" });
  assert.equal(logsNoToken.statusCode, 401);

  const logsBadToken = await app.inject({ method: "GET", url: "/api/runtime/logs", headers: authHeader(invalidToken) });
  assert.ok([401, 403].includes(logsBadToken.statusCode));

  const logsGoodToken = await app.inject({ method: "GET", url: "/api/runtime/logs", headers: authHeader() });
  assert.equal(logsGoodToken.statusCode, 200);
  assert.deepEqual(logsGoodToken.json().logs, []);
});

test("runtime log stream requires auth and unauthenticated attempts do not subscribe listeners", async (t) => {
  const { app, logs } = await createRuntimeLogsApp(t, true);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;
  assert.ok(address);

  const response = await fetch(`http://127.0.0.1:${address.port}/api/runtime/logs/stream?limit=1`);

  assert.equal(response.status, 401);
  assert.equal(await response.text().then((text) => text.includes("unauthorized")), true);
  assert.equal((logs as unknown as { listeners: Set<unknown> }).listeners.size, 0);
});

test("authenticated runtime log stream sends valid SSE headers and events", async (t) => {
  const { app, logs } = await createRuntimeLogsApp(t, true);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;
  assert.ok(address);

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/runtime/logs/stream?limit=1`, {
    headers: authHeader(),
    signal: controller.signal
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type")?.startsWith("text/event-stream"), true);
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");

  const reader = response.body?.getReader();
  assert.ok(reader);
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  const text = new TextDecoder().decode(firstChunk.value);
  assert.match(text, /event: connection\ndata: \{"ok":true,"state":/u);

  logs.add("stdout", "authenticated stream line");
  let streamText = text;
  const deadline = Date.now() + 1000;
  while (!streamText.includes("authenticated stream line") && Date.now() < deadline) {
    const nextChunk = await reader.read();
    assert.equal(nextChunk.done, false);
    streamText += new TextDecoder().decode(nextChunk.value);
  }
  assert.match(streamText, /event: log\ndata: .*authenticated stream line/u);

  controller.abort();
  try {
    await reader.cancel();
  } catch {
    // The abort may already have closed the stream.
  }
});
