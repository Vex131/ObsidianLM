import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import { defaultSettings, type JobRecord } from "@obsidianlm/shared";
import { registerJobRoutes } from "../src/api/jobs.js";
import { hashAdminToken } from "../src/auth/admin-token.js";
import { ensureStorageFiles, saveSettings } from "../src/config/storage.js";
import { JobManager } from "../src/jobs/manager.js";
import { createServer } from "../src/server.js";
import { buildLlamaBenchCommand, validateLlamaBenchRequestShape } from "../src/tools/llama-bench/command-builder.js";
import { parseLlamaBenchOutput } from "../src/tools/llama-bench/result-parser.js";

const adminToken = "phase10-valid-admin-token";
const invalidToken = "phase10-invalid-admin-token";

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
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase10-"));
  const dataDir = path.join(root, "data");
  const logsDir = path.join(root, "logs");
  const modelDir = path.join(root, "models");
  const buildDir = path.join(root, "llama", "build");
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(modelDir, { recursive: true });
  await mkdir(buildDir, { recursive: true });
  process.env.OBSIDIANLM_DATA_DIR = dataDir;
  process.env.OBSIDIANLM_LOG_DIR = logsDir;
  delete process.env.OBSIDIANLM_LOGS_DIR;
  t.after(() => {
    setOrDeleteEnv("OBSIDIANLM_DATA_DIR", originalDataDir);
    setOrDeleteEnv("OBSIDIANLM_LOG_DIR", originalLogDir);
    setOrDeleteEnv("OBSIDIANLM_LOGS_DIR", originalLogsDir);
  });
  return { root, dataDir, logsDir, modelDir, buildDir };
}

async function configureAdminToken(): Promise<void> {
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, adminTokenHash: await hashAdminToken(adminToken) });
}

async function configureDiscovery(t: TestContext) {
  const fixture = await makeFixture(t);
  const modelPath = path.join(fixture.modelDir, "Tiny-Q4_K_M.gguf");
  const serverPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const benchPath = path.join(fixture.buildDir, process.platform === "win32" ? "llama-bench.exe" : "llama-bench");
  await writeFile(modelPath, "fake model", "utf8");
  await writeFile(serverPath, "fake server", "utf8");
  await writeFile(benchPath, "fake bench", "utf8");
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, modelFolders: [fixture.modelDir], llamaCppFolders: [path.join(fixture.root, "llama")], adminTokenHash: await hashAdminToken(adminToken) });
  return { ...fixture, modelPath, serverPath, benchPath };
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

test("setup-required auth blocks protected routes before setup while public setup/status routes remain public", async (t) => {
  await makeFixture(t);
  const app = await createServer();
  t.after(async () => app.close());

  const status = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(status.statusCode, 200);
  const authStatus = await app.inject({ method: "GET", url: "/api/auth/status" });
  assert.equal(authStatus.statusCode, 200);
  assert.equal(authStatus.json().configured, false);

  for (const route of [
    { method: "GET", url: "/api/settings" },
    { method: "GET", url: "/api/profiles" },
    { method: "GET", url: "/api/runtime/logs" },
    { method: "POST", url: "/api/jobs/test" }
  ] as const) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 423, `${route.method} ${route.url}`);
    assert.equal(response.json().error, "setup_required");
  }

  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
});

test("protected routes require a bearer token after setup and accept a valid token", async (t) => {
  await makeFixture(t);
  await configureAdminToken();
  const app = await createServer();
  t.after(async () => app.close());

  for (const route of [
    { method: "GET", url: "/api/settings" },
    { method: "GET", url: "/api/profiles" },
    { method: "GET", url: "/api/runtime/logs" },
    { method: "POST", url: "/api/jobs/test" }
  ] as const) {
    const noToken = await app.inject(route);
    assert.equal(noToken.statusCode, 401, `${route.method} ${route.url} without token`);
    const badToken = await app.inject({ ...route, headers: authHeader(invalidToken) });
    assert.equal(badToken.statusCode, 401, `${route.method} ${route.url} with bad token`);
    const goodToken = await app.inject({ ...route, headers: authHeader() });
    assert.equal(goodToken.statusCode, 200, `${route.method} ${route.url} with valid token`);
  }
});

test("llama-bench command builder emits only supported safe argv entries", () => {
  const command = buildLlamaBenchCommand(
    { args: { threads: 8, batchSize: 512, ubatchSize: 128, nGpuLayers: 35, promptTokens: 256, generationTokens: 64, repetitions: 3, ctxSize: 4096 } },
    "llama-bench",
    "model.gguf"
  );
  assert.deepEqual(command.args, ["--model", "model.gguf", "--threads", "8", "--batch-size", "512", "--ubatch-size", "128", "--n-gpu-layers", "35", "--n-prompt", "256", "--n-gen", "64", "--repetitions", "3"]);
  assert.equal(command.args.includes("--ctx-size"), false);
});

