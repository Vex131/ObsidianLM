import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import type { RuntimeLogEntry } from "@obsidianlm/shared";
import { registerRuntimeRoutes } from "../src/api/runtime.js";
import { getAppPaths } from "../src/config/paths.js";
import { RuntimeLogBuffer } from "../src/runtime/log-buffer.js";
import { RuntimeManager } from "../src/runtime/manager.js";

interface RuntimeLogsResponseBody {
  logs: RuntimeLogEntry[];
}

function setOrDeleteEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function restoreEnv(t: TestContext): void {
  const originalDataDir = process.env.OBSIDIANLM_DATA_DIR;
  const originalLogDir = process.env.OBSIDIANLM_LOG_DIR;
  const originalLogsDir = process.env.OBSIDIANLM_LOGS_DIR;
  const originalServiceMode = process.env.OBSIDIANLM_SERVICE_MODE;

  t.after(() => {
    setOrDeleteEnv("OBSIDIANLM_DATA_DIR", originalDataDir);
    setOrDeleteEnv("OBSIDIANLM_LOG_DIR", originalLogDir);
    setOrDeleteEnv("OBSIDIANLM_LOGS_DIR", originalLogsDir);
    setOrDeleteEnv("OBSIDIANLM_SERVICE_MODE", originalServiceMode);
  });
}

async function makeFixture(t: TestContext) {
  restoreEnv(t);
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase8-"));
  const dataDir = path.join(root, "data");
  const logsDir = path.join(root, "logs");
  await mkdir(dataDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  process.env.OBSIDIANLM_DATA_DIR = dataDir;
  process.env.OBSIDIANLM_LOG_DIR = logsDir;
  delete process.env.OBSIDIANLM_LOGS_DIR;
  return { root, dataDir, logsDir, runtimeLogsDir: path.join(logsDir, "runtimes") };
}

function logEntry(id: number, message = `line-${id}`, source: RuntimeLogEntry["source"] = "stdout"): RuntimeLogEntry {
  return {
    id,
    sequence: id,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, id % 60)).toISOString(),
    source,
    stream: source,
    message
  };
}

async function writeJsonl(filePath: string, entries: RuntimeLogEntry[]): Promise<void> {
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
}

async function createRuntimeApp(logs = new RuntimeLogBuffer()) {
  const manager = new RuntimeManager(logs);
  const app = fastify({ logger: false });
  await registerRuntimeRoutes(app, manager);
  return { app, manager, logs };
}

class SlowRuntimeLogBuffer extends RuntimeLogBuffer {
  resolveRecent: (() => void) | null = null;

  override async getRecent(limit?: number): Promise<RuntimeLogEntry[]> {
    await new Promise<void>((resolve) => {
      this.resolveRecent = resolve;
    });
    return super.getRecent(limit);
  }
}

test("RuntimeLogBuffer reads recent structured entries from the runtime log file", async (t) => {
  await makeFixture(t);
  const logs = new RuntimeLogBuffer();
  const logFile = await logs.startLogFile("daily-profile");
  await writeJsonl(logFile, [logEntry(1, "first"), logEntry(2, "second", "stderr"), logEntry(3, "third", "system")]);

  const recent = await logs.getRecent(2);

  assert.deepEqual(recent.map((entry) => entry.message), ["second", "third"]);
  assert.deepEqual(recent.map((entry) => entry.source), ["stderr", "system"]);
  assert.equal(recent[0]?.stream, "stderr");
});

test("RuntimeLogBuffer applies default and maximum recent-log limits", async (t) => {
  await makeFixture(t);
  const logs = new RuntimeLogBuffer();
  const logFile = await logs.startLogFile("limit-profile");
  await writeJsonl(
    logFile,
    Array.from({ length: 2105 }, (_, index) => logEntry(index + 1))
  );

  const defaultRecent = await logs.getRecent();
  const overMaxRecent = await logs.getRecent(9999);

  assert.equal(defaultRecent.length, 300);
  assert.equal(defaultRecent[0]?.sequence, 1806);
  assert.equal(defaultRecent.at(-1)?.sequence, 2105);
  assert.equal(overMaxRecent.length, 2000);
  assert.equal(overMaxRecent[0]?.sequence, 106);
  assert.equal(overMaxRecent.at(-1)?.sequence, 2105);
});

test("RuntimeLogBuffer returns an empty safe response when the active log file is missing", async (t) => {
  await makeFixture(t);
  const logs = new RuntimeLogBuffer();
  const logFile = await logs.startLogFile("missing-file-profile");
  await rm(logFile, { force: true });

  assert.deepEqual(await logs.getRecent(20), []);
});

