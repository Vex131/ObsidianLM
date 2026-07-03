import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import fastify from "fastify";
import type { LlamaCppProfile } from "@obsidianlm/shared";
import { createServer } from "../src/server.js";
import { registerProfileRoutes } from "../src/api/profiles.js";
import { RuntimeManager } from "../src/runtime/manager.js";

const adminToken = "phase5-valid-admin-token";

function authHeader(): { authorization: string } {
  return { authorization: `Bearer ${adminToken}` };
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase5-"));
  const dataDir = path.join(root, "data");
  const buildDir = path.join(root, "build");
  const modelDir = path.join(root, "models");
  await mkdir(dataDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });

  const buildPath = path.join(buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const modelPath = path.join(modelDir, "model.gguf");
  await writeFile(buildPath, "fake executable fixture", "utf8");
  await writeFile(modelPath, "fake model fixture", "utf8");
  await writeFile(path.join(dataDir, "profiles.json"), "[]", "utf8");

  return { root, dataDir, buildPath, modelPath };
}

async function createFixtureApp(t: TestContext) {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  const app = await createServer();
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
  t.after(async () => {
    await app.close();
    delete process.env.OBSIDIANLM_DATA_DIR;
  });
  return { app, fixture };
}

function profile(fixture: Awaited<ReturnType<typeof makeFixture>>, overrides: Partial<LlamaCppProfile> = {}): LlamaCppProfile {
  return {
    id: "daily-profile",
    name: "Daily Profile",
    runtimeType: "llama.cpp",
    providerKind: "server",
    buildPath: fixture.buildPath,
    modelPath: fixture.modelPath,
    host: "0.0.0.0",
    port: 18085,
    llamaArgs: { ctxSize: 8192, gpuLayers: "all", metrics: true, webui: true },
    extraArgs: ["--timeout", "3600"],
    ...overrides
  };
}

function fakeChild(pid: number): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough() as ChildProcessWithoutNullStreams["stdin"];
  child.kill = (() => true) as ChildProcessWithoutNullStreams["kill"];
  return child;
}

test("POST /api/profiles creates a draft profile with generated id and does not start runtime", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: authHeader(),
    payload: {
      name: "Draft Remote Box",
      buildPath: path.join(fixture.root, "missing", "llama-server.exe"),
      modelPath: path.join(fixture.root, "missing", "model.gguf"),
      port: 19001
    }
  });

  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.profile.id, "draft-remote-box");
  assert.equal(body.validation.valid, true);
  assert.ok(body.validation.warnings.some((warning: string) => warning.includes("buildPath does not exist")));

  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: authHeader() });
  assert.equal(runtime.json().state.status, "stopped");
});

test("POST /api/profiles rejects duplicate explicit ids", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");

  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",
    headers: authHeader(),
    payload: { id: "daily-profile", name: "Conflict", buildPath: fixture.buildPath, modelPath: fixture.modelPath }
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().validation.errors.join(" "), /already exists/);
});

test("PATCH /api/profiles/:id updates fields, preserves id, and does not restart runtime", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");

  const response = await app.inject({
    method: "PATCH",
    url: "/api/profiles/daily-profile",
    headers: authHeader(),
    payload: { id: "attempted-rename", name: "Daily Profile Tuned", port: 19002, llamaArgs: { ctxSize: 16384, tensorSplit: "5,3" } }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.profile.id, "daily-profile");
  assert.equal(body.profile.name, "Daily Profile Tuned");
  assert.equal(body.profile.llamaArgs.ctxSize, 16384);
  assert.ok(body.validation.warnings.some((warning: string) => warning.includes("tensorSplit")));

  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: authHeader() });
  assert.equal(runtime.json().state.status, "stopped");
});

test("POST /api/profiles/:id/duplicate creates a unique copy without overwriting", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");

  const response = await app.inject({ method: "POST", url: "/api/profiles/daily-profile/duplicate", headers: authHeader() });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().profile.name, "Daily Profile Copy");
  assert.notEqual(response.json().profile.id, "daily-profile");

  const profiles = await app.inject({ method: "GET", url: "/api/profiles", headers: authHeader() });
  assert.equal(profiles.json().profiles.length, 2);
});

test("DELETE /api/profiles/:id deletes stopped profiles and rejects active managed profiles", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);

  const stoppedApp = await createServer();
  const setup = await stoppedApp.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
  t.after(async () => stoppedApp.close());
  const deleted = await stoppedApp.inject({ method: "DELETE", url: "/api/profiles/daily-profile", headers: authHeader() });
  assert.equal(deleted.statusCode, 200);

  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");
  const manager = new RuntimeManager(undefined, {
    portDetector: async (port) => ({ port, host: "127.0.0.1", inUse: false, ownerPid: null, detectionMethod: "test", warnings: [] }),
    spawnRuntime: ((() => fakeChild(9876)) as unknown) as typeof import("node:child_process").spawn
  });
  const start = await manager.start("daily-profile");
  assert.equal(start.ok, true);
  const activeApp = fastify({ logger: false });
  t.after(async () => activeApp.close());
  await registerProfileRoutes(activeApp, manager);
  const blocked = await activeApp.inject({ method: "DELETE", url: "/api/profiles/daily-profile" });
  assert.equal(blocked.statusCode, 409);
  assert.equal(manager.getState().status, "running");
});

