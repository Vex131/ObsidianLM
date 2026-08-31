import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import { registerRuntimeRoutes } from "../src/api/runtime.js";
import { registerSettingsRoutes } from "../src/api/settings.js";
import { createServer } from "../src/server.js";
import { ensureStorageFiles, loadSettings } from "../src/config/storage.js";
import { RuntimeLogBuffer } from "../src/runtime/log-buffer.js";
import { RuntimeManager } from "../src/runtime/manager.js";

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

async function createRuntimeLogsApp(t: TestContext) {
  await makeFixture(t);
  await ensureStorageFiles();
  const logs = new RuntimeLogBuffer();
  const manager = new RuntimeManager(logs);
  const app = fastify({ logger: false });
  await registerRuntimeRoutes(app, manager);
  t.after(async () => app.close());
  return { app, logs };
}

test("runtime logs routes are available without credentials", async (t) => {
  const { app } = await createRuntimeLogsApp(t);

  const logsNoToken = await app.inject({
    method: "GET",
    url: "/api/runtime/logs",
  });
  assert.equal(logsNoToken.statusCode, 200);
  assert.deepEqual(logsNoToken.json().logs, []);
});

test("runtime log stream sends valid SSE headers and events", async (t) => {
  const { app, logs } = await createRuntimeLogsApp(t);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address() as AddressInfo | null;
  assert.ok(address);

  const controller = new AbortController();
  const response = await fetch(
    `http://127.0.0.1:${address.port}/api/runtime/logs/stream?limit=1`,
    { signal: controller.signal },
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("content-type")?.startsWith("text/event-stream"),
    true,
  );
  assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
  assert.equal(response.headers.get("connection"), "keep-alive");

  const reader = response.body?.getReader();
  assert.ok(reader);
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  const text = new TextDecoder().decode(firstChunk.value);
  assert.match(text, /event: connection\ndata: \{"ok":true,"state":/u);

  logs.add("stdout", "streamed runtime line");
  let streamText = text;
  const deadline = Date.now() + 1000;
  while (
    !streamText.includes("streamed runtime line") &&
    Date.now() < deadline
  ) {
    const nextChunk = await reader.read();
    assert.equal(nextChunk.done, false);
    streamText += new TextDecoder().decode(nextChunk.value);
  }
  assert.match(streamText, /event: log\ndata: .*streamed runtime line/u);

  controller.abort();
  try {
    await reader.cancel();
  } catch {
    // The abort may already have closed the stream.
  }
});