test("RuntimeLogBuffer combines persisted runtime logs with memory-only system entries", async (t) => {
  const fixture = await makeFixture(t);
  await mkdir(fixture.runtimeLogsDir, { recursive: true });
  await writeJsonl(path.join(fixture.runtimeLogsDir, "2026-01-01-runtime.jsonl"), [logEntry(1, "persisted runtime line")]);
  const logs = new RuntimeLogBuffer();

  logs.add("system", "memory-only startup warning");
  const recent = await logs.getRecent(10);

  assert.deepEqual(recent.map((entry) => entry.message), ["persisted runtime line", "memory-only startup warning"]);
});

test("RuntimeLogBuffer deduplicates memory entries already present in the active runtime log file", async (t) => {
  await makeFixture(t);
  const logs = new RuntimeLogBuffer();
  await logs.startLogFile("dedupe-profile");
  const entry = logs.add("stdout", "single runtime line");
  const deadline = Date.now() + 1000;
  let recent = await logs.getRecent(10);
  while (recent.length !== 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    recent = await logs.getRecent(10);
  }

  assert.deepEqual(recent.map((item) => item.message), [entry.message]);
});

test("runtime log files honor service-mode log directory overrides", async (t) => {
  const fixture = await makeFixture(t);
  process.env.OBSIDIANLM_SERVICE_MODE = "1";
  const logs = new RuntimeLogBuffer();
  const logFile = await logs.startLogFile("service-profile");
  await writeJsonl(logFile, [logEntry(1, "service mode log")]);

  const paths = getAppPaths();
  assert.equal(paths.serviceMode, true);
  assert.equal(paths.logDirMode, "custom");
  assert.equal(paths.logsDir, fixture.logsDir);
  assert.equal(path.dirname(logFile), paths.runtimeLogsDir);
  assert.equal(logFile.startsWith(fixture.runtimeLogsDir), true);
  assert.equal((await logs.getRecent(1))[0]?.message, "service mode log");
});

test("GET /api/runtime/logs returns logs from runtime log storage and ignores traversal query params", async (t) => {
  const fixture = await makeFixture(t);
  await mkdir(fixture.runtimeLogsDir, { recursive: true });
  const runtimeLogFile = path.join(fixture.runtimeLogsDir, "2026-01-01-runtime.jsonl");
  const outsideSecret = path.join(fixture.root, "secret.jsonl");
  await writeJsonl(runtimeLogFile, [logEntry(1, "safe runtime line")]);
  await writeJsonl(outsideSecret, [logEntry(99, "do not leak this outside file")]);

  const { app } = await createRuntimeApp();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: `/api/runtime/logs?limit=5&file=${encodeURIComponent(`..${path.sep}secret.jsonl`)}` });
  assert.equal(response.statusCode, 200);
  const body = response.json() as RuntimeLogsResponseBody;
  assert.deepEqual(body.logs.map((entry) => entry.message), ["safe runtime line"]);
  assert.equal(JSON.stringify(body).includes("do not leak"), false);
});

test("GET /api/runtime/logs/stream sends SSE headers, an initial connection event, and cleans up listeners", async (t) => {
  await makeFixture(t);
  const logs = new RuntimeLogBuffer();
  const { app } = await createRuntimeApp(logs);
  t.after(async () => app.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;
  assert.ok(address);

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/runtime/logs/stream?limit=1`, { signal: controller.signal });

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

  let listenerDeadline = Date.now() + 1000;
  while ((logs as unknown as { listeners: Set<unknown> }).listeners.size !== 1 && Date.now() < listenerDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  logs.add("stdout", "streamed test line");
  let streamText = text;
  listenerDeadline = Date.now() + 1000;
  while (!streamText.includes("streamed test line") && Date.now() < listenerDeadline) {
    const nextChunk = await reader.read();
    assert.equal(nextChunk.done, false);
    streamText += new TextDecoder().decode(nextChunk.value);
  }
  assert.match(streamText, /event: log\ndata: .*streamed test line/u);

  controller.abort();
  try {
    await reader.cancel();
  } catch {
    // The abort may already have closed the stream.
  }

  const deadline = Date.now() + 1000;
  while ((logs as unknown as { listeners: Set<unknown> }).listeners.size !== 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((logs as unknown as { listeners: Set<unknown> }).listeners.size, 0);
});

test("GET /api/runtime/logs/stream does not leak listeners when the client disconnects during history load", async (t) => {
  await makeFixture(t);
  const logs = new SlowRuntimeLogBuffer();
  const { app } = await createRuntimeApp(logs);
  t.after(async () => app.close());
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;
  assert.ok(address);

  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/runtime/logs/stream?limit=1`, { signal: controller.signal });
  const reader = response.body?.getReader();
  assert.ok(reader);
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  assert.match(new TextDecoder().decode(firstChunk.value), /event: connection/u);

  controller.abort();
  try {
    await reader.cancel();
  } catch {
    // The abort may already have closed the stream.
  }
  logs.resolveRecent?.();

  const deadline = Date.now() + 1000;
  while ((logs as unknown as { listeners: Set<unknown> }).listeners.size !== 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((logs as unknown as { listeners: Set<unknown> }).listeners.size, 0);
});
