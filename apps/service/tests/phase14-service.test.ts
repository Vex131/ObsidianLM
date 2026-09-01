import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { defaultRuntimeState, defaultSettings } from "@obsidianlm/shared";
import {
  ensureStorageFiles,
  saveRuntimeState,
  saveSettings,
} from "../src/config/storage.js";
import { getServiceLogsDir } from "../src/config/paths.js";
import { createServer } from "../src/server.js";
async function fixture(t: TestContext) {
  const root = await mkdtemp(
    path.join(tmpdir(), "obsidianlm-phase14-service-"),
  );
  const data = path.join(root, "data");
  const logs = path.join(root, "logs");
  const models = path.join(root, "models");
  const builds = path.join(root, "builds");
  await Promise.all([mkdir(data), mkdir(logs), mkdir(models), mkdir(builds)]);
  const priorData = process.env.OBSIDIANLM_DATA_DIR;
  const priorLogs = process.env.OBSIDIANLM_LOG_DIR;
  process.env.OBSIDIANLM_DATA_DIR = data;
  process.env.OBSIDIANLM_LOG_DIR = logs;
  t.after(() => {
    if (priorData === undefined) delete process.env.OBSIDIANLM_DATA_DIR;
    else process.env.OBSIDIANLM_DATA_DIR = priorData;
    if (priorLogs === undefined) delete process.env.OBSIDIANLM_LOG_DIR;
    else process.env.OBSIDIANLM_LOG_DIR = priorLogs;
  });
  await ensureStorageFiles();
  await saveSettings({
    ...defaultSettings,
    modelFolders: [models],
    llamaCppFolders: [builds],
  });
  return { root, models, builds };
}
test("service logs are public, bounded, empty-safe, and skip symlinks", async (t) => {
  await fixture(t);
  const serviceLogs = getServiceLogsDir();
  const app = await createServer();
  t.after(() => app.close());
  assert.equal(
    (await app.inject({ method: "GET", url: "/api/logs/service" })).statusCode,
    200,
  );
  assert.deepEqual(
    (
      await app.inject({
        method: "GET",
        url: "/api/logs/service",
      })
    ).json(),
    { logs: [], warnings: [] },
  );
  await writeFile(
    path.join(serviceLogs, "service.log"),
    `${Array.from({ length: 1_100 }, (_, i) => `line-${i}`).join("\n")}\n`,
  );
  await writeFile(
    path.join(serviceLogs, "large.log"),
    `${"x".repeat(256 * 1024 + 1)}\nlatest-line\n`,
  );
  try {
    await symlink(
      path.join(serviceLogs, "service.log"),
      path.join(serviceLogs, "linked.log"),
      "file",
    );
  } catch {
    /* symlinks require elevated permission on some Windows hosts */
  }
  const response = await app.inject({
    method: "GET",
    url: "/api/logs/service?limit=3",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(body.logs.length <= 10);
  assert.ok(
    body.logs.every((file: { name: string }) => file.name !== "linked.log"),
  );
  assert.ok(
    body.logs.reduce(
      (count: number, file: { lines: string[] }) => count + file.lines.length,
      0,
    ) <= 3,
  );
  assert.ok(
    body.logs
      .find((file: { name: string }) => file.name === "large.log")
      ?.lines.includes("latest-line"),
  );
  assert.ok(
    body.warnings.every((warning: string) => !warning.includes(serviceLogs)),
  );
});
test("runtime settings validate ports, ignore legacy runtime evidence, and keep folders independent", async (t) => {
  await fixture(t);
  await saveRuntimeState({ ...defaultRuntimeState, status: "running" });
  const app = await createServer();
  t.after(() => app.close());
  const invalid = await app.inject({
    method: "PATCH",
    url: "/api/settings/runtime",

    payload: { managedLlamaPort: 0 },
  });
  assert.equal(invalid.statusCode, 400);
  const unchanged = await app.inject({
    method: "PATCH",
    url: "/api/settings/runtime",

    payload: { managedLlamaPort: defaultSettings.managedLlamaPort },
  });
  assert.equal(unchanged.statusCode, 200);
  assert.ok(!("adminTokenHash" in unchanged.json().settings));
  assert.equal(
    (
      await app.inject({
        method: "PATCH",
        url: "/api/settings/runtime",

        payload: { managedLlamaPort: 18080 },
      })
    ).statusCode,
    200,
  );
  const folders = await app.inject({
    method: "PATCH",
    url: "/api/settings/discovery-folders",

    payload: { modelFolders: ["models"], llamaCppFolders: ["builds"] },
  });
  assert.equal(folders.statusCode, 200);
  assert.ok(!("adminTokenHash" in folders.json().settings));
});
test("jobs reject known non-model artifacts and retain safe selection details for unknown models", async (t) => {
  const { models, builds } = await fixture(t);
  const build = path.join(builds, "fixture-build");
  await mkdir(build);
  await writeFile(path.join(build, "llama-server"), "fixture");
  await writeFile(path.join(build, "llama-bench"), "fixture");
  await writeFile(path.join(models, "vision-mmproj.gguf"), "fixture");
  await writeFile(path.join(models, "unknown.gguf"), "fixture");
  const app = await createServer();
  t.after(() => app.close());
  const base = {
    buildId: undefined,
    benchPath: path.join(build, "llama-bench"),
  };
  const rejected = await app.inject({
    method: "POST",
    url: "/api/jobs/llama-bench",

    payload: { ...base, modelPath: path.join(models, "vision-mmproj.gguf") },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().error, "model_artifact_not_supported");
  const allowed = await app.inject({
    method: "POST",
    url: "/api/jobs/llama-bench",

    payload: { ...base, modelPath: path.join(models, "unknown.gguf") },
  });
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(allowed.json().job.selection, {
    tool: "llama-bench",
    build: "fixture-build",
    model: "unknown.gguf",
  });
});
