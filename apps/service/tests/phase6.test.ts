import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import type { JobRecord } from "@obsidianlm/shared";
import { createServer } from "../src/server.js";
import { registerJobRoutes } from "../src/api/jobs.js";
import { JobManager, sanitizeJobForApi } from "../src/jobs/manager.js";

const adminToken = "phase6-valid-admin-token";

function authHeader(): { authorization: string } {
  return { authorization: `Bearer ${adminToken}` };
}

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase6-"));
  const dataDir = path.join(root, "data");
  const logsDir = path.join(root, "logs");
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  return { root, dataDir, logsDir };
}

async function createFixtureApp(t: TestContext) {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  process.env.OBSIDIANLM_LOGS_DIR = fixture.logsDir;
  const app = await createServer();
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
  t.after(async () => {
    await app.close();
    delete process.env.OBSIDIANLM_DATA_DIR;
    delete process.env.OBSIDIANLM_LOGS_DIR;
  });
  return { app, fixture };
}

async function createFixtureManager(t: TestContext) {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  process.env.OBSIDIANLM_LOGS_DIR = fixture.logsDir;
  const manager = new JobManager();
  await manager.initialize();
  t.after(async () => {
    await manager.shutdown();
    delete process.env.OBSIDIANLM_DATA_DIR;
    delete process.env.OBSIDIANLM_LOGS_DIR;
  });
  return { manager, fixture };
}

async function waitForJob(manager: JobManager, id: string, predicate: (job: JobRecord) => boolean): Promise<JobRecord> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const job = manager.getJob(id);
    if (job && predicate(job)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const job = manager.getJob(id);
  assert.fail(`Timed out waiting for job ${id}. Last status: ${job?.status ?? "missing"}`);
}

async function waitForApiJob(app: Awaited<ReturnType<typeof createServer>>, id: string, predicate: (job: JobRecord) => boolean): Promise<JobRecord> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await app.inject({ method: "GET", url: `/api/jobs/${id}`, headers: authHeader() });
    if (response.statusCode === 200) {
      const job = response.json().job as JobRecord;
      if (predicate(job)) {
        return job;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`Timed out waiting for API job ${id}.`);
}

test("jobs.json is created by default storage initialization", async (t) => {
  const { fixture } = await createFixtureApp(t);
  const jobs = JSON.parse(await readFile(path.join(fixture.dataDir, "jobs.json"), "utf8"));
  assert.deepEqual(jobs, []);
});