test("POST /api/profiles/import imports arrays and wrapped exports with safe conflict ids", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");

  const direct = await app.inject({ method: "POST", url: "/api/profiles/import", headers: authHeader(), payload: [profile(fixture, { name: "Imported Direct" })] });
  assert.equal(direct.statusCode, 200);
  assert.equal(direct.json().imported, 1);
  assert.equal(direct.json().createdProfileIds[0], "daily-profile-2");

  const wrapped = await app.inject({
    method: "POST",
    url: "/api/profiles/import",
    headers: authHeader(),
    payload: { exportVersion: 1, exportedAt: new Date(0).toISOString(), profiles: [profile(fixture, { id: "wrapped-profile", name: "Wrapped" }), { id: "bad profile", name: "Bad", runtimeType: "llama.cpp" }] }
  });
  assert.equal(wrapped.statusCode, 200);
  assert.equal(wrapped.json().imported, 1);
  assert.equal(wrapped.json().skipped, 1);
  assert.ok(wrapped.json().errors.length >= 1);

  const stored = JSON.parse(await readFile(path.join(fixture.dataDir, "profiles.json"), "utf8"));
  assert.equal(stored.length, 3);
});

test("POST /api/profiles/import rejects malformed payloads", async (t) => {
  const { app } = await createFixtureApp(t);
  const response = await app.inject({ method: "POST", url: "/api/profiles/import", headers: authHeader(), payload: { notProfiles: true } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_import_payload");
});

test("GET /api/profiles/export excludes runtime state and logs", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");

  const response = await app.inject({ method: "GET", url: "/api/profiles/export", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.exportVersion, 1);
  assert.ok(Date.parse(body.exportedAt));
  assert.equal(body.profiles.length, 1);
  assert.equal(body.state, undefined);
  assert.equal(body.logs, undefined);
});

test("GET /api/profiles/:id/snippets returns /v1 endpoint snippets and command preview", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture, { port: 19123 })]), "utf8");

  const response = await app.inject({ method: "GET", url: "/api/profiles/daily-profile/snippets", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.endpoint, "http://localhost:19123/v1");
  assert.match(body.opencodeStarterSnippet, /\/v1/);
  assert.match(body.illustriaStarterSnippet, /19123/);
  assert.deepEqual(body.command.args.slice(-2), ["--timeout", "3600"]);
});

test("GET /api/profiles/:id/snippets brackets IPv6 endpoint hosts", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture, { host: "::1", port: 19124 })]), "utf8");

  const response = await app.inject({ method: "GET", url: "/api/profiles/daily-profile/snippets", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().endpoint, "http://[::1]:19124/v1");
});

test("concurrent start and delete cannot remove a profile after start wins", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture)]), "utf8");

  const manager = new RuntimeManager(undefined, {
    portDetector: async (port) => ({ port, host: "127.0.0.1", inUse: false, ownerPid: null, detectionMethod: "test", warnings: [] }),
    spawnRuntime: ((() => fakeChild(2468)) as unknown) as typeof import("node:child_process").spawn
  });
  const app = fastify({ logger: false });
  t.after(async () => app.close());
  await registerProfileRoutes(app, manager);

  const [start, deleted] = await Promise.all([
    manager.start("daily-profile"),
    app.inject({ method: "DELETE", url: "/api/profiles/daily-profile" })
  ]);

  if (start.ok) {
    assert.equal(deleted.statusCode, 409);
    const stored = JSON.parse(await readFile(path.join(fixture.dataDir, "profiles.json"), "utf8"));
    assert.equal(stored.length, 1);
  } else {
    assert.equal(deleted.statusCode, 200);
    assert.equal(start.message, "Profile not found.");
  }
});

test("RuntimeManager start still uses strict path validation before spawn", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile(fixture, { buildPath: path.join(fixture.root, "missing.exe") })]), "utf8");
  let spawned = false;
  const manager = new RuntimeManager(undefined, {
    spawnRuntime: ((() => {
      spawned = true;
      throw new Error("should not spawn");
    }) as unknown) as typeof import("node:child_process").spawn
  });

  const result = await manager.start("daily-profile");
  assert.equal(result.ok, false);
  assert.equal(spawned, false);
  assert.ok(result.errors?.some((error) => error.includes("buildPath does not exist")));
});
