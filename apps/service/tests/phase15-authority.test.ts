import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultSettings } from "@obsidianlm/shared";
import { loadPhase15Domain } from "../src/config/phase15-domain.js";
import { createServer } from "../src/server.js";

async function fixtureForPhase15Api(t: test.TestContext) {
  const dir = await mkdtemp(
    path.join(tmpdir(), "obsidianlm-phase15-authority-"),
  );
  const models = path.join(dir, "models");
  const builds = path.join(dir, "builds");
  await mkdir(models, { recursive: true });
  await mkdir(builds, { recursive: true });
  const model = path.join(models, "model.gguf");
  const server = path.join(builds, "llama-server.exe");
  await Promise.all([writeFile(model, "gguf"), writeFile(server, "exe")]);
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
    rm(dir, { recursive: true, force: true });
    if (oldData === undefined) delete process.env.OBSIDIANLM_DATA_DIR;
    else process.env.OBSIDIANLM_DATA_DIR = oldData;
    if (oldLogs === undefined) delete process.env.OBSIDIANLM_LOG_DIR;
    else process.env.OBSIDIANLM_LOG_DIR = oldLogs;
  });
  const app = await createServer();
  t.after(() => app.close());
  return {
    dir,
    model,
    server,
    app,
  };
}

test("legacy Profile API is a projection and cannot mutate profiles.json", async (t) => {
  const f = await fixtureForPhase15Api(t);
  const profilesPath = `${f.dir}/profiles.json`;
  const before = await readFile(profilesPath);
  const payload = {
    id: "legacy-one",
    name: "Legacy One",
    modelPath: f.model,
    buildPath: f.server,
    host: "127.0.0.1",
    port: 18085,
    llamaArgs: { ctxSize: 4096 },
    flagOverrides: [{ flag: "--custom", values: ["x"] }],
    extraArgs: ["--future"],
  };
  const created = await f.app.inject({
    method: "POST",
    url: "/api/profiles",

    payload,
  });
  assert.equal(created.statusCode, 201);
  const projected = created.json().profile;
  assert.equal(projected.id, payload.id);
  assert.equal(projected.name, payload.name);
  assert.equal(projected.modelPath, payload.modelPath);
  assert.equal(projected.buildPath, payload.buildPath);
  assert.equal(projected.host, payload.host);
  assert.equal(projected.port, payload.port);
  assert.deepEqual(projected.llamaArgs, payload.llamaArgs);
  assert.deepEqual(projected.flagOverrides, payload.flagOverrides);
  assert.deepEqual(projected.extraArgs, payload.extraArgs);
  const snapshot = await loadPhase15Domain(f.dir);
  const migration = structuredClone(snapshot.migration);
  const updated = await f.app.inject({
    method: "PATCH",
    url: "/api/profiles/legacy-one",

    payload: { name: "Renamed", port: 18086 },
  });
  assert.equal(updated.statusCode, 200);
  const duplicate = await f.app.inject({
    method: "POST",
    url: "/api/profiles/legacy-one/duplicate",

    payload: { id: "legacy-two", name: "Two" },
  });
  assert.equal(duplicate.statusCode, 201);
  const imported = await f.app.inject({
    method: "POST",
    url: "/api/profiles/import",

    payload: {
      profiles: [
        {
          id: "legacy-three",
          name: "Three",
          modelPath: f.model,
          buildPath: f.server,
          host: "localhost",
          port: 18087,
        },
      ],
    },
  });
  assert.equal(imported.statusCode, 200);
  assert.equal(imported.json().imported, 1);
  const exported = await f.app.inject({
    method: "GET",
    url: "/api/profiles/export",
  });
  assert.equal(exported.json().exportVersion, 1);
  assert.deepEqual(exported.json().profiles[0], {
    ...payload,
    name: "Renamed",
    port: 18086,
    runtimeType: "llama.cpp",
    providerKind: "server",
  });
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: "/api/profiles/legacy-one",
      })
    ).statusCode,
    200,
  );
  assert.deepEqual(await readFile(profilesPath), before);
  const after = await loadPhase15Domain(f.dir);
  assert.deepEqual(after.migration, migration);
  // A compatibility binding is an authoritative dependency, even though the legacy file is unchanged.
  const remaining = after.configuredModels.find((model) =>
    after.compatibilityBindings.some(
      (binding) => binding.configuredModelId === model.id,
    ),
  );
  assert.ok(remaining);
  assert.equal(
    (
      await f.app.inject({
        method: "DELETE",
        url: `/api/configured-models/${remaining!.id}`,
      })
    ).statusCode,
    409,
  );
});

test("profile projection survives external legacy-file edits and domain edits do not re-migrate", async (t) => {
  const f = await fixtureForPhase15Api(t);
  const create = await f.app.inject({
    method: "POST",
    url: "/api/profiles",

    payload: {
      id: "stable",
      name: "Stable",
      modelPath: f.model,
      buildPath: f.server,
      host: "127.0.0.1",
      port: 18100,
    },
  });
  assert.equal(create.statusCode, 201);
  const bytes = await readFile(`${f.dir}/profiles.json`);
  await writeFile(
    `${f.dir}/profiles.json`,
    JSON.stringify([
      {
        id: "external",
        name: "External",
        runtimeType: "llama.cpp",
        providerKind: "server",
        modelPath: f.model,
        buildPath: f.server,
        host: "127.0.0.1",
        port: 18101,
      },
    ]),
  );
  await f.app.close();
  const reopened = await (await import("../src/server.js")).createServer();
  t.after(() => reopened.close());
  const edit = await reopened.inject({
    method: "PATCH",
    url: "/api/profiles/stable",

    payload: { name: "Still Stable" },
  });
  assert.equal(edit.statusCode, 200);
  assert.equal(edit.json().profile.id, "stable");
  assert.deepEqual(
    await readFile(`${f.dir}/profiles.json`),
    Buffer.from(
      JSON.stringify([
        {
          id: "external",
          name: "External",
          runtimeType: "llama.cpp",
          providerKind: "server",
          modelPath: f.model,
          buildPath: f.server,
          host: "127.0.0.1",
          port: 18101,
        },
      ]),
    ),
  );
  assert.notDeepEqual(await readFile(`${f.dir}/profiles.json`), bytes);
});