test("POST /api/jobs/test creates a safe test job", async (t) => {
  const { app } = await createFixtureApp(t);
  const response = await app.inject({ method: "POST", url: "/api/jobs/test", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.job.type, "test");
  assert.equal(body.job.executable, path.basename(process.execPath));
  assert.equal(body.job.cwd, null);
});

test("test job completes successfully", async (t) => {
  const { app } = await createFixtureApp(t);
  const created = await app.inject({ method: "POST", url: "/api/jobs/test", headers: authHeader() });
  const id = created.json().job.id as string;
  const job = await waitForApiJob(app, id, (item) => item.status === "completed");
  assert.equal(job.exitCode, 0);
  const logs = await app.inject({ method: "GET", url: `/api/jobs/${id}/logs`, headers: authHeader() });
  assert.equal(logs.statusCode, 200);
  assert.match(logs.json().logs.join("\n"), /ObsidianLM test job completed/);
});

test("failed job command records failed status", async (t) => {
  const { manager, fixture } = await createFixtureManager(t);
  const result = await manager.startJob({ type: "generic", executable: path.join(fixture.root, "missing-command") });
  assert.equal(result.ok, true);
  assert.ok(result.job);
  const job = await waitForJob(manager, result.job.id, (item) => item.status === "failed");
  assert.match(job.errorMessage ?? "", /ENOENT|not found|no such file/i);
});

test("cancelling a running job only targets the current managed child", async (t) => {
  const { manager } = await createFixtureManager(t);
  const result = await manager.startJob({ type: "test", executable: process.execPath, args: ["-e", "setTimeout(() => console.log('late'), 5000);"] });
  assert.equal(result.ok, true);
  assert.ok(result.job);
  const cancelled = await manager.cancelJob(result.job.id);
  assert.equal(cancelled.ok, true);
  const job = await waitForJob(manager, result.job.id, (item) => item.status === "cancelled" && item.finishedAt !== null);
  assert.equal(job.status, "cancelled");
});

test("second active job is rejected while one is running", async (t) => {
  const { manager } = await createFixtureManager(t);
  const first = await manager.startJob({ type: "test", executable: process.execPath, args: ["-e", "setTimeout(() => console.log('late'), 5000);"] });
  assert.equal(first.ok, true);
  const second = await manager.startJob({ type: "test", executable: process.execPath, args: ["-e", "console.log('second');"] });
  assert.equal(second.ok, false);
  assert.match(second.message, /one active job/i);
  assert.ok(first.job);
  await manager.cancelJob(first.job.id);
  await waitForJob(manager, first.job.id, (item) => item.status === "cancelled" && item.finishedAt !== null);
});

test("parallel test job requests allow only one active job", async (t) => {
  const { app } = await createFixtureApp(t);
  const responses = await Promise.all([
    app.inject({ method: "POST", url: "/api/jobs/test", headers: authHeader() }),
    app.inject({ method: "POST", url: "/api/jobs/test", headers: authHeader() })
  ]);
  const statusCodes = responses.map((response) => response.statusCode).sort();
  assert.deepEqual(statusCodes, [200, 409]);
  const accepted = responses.find((response) => response.statusCode === 200);
  assert.ok(accepted);
  const id = accepted.json().job.id as string;
  await waitForApiJob(app, id, (item) => item.status === "completed");
});

test("sanitized job responses redact embedded local paths in args and errors", () => {
  const job: JobRecord = {
    id: "redaction-test",
    type: "generic",
    status: "failed",
    createdAt: new Date(0).toISOString(),
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    command: "tool --model=C:\\Users\\name\\model.gguf --out=/home/name/result.txt --cache=/data/models/foo.gguf --workspace=/workspace/results.json --share=\\\\server\\share\\model.gguf",
    executable: "C:\\Tools\\tool.exe",
    args: ["--model=C:\\Users\\name\\model.gguf", "--out=/home/name/result.txt", "--cache=/data/models/foo.gguf", "--workspace=/workspace/results.json", "--share=\\\\server\\share\\model.gguf"],
    cwd: "C:\\Users\\name",
    exitCode: 1,
    signal: null,
    logPath: "C:\\Users\\name\\logs\\job.log",
    resultPath: "/home/name/result.txt",
    errorMessage: "spawn /srv/llama/llama-bench ENOENT after C:\\Users\\name\\missing.exe"
  };
  const sanitized = sanitizeJobForApi(job);
  const text = JSON.stringify(sanitized);
  assert.equal(text.includes("C:\\Users\\name"), false);
  assert.equal(text.includes("/home/name"), false);
  assert.equal(text.includes("/data/models"), false);
  assert.equal(text.includes("/workspace"), false);
  assert.equal(text.includes("/srv/llama"), false);
  assert.equal(text.includes("\\\\server\\share"), false);
  assert.equal(sanitized.executable, "tool.exe");
  assert.equal(sanitized.cwd, null);
});

test("startup restores queued and running jobs as interrupted failures", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  process.env.OBSIDIANLM_LOGS_DIR = fixture.logsDir;
  t.after(() => {
    delete process.env.OBSIDIANLM_DATA_DIR;
    delete process.env.OBSIDIANLM_LOGS_DIR;
  });
  const jobs: JobRecord[] = ["queued", "running"].map((status, index) => ({
    id: `old-${index}`,
    type: "test",
    status: status as JobRecord["status"],
    createdAt: new Date(0).toISOString(),
    startedAt: status === "running" ? new Date(0).toISOString() : null,
    finishedAt: null,
    command: "node -e old",
    executable: process.execPath,
    args: ["-e", "old"],
    cwd: null,
    exitCode: null,
    signal: null,
    logPath: null,
    resultPath: null,
    errorMessage: null
  }));
  await writeFile(path.join(fixture.dataDir, "jobs.json"), JSON.stringify(jobs), "utf8");
  const manager = new JobManager();
  await manager.initialize();
  const restored = manager.listJobs();
  assert.equal(restored.every((job) => job.status === "failed"), true);
  assert.match(restored.map((job) => job.errorMessage).join(" "), /interrupted by service startup/i);
});

test("job logs endpoint redacts unsafe local command details", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const created = await app.inject({ method: "POST", url: "/api/jobs/test", headers: authHeader() });
  const id = created.json().job.id as string;
  await waitForApiJob(app, id, (item) => item.status === "completed");
  const response = await app.inject({ method: "GET", url: `/api/jobs/${id}/logs`, headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.job.executable, path.basename(process.execPath));
  assert.equal(new RegExp(fixture.root.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&")).test(JSON.stringify(body)), false);
  assert.equal(new RegExp(process.execPath.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&")).test(JSON.stringify(body)), false);
});

test("job logs endpoint redacts local paths emitted by job output", async (t) => {
  const { manager, fixture } = await createFixtureManager(t);
  const app = fastify({ logger: false });
  t.after(async () => app.close());
  await registerJobRoutes(app, manager);
  const emittedWindowsPath = "C:\\Users\\name\\model.gguf";
  const emittedPosixPath = "/home/name/model.gguf";
  const emittedDataPath = "/data/models/foo.gguf";
  const emittedUncPath = "\\\\server\\share\\model.gguf";
  const result = await manager.startJob({ type: "test", executable: process.execPath, args: ["-e", `console.log(${JSON.stringify(`${emittedWindowsPath} ${emittedPosixPath} ${emittedDataPath} ${emittedUncPath}`)});`] });
  assert.ok(result.job);
  await waitForJob(manager, result.job.id, (item) => item.status === "completed");
  const response = await app.inject({ method: "GET", url: `/api/jobs/${result.job.id}/logs` });
  assert.equal(response.statusCode, 200);
  const text = JSON.stringify(response.json());
  assert.equal(text.includes(emittedWindowsPath), false);
  assert.equal(text.includes(emittedPosixPath), false);
  assert.equal(text.includes(emittedDataPath), false);
  assert.equal(text.includes(emittedUncPath), false);
  assert.equal(text.includes(fixture.root), false);
});
