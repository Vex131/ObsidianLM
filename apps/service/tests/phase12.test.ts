import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import { defaultSettings, type JobRecord } from "@obsidianlm/shared";
import { registerJobRoutes } from "../src/api/jobs.js";
import { hashAdminToken } from "../src/auth/admin-token.js";
import { ensureStorageFiles, saveSettings } from "../src/config/storage.js";
import { discoverToolInputs } from "../src/discovery/tool-inputs.js";
import { JobManager } from "../src/jobs/manager.js";
import { createServer } from "../src/server.js";
import { buildLlamaBenchCommand } from "../src/tools/llama-bench/command-builder.js";
import { buildLlamaPerplexityCommand, validateLlamaPerplexityRequestShape } from "../src/tools/llama-perplexity/command-builder.js";
import { parseLlamaPerplexityOutput } from "../src/tools/llama-perplexity/result-parser.js";

const adminToken = "phase12-valid-admin-token";

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
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase12-"));
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

async function configureDiscovery(t: TestContext) {
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
  await writeFile(datasetPath, "hello world", "utf8");
  await ensureStorageFiles();
  await saveSettings({
    ...defaultSettings,
    modelFolders: [fixture.modelDir],
    llamaCppFolders: [path.join(fixture.root, "llama")],
    toolInputFolders: [fixture.inputDir],
    adminTokenHash: await hashAdminToken(adminToken)
  });
  return { ...fixture, modelPath, serverPath, benchPath, perplexityPath, datasetPath };
}

async function waitForJob(manager: JobManager, id: string, predicate: (job: JobRecord) => boolean): Promise<JobRecord> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const job = manager.getJob(id);
    if (job && predicate(job)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`Timed out waiting for job ${id}; last status: ${manager.getJob(id)?.status ?? "missing"}`);
}

function createMockSpawn(output: string) {
  const calls: Array<{ executable: string; args: string[] }> = [];
  const spawnJob = ((executable: string, args: string[]) => {
    calls.push({ executable, args });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.emit("data", Buffer.from(output));
      child.emit("exit", 0, null);
    });
    return child;
  }) as never;
  return { spawnJob, calls };
}

test("tool input discovery scans configured folders, filters extensions, skips symlinks, and warns on missing folders", async (t) => {
  const fixture = await makeFixture(t);
  await mkdir(path.join(fixture.inputDir, "nested"), { recursive: true });
  await writeFile(path.join(fixture.inputDir, "a.txt"), "a", "utf8");
  await writeFile(path.join(fixture.inputDir, "b.raw"), "b", "utf8");
  await writeFile(path.join(fixture.inputDir, "c.jsonl"), "{}\n", "utf8");
  await writeFile(path.join(fixture.inputDir, "nested", "d.md"), "# d", "utf8");
  await writeFile(path.join(fixture.inputDir, "ignored.csv"), "x", "utf8");
  try {
    await symlink(path.join(fixture.inputDir, "a.txt"), path.join(fixture.inputDir, "linked.txt"));
  } catch {
    // Symlink creation can require elevated privileges on Windows; discovery is still covered when available.
  }
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, toolInputFolders: [fixture.inputDir, path.join(fixture.root, "missing")] });

  const discovered = await discoverToolInputs();
  assert.deepEqual(discovered.files.map((file) => file.extension).sort(), [".jsonl", ".md", ".raw", ".txt"]);
  assert.equal(discovered.files.some((file) => file.fileName === "linked.txt"), false);
  assert.equal(discovered.files.some((file) => file.fileName === "ignored.csv"), false);
  assert.ok(discovered.warnings.some((warning) => warning.code === "folder_missing"));
});

test("llama-perplexity command builder and validation allow only safe numeric options", () => {
  const command = buildLlamaPerplexityCommand({ args: { threads: 8, ctxSize: 4096, batchSize: 512, ubatchSize: 128, nGpuLayers: 35 } }, "llama-perplexity", "model.gguf", "dataset.txt");
  assert.deepEqual(command.args, ["-m", "model.gguf", "-f", "dataset.txt", "--threads", "8", "--ctx-size", "4096", "--batch-size", "512", "--ubatch-size", "128", "--n-gpu-layers", "35"]);
  assert.deepEqual(validateLlamaPerplexityRequestShape({ args: { threads: 1, nGpuLayers: 0 } }), []);
  assert.match(validateLlamaPerplexityRequestShape({ args: { threads: 0 } }).join(" "), /threads must be an integer/u);
  assert.match(validateLlamaPerplexityRequestShape({ args: { flashAttention: true } } as never).join(" "), /args\.flashAttention is not supported/u);
  assert.match(validateLlamaPerplexityRequestShape({ extraArgs: ["--bad"] } as never).join(" "), /extraArgs is not supported/u);
});

