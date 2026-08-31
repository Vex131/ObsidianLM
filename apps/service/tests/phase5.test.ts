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
async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase5-"));
  const dataDir = path.join(root, "data");
  const buildDir = path.join(root, "build");
  const modelDir = path.join(root, "models");
  await mkdir(dataDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
  const buildPath = path.join(
    buildDir,
    process.platform === "win32" ? "llama-server.exe" : "llama-server",
  );
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
  t.after(async () => {
    await app.close();
    delete process.env.OBSIDIANLM_DATA_DIR;
  });
  return { app, fixture };
}
function profile(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  overrides: Partial<LlamaCppProfile> = {},
): LlamaCppProfile {
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
    ...overrides,
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

    payload: {
      name: "Draft Remote Box",
      buildPath: path.join(fixture.root, "missing", "llama-server.exe"),
      modelPath: path.join(fixture.root, "missing", "model.gguf"),
      port: 19001,
    },
  });
  assert.equal(response.statusCode, 201);
  const body = response.json();
  assert.equal(body.profile.id, "draft-remote-box");
  assert.equal(body.validation.valid, true);
  assert.ok(
    body.validation.warnings.some((warning: string) =>
      warning.includes("buildPath does not exist"),
    ),
  );
  const runtime = await app.inject({
    method: "GET",
    url: "/api/runtime",
  });
  assert.equal(runtime.json().state.status, "stopped");
});
test("draft validation and preview do not persist or mutate runtime", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const draft = {
    name: "Preview Only",
    buildPath: fixture.buildPath,
    modelPath: fixture.modelPath,
    flagOverrides: [{ flag: "--future-switch" }],
  };
  const profilesPath = path.join(fixture.dataDir, "profiles.json");
  const before = await readFile(profilesPath, "utf8");
  const validation = await app.inject({
    method: "POST",
    url: "/api/profiles/validate-draft",

    payload: draft,
  });
  assert.equal(validation.statusCode, 200);
  assert.equal(validation.json().validation.valid, true);
  assert.ok(
    validation
      .json()
      .validation.warnings.some((warning: string) =>
        warning.includes("current discovered llama.cpp catalog"),
      ),
  );
  assert.ok(
    validation
      .json()
      .validation.warnings.some((warning: string) =>
        warning.includes("Custom flag overrides"),
      ),
  );
  const preview = await app.inject({
    method: "POST",
    url: "/api/profiles/preview-command",

    payload: draft,
  });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.json().command.args.slice(-1), ["--future-switch"]);
  const profiles = await app.inject({
    method: "GET",
    url: "/api/profiles",
  });
  assert.equal(profiles.json().profiles.length, 0);
  assert.equal(await readFile(profilesPath, "utf8"), before);
  const runtime = await app.inject({
    method: "GET",
    url: "/api/runtime",
  });
  assert.equal(runtime.json().state.status, "stopped");
});
test("POST /api/profiles rejects duplicate explicit ids", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture),
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: {
      id: "daily-profile",
      name: "Conflict",
      buildPath: fixture.buildPath,
      modelPath: fixture.modelPath,
    },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().validation.errors.join(" "), /already exists/);
});
test("PATCH /api/profiles/:id updates fields, preserves id, and does not restart runtime", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture),
  });
  const response = await app.inject({
    method: "PATCH",
    url: "/api/profiles/daily-profile",

    payload: {
      id: "attempted-rename",
      name: "Daily Profile Tuned",
      port: 19002,
      llamaArgs: { ctxSize: 16384, tensorSplit: "5,3" },
    },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.profile.id, "daily-profile");
  assert.equal(body.profile.name, "Daily Profile Tuned");
  assert.equal(body.profile.llamaArgs.ctxSize, 16384);
  assert.ok(
    body.validation.warnings.some((warning: string) =>
      warning.includes("tensorSplit"),
    ),
  );
  const inherited = await app.inject({
    method: "PATCH",
    url: "/api/profiles/daily-profile",

    payload: { llamaArgs: {} },
  });
  assert.equal(inherited.statusCode, 200);
  assert.deepEqual(inherited.json().profile.llamaArgs, {});
  const runtime = await app.inject({
    method: "GET",
    url: "/api/runtime",
  });
  assert.equal(runtime.json().state.status, "stopped");
});
test("POST /api/profiles/:id/duplicate creates a unique copy without overwriting", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture),
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles/daily-profile/duplicate",
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().profile.name, "Daily Profile Copy");
  assert.notEqual(response.json().profile.id, "daily-profile");
  const profiles = await app.inject({
    method: "GET",
    url: "/api/profiles",
  });
  assert.equal(profiles.json().profiles.length, 2);
});
test("Profile deletion is not blocked by a Profile-era runtime authority", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);
  const app = await createServer();
  t.after(async () => app.close());
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture),
  });
  const deleted = await app.inject({
    method: "DELETE",
    url: "/api/profiles/daily-profile",
  });
  assert.equal(deleted.statusCode, 200);
});
test("POST /api/profiles/import imports arrays and wrapped exports with safe conflict ids", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture),
  });
  const direct = await app.inject({
    method: "POST",
    url: "/api/profiles/import",

    payload: [profile(fixture, { name: "Imported Direct" })],
  });
  assert.equal(direct.statusCode, 200);
  assert.equal(direct.json().imported, 1);
  assert.equal(direct.json().createdProfileIds[0], "daily-profile-2");
  const wrapped = await app.inject({
    method: "POST",
    url: "/api/profiles/import",

    payload: {
      exportVersion: 1,
      exportedAt: new Date(0).toISOString(),
      profiles: [
        profile(fixture, { id: "wrapped-profile", name: "Wrapped" }),
        { id: "bad profile", name: "Bad", runtimeType: "llama.cpp" },
      ],
    },
  });
  assert.equal(wrapped.statusCode, 200);
  assert.equal(wrapped.json().imported, 1);
  assert.equal(wrapped.json().skipped, 1);
  assert.ok(wrapped.json().errors.length >= 1);
  const legacy = profile(fixture, {
    id: "legacy-duplicate",
    name: "Imported Direct",
    llamaArgs: { ctxSize: 32768, flashAttention: true },
    flagOverrides: [{ flag: "--custom-flag", values: ["safe-value"] }],
    extraArgs: ["--future-option", "preserve-me"],
  });
  const noVersion = await app.inject({
    method: "POST",
    url: "/api/profiles/import",

    payload: { profiles: [legacy] },
  });
  assert.equal(noVersion.statusCode, 200);
  assert.equal(noVersion.json().imported, 1);
  const imported = (
    await app.inject({
      method: "GET",
      url: "/api/profiles",
    })
  ).json().profiles;
  const preserved = imported.find(
    (item: LlamaCppProfile) => item.id === "legacy-duplicate",
  );
  assert.deepEqual(preserved.llamaArgs, legacy.llamaArgs);
  assert.deepEqual(preserved.flagOverrides, legacy.flagOverrides);
  assert.deepEqual(preserved.extraArgs, legacy.extraArgs);
  const beforeUnsupported = await readFile(
    path.join(fixture.dataDir, "profiles.json"),
    "utf8",
  );
  const unsupported = await app.inject({
    method: "POST",
    url: "/api/profiles/import",

    payload: { exportVersion: 99, profiles: [legacy] },
  });
  assert.equal(unsupported.statusCode, 400);
  assert.equal(unsupported.json().error, "unsupported_export_version");
  assert.equal(
    await readFile(path.join(fixture.dataDir, "profiles.json"), "utf8"),
    beforeUnsupported,
  );
  const stored = (
    await app.inject({
      method: "GET",
      url: "/api/profiles",
    })
  ).json().profiles;
  assert.equal(stored.length, 4);
});
test("POST /api/profiles/import rejects malformed payloads", async (t) => {
  const { app } = await createFixtureApp(t);
  const response = await app.inject({
    method: "POST",
    url: "/api/profiles/import",

    payload: { notProfiles: true },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_import_payload");
});
test("GET /api/profiles/export excludes runtime state and logs", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture),
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/profiles/export",
  });
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
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture, { port: 19123 }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/profiles/daily-profile/snippets",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.endpoint, "http://localhost:19123/v1");
  assert.match(body.opencodeStarterSnippet, /\/v1/);
  assert.match(body.illustriaStarterSnippet, /19123/);
  assert.deepEqual(body.command.args.slice(-2), ["--timeout", "3600"]);
});
test("GET /api/profiles/:id/snippets brackets IPv6 endpoint hosts", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  await app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: profile(fixture, { host: "::1", port: 19124 }),
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/profiles/daily-profile/snippets",
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().endpoint, "http://[::1]:19124/v1");
});
test("concurrent Profile-era start does not make a Profile ID runtime authority", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);
  const manager = new RuntimeManager();
  const app = fastify({ logger: false });
  t.after(async () => app.close());
  await registerProfileRoutes(app, manager);
  await app.inject({
    method: "POST",
    url: "/api/profiles",
    payload: profile(fixture),
  });
  const result = await manager.start("daily-profile");
  assert.equal(result.error, "not_found");
  const deleted = await app.inject({
    method: "DELETE",
    url: "/api/profiles/daily-profile",
  });
  assert.equal(deleted.statusCode, 200);
});
test("RuntimeManager rejects a legacy Profile ID without attempting to spawn", async () => {
  let spawned = false;
  const manager = new RuntimeManager(undefined, {
    spawnRuntime: (() => {
      spawned = true;
      throw new Error("should not spawn");
    }) as any,
  });
  const result = await manager.start("daily-profile");
  assert.equal(result.ok, false);
  assert.equal(result.error, "not_found");
  assert.equal(spawned, false);
});