test("llama-bench request validation rejects invalid values, threadsBatch, and unsupported flags", () => {
  assert.deepEqual(validateLlamaBenchRequestShape({ args: { threads: 1, nGpuLayers: 0, repetitions: 1 } }), []);
  assert.match(validateLlamaBenchRequestShape({ threads: 0 }).join(" "), /threads must be an integer greater than or equal to 1/u);
  assert.match(validateLlamaBenchRequestShape({ args: { batchSize: 1.5 } }).join(" "), /batchSize must be an integer greater than or equal to 1/u);
  assert.match(validateLlamaBenchRequestShape({ threadsBatch: 2 } as never).join(" "), /threadsBatch is not supported/u);
  assert.match(validateLlamaBenchRequestShape({ args: { threadsBatch: 2 } } as never).join(" "), /threadsBatch is not supported/u);
  assert.match(validateLlamaBenchRequestShape({ args: { ctxSize: 2048, flashAttention: true } } as never).join(" "), /args\.flashAttention is not supported/u);
  assert.match(validateLlamaBenchRequestShape({ extraArgs: ["--threads", "99"] } as never).join(" "), /extraArgs is not supported/u);
});

test("llama-bench result parser reads representative markdown output and reports malformed output", () => {
  const parsed = parseLlamaBenchOutput(`build: abc\n| model | backend | threads | n_batch | n_ubatch | test | t/s |\n| --- | --- | --- | --- | --- | --- | ---: |\n| llama 7B | CUDA | 8 | 512 | 128 | pp512 | 1,234.56 ± 7.8 |\n| llama 7B | CUDA | 8 | 512 | 128 | tg128 | 89.5 |\n`);
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0]?.test, "pp512");
  assert.equal(parsed.rows[0]?.tokensPerSecond, 1234.56);
  assert.equal(parsed.rows[1]?.tokensPerSecond, 89.5);

  const malformed = parseLlamaBenchOutput("llama-bench started\nno table here");
  assert.equal(malformed.parsed, false);
  assert.deepEqual(malformed.rows, []);
  assert.match(malformed.warnings.join(" "), /No complete llama-bench markdown result table/u);
});

test("llama-bench job route rejects arbitrary benchPath and modelPath outside discovered folders", async (t) => {
  const fixture = await configureDiscovery(t);
  const manager = new JobManager(createMockSpawn("").spawnJob ? { spawnJob: createMockSpawn("").spawnJob } : {});
  await manager.initialize();
  t.after(async () => manager.shutdown());
  const app = fastify({ logger: false });
  await registerJobRoutes(app, manager);
  t.after(async () => app.close());

  const badBench = await app.inject({ method: "POST", url: "/api/jobs/llama-bench", payload: { benchPath: path.join(fixture.root, "rogue-bench.exe"), modelPath: fixture.modelPath } });
  assert.equal(badBench.statusCode, 400);
  assert.equal(badBench.json().error, "llama_bench_not_discovered");

  const outsideModel = path.join(fixture.root, "outside.gguf");
  await writeFile(outsideModel, "fake outside model", "utf8");
  const badModel = await app.inject({ method: "POST", url: "/api/jobs/llama-bench", payload: { benchPath: fixture.benchPath, modelPath: outsideModel } });
  assert.equal(badModel.statusCode, 400);
  assert.equal(badModel.json().error, "model_not_discovered");
});

test("llama-bench job route starts JobManager job with mocked spawn and exposes readable logs", async (t) => {
  const fixture = await configureDiscovery(t);
  const output = "| test | t/s |\n| --- | ---: |\n| pp512 | 321.5 |\n";
  const mock = createMockSpawn(output);
  const manager = new JobManager({ spawnJob: mock.spawnJob });
  await manager.initialize();
  t.after(async () => manager.shutdown());
  const app = fastify({ logger: false });
  await registerJobRoutes(app, manager);
  t.after(async () => app.close());

  const started = await app.inject({ method: "POST", url: "/api/jobs/llama-bench", payload: { benchPath: fixture.benchPath, modelPath: fixture.modelPath, args: { threads: 4, repetitions: 1 } } });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().ok, true);
  const id = started.json().job.id as string;
  const completed = await waitForJob(manager, id, (job) => job.status === "completed");
  assert.equal(completed.result?.parsed, true);
  assert.equal(completed.result?.rows[0]?.tokensPerSecond, 321.5);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0]?.executable, fixture.benchPath);
  assert.deepEqual(mock.calls[0]?.args, ["--model", fixture.modelPath, "--threads", "4", "--repetitions", "1"]);

  const logs = await app.inject({ method: "GET", url: `/api/jobs/${id}/logs?limit=10` });
  assert.equal(logs.statusCode, 200);
  assert.match(logs.json().logs.join("\n"), /stdout: \| test \| t\/s \|/u);
});

test("job cancellation route does not target unknown processes", async (t) => {
  await configureDiscovery(t);
  const manager = new JobManager({ spawnJob: createMockSpawn("").spawnJob });
  await manager.initialize();
  t.after(async () => manager.shutdown());
  const app = fastify({ logger: false });
  await registerJobRoutes(app, manager);
  t.after(async () => app.close());

  const missing = await app.inject({ method: "POST", url: "/api/jobs/not-managed/cancel" });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().ok, false);
  assert.equal(missing.json().job, null);
});