test("llama-perplexity parser extracts final and progress estimates and falls back with warnings", () => {
  const parsed = parseLlamaPerplexityOutput("[1]15.2701,[2]5.4007\nFinal estimate: PPL = 5.4007 +/- 0.67339\n");
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.finalPpl, 5.4007);
  assert.equal(parsed.uncertainty, 0.67339);
  assert.deepEqual(parsed.estimates, [{ index: 1, ppl: 15.2701 }, { index: 2, ppl: 5.4007 }]);
  assert.equal(parsed.estimateCount, 2);

  const progressOnly = parseLlamaPerplexityOutput("[1]15.2701,[2]5.4007");
  assert.equal(progressOnly.parsed, false);
  assert.equal(progressOnly.estimateCount, 2);
  assert.match(progressOnly.warnings.join(" "), /No final llama-perplexity PPL estimate/u);
});

test("llama-perplexity route is protected after auth setup", async (t) => {
  await configureDiscovery(t);
  const app = await createServer();
  t.after(async () => app.close());

  const noToken = await app.inject({ method: "POST", url: "/api/jobs/llama-perplexity" });
  assert.equal(noToken.statusCode, 401);
  const invalidShape = await app.inject({ method: "POST", url: "/api/jobs/llama-perplexity", headers: authHeader(), payload: { args: { threads: 0 } } });
  assert.equal(invalidShape.statusCode, 400);
  assert.equal(invalidShape.json().error, "invalid_llama_perplexity_request");
});

test("llama-perplexity route rejects undiscovered tool, model, and dataset paths", async (t) => {
  const fixture = await configureDiscovery(t);
  const manager = new JobManager({ spawnJob: createMockSpawn("").spawnJob });
  await manager.initialize();
  t.after(async () => manager.shutdown());
  const app = fastify({ logger: false });
  await registerJobRoutes(app, manager);
  t.after(async () => app.close());

  const badTool = await app.inject({ method: "POST", url: "/api/jobs/llama-perplexity", payload: { perplexityPath: path.join(fixture.root, "rogue-perplexity.exe"), modelPath: fixture.modelPath, datasetPath: fixture.datasetPath } });
  assert.equal(badTool.statusCode, 400);
  assert.equal(badTool.json().error, "llama_perplexity_not_discovered");

  const outsideModel = path.join(fixture.root, "outside.gguf");
  await writeFile(outsideModel, "fake outside model", "utf8");
  const badModel = await app.inject({ method: "POST", url: "/api/jobs/llama-perplexity", payload: { perplexityPath: fixture.perplexityPath, modelPath: outsideModel, datasetPath: fixture.datasetPath } });
  assert.equal(badModel.statusCode, 400);
  assert.equal(badModel.json().error, "model_not_discovered");

  const outsideDataset = path.join(fixture.root, "outside.txt");
  await writeFile(outsideDataset, "outside", "utf8");
  const badDataset = await app.inject({ method: "POST", url: "/api/jobs/llama-perplexity", payload: { perplexityPath: fixture.perplexityPath, modelPath: fixture.modelPath, datasetPath: outsideDataset } });
  assert.equal(badDataset.statusCode, 400);
  assert.equal(badDataset.json().error, "dataset_not_discovered");
});

test("llama-perplexity route starts a sanitized mocked JobManager job", async (t) => {
  const fixture = await configureDiscovery(t);
  const output = "[1]15.2701,[2]5.4007\nFinal estimate: PPL = 5.4007 +/- 0.67339\n";
  const mock = createMockSpawn(output);
  const manager = new JobManager({ spawnJob: mock.spawnJob });
  await manager.initialize();
  t.after(async () => manager.shutdown());
  const app = fastify({ logger: false });
  await registerJobRoutes(app, manager);
  t.after(async () => app.close());

  const started = await app.inject({ method: "POST", url: "/api/jobs/llama-perplexity", payload: { perplexityPath: fixture.perplexityPath, modelPath: fixture.modelPath, datasetPath: fixture.datasetPath, args: { threads: 4, ctxSize: 256 } } });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().ok, true);
  assert.doesNotMatch(JSON.stringify(started.json()), new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&"), "u"));
  const id = started.json().job.id as string;
  const completed = await waitForJob(manager, id, (job) => job.status === "completed");
  assert.equal(completed.result?.type, "llama-perplexity");
  assert.equal(completed.result?.parsed, true);
  assert.equal(mock.calls[0]?.executable, fixture.perplexityPath);
  assert.deepEqual(mock.calls[0]?.args, ["-m", fixture.modelPath, "-f", fixture.datasetPath, "--threads", "4", "--ctx-size", "256"]);
});

test("existing llama-bench command remains unchanged", () => {
  const command = buildLlamaBenchCommand({ args: { threads: 4, repetitions: 1 } }, "llama-bench", "model.gguf");
  assert.deepEqual(command.args, ["--model", "model.gguf", "--threads", "4", "--repetitions", "1"]);
});
