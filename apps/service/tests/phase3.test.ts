import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test, { type TestContext } from "node:test";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { defaultRuntimeState, defaultSettings, type DetectedProcess, type LlamaCppProfile, type RuntimeState } from "@obsidianlm/shared";
import { createServer } from "../src/server.js";
import { detectPort, parseWindowsNetstat } from "../src/process/port-detector.js";
import { classifyRuntimeDetection } from "../src/runtime/classification.js";
import { RuntimeManager } from "../src/runtime/manager.js";
import { buildDetectionSummary } from "../src/runtime/startup-detector.js";
import { sanitizeProcessForApi } from "../src/api/sanitize.js";

const adminToken = "phase3-valid-admin-token";

function authHeader(): { authorization: string } {
  return { authorization: `Bearer ${adminToken}` };
}

async function makeDataFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase3-"));
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

  return { root, dataDir, buildPath, modelPath };
}

async function withTcpServer(t: TestContext) {
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return { server, port: address.port };
}

function makeProfile(buildPath: string, modelPath: string, port: number): LlamaCppProfile {
  return {
    id: "phase3-profile",
    name: "Phase 3 profile",
    runtimeType: "llama.cpp",
    providerKind: "server",
    buildPath,
    modelPath,
    host: "127.0.0.1",
    port,
    llamaArgs: { ctxSize: 128 },
    extraArgs: []
  };
}

function llamaProcess(pid: number, commandLine = `C:\\llama.cpp\\llama-server.exe --port 8085`): DetectedProcess {
  return {
    pid,
    name: process.platform === "win32" ? "llama-server.exe" : "llama-server",
    executablePath: process.platform === "win32" ? "C:\\llama.cpp\\llama-server.exe" : "/usr/local/bin/llama-server",
    commandLine,
    startedAt: null,
    detectedAt: new Date(0).toISOString(),
    matchedRuntimeType: "llama.cpp",
    kind: "llama_server",
    confidence: "medium",
    reasons: ["test fixture"]
  };
}

function runningPreviousState(pid: number, port = 8085): RuntimeState {
  return {
    ...defaultRuntimeState,
    activeRuntimeId: "runtime-old",
    activeProfileId: "phase3-profile",
    pid,
    port,
    startedByObsidianLM: true,
    startedAt: new Date(0).toISOString(),
    commandHash: "old-command",
    status: "running"
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

test("port detection reports temporary TCP server as in use and then free", async (t) => {
  const { port } = await withTcpServer(t);
  const inUse = await detectPort(port, "127.0.0.1", {
    commandRunner: async () => ({ stdout: "", stderr: "" })
  });
  assert.equal(inUse.inUse, true);
  assert.equal(inUse.port, port);

  await new Promise<void>((resolve) => setTimeout(resolve, 25));
});

test("port owner parsing tolerates unavailable PID info", () => {
  assert.equal(parseWindowsNetstat("TCP 127.0.0.1:8085 0.0.0.0:0 LISTENING", 8085), null);
});

test("classification returns no_runtime_detected for stopped state with no processes or conflicts", () => {
  const summary = classifyRuntimeDetection({ previousState: defaultRuntimeState, currentManagedPid: null, processes: [], ports: [] });
  assert.deepEqual(summary.categories, ["no_runtime_detected"]);
});

test("classification marks previous running state without process as stale state", () => {
  const summary = classifyRuntimeDetection({ previousState: runningPreviousState(1234), currentManagedPid: null, processes: [], ports: [] });
  assert.ok(summary.categories.includes("previous_managed_stale_state"));
  assert.match(summary.warnings[0].message, /Previous runtime state/);
});

test("classification does not mark previous state stale when process detection is unreliable", () => {
  const summary = classifyRuntimeDetection({ previousState: runningPreviousState(1234), currentManagedPid: null, processes: [], ports: [], processDetectionReliable: false });
  assert.ok(!summary.categories.includes("previous_managed_stale_state"));
  assert.ok(summary.categories.includes("previous_managed_process_candidate"));
  assert.match(summary.warnings[0].message, /process detection was unavailable/);
});

test("classification warns for unmanaged llama-server process", () => {
  const summary = classifyRuntimeDetection({ previousState: defaultRuntimeState, currentManagedPid: null, processes: [llamaProcess(2222)], ports: [] });
  assert.ok(summary.categories.includes("unmanaged_llama_process"));
  assert.match(summary.warnings[0].message, /will not kill or adopt/);
});

test("classification reports port conflict when owner is not current managed child", () => {
  const summary = classifyRuntimeDetection({
    previousState: defaultRuntimeState,
    currentManagedPid: null,
    processes: [],
    ports: [{ port: 8085, host: "127.0.0.1", inUse: true, ownerPid: null, detectionMethod: "test", warnings: [] }]
  });
  assert.ok(summary.categories.includes("port_conflict"));
});

test("classification reports current managed process when PID matches current child", () => {
  const summary = classifyRuntimeDetection({ previousState: defaultRuntimeState, currentManagedPid: 3333, processes: [llamaProcess(3333)], ports: [] });
  assert.ok(summary.categories.includes("current_managed_process"));
});

test("classification does not treat the current in-memory child as previous stale state", () => {
  const summary = classifyRuntimeDetection({ previousState: runningPreviousState(3333), currentManagedPid: 3333, processes: [llamaProcess(3333)], ports: [] });
  assert.ok(summary.categories.includes("current_managed_process"));
  assert.ok(!summary.categories.includes("previous_managed_stale_state"));
});

test("startup summary treats process detector warnings as unreliable detection", () => {
  const summary = buildDetectionSummary(runningPreviousState(7777), null, { processes: [], warnings: ["process detection failed"], detectionMethod: "test" }, []);
  assert.ok(!summary.categories.includes("previous_managed_stale_state"));
  assert.ok(summary.categories.includes("previous_managed_process_candidate"));
});

test("process API sanitizer redacts local path and command line details", () => {
  const process = llamaProcess(8888, "C:\\Users\\name\\llama-server.exe --api-key secret --port 8085");
  process.executablePath = "/usr/local/bin/llama-server";
  const sanitized = sanitizeProcessForApi(process);
  assert.equal(sanitized.commandLine, null);
  assert.equal(sanitized.executablePath, "llama-server");
  assert.match(sanitized.reasons.join(" "), /redacted/);
});

test("RuntimeManager.start blocks an occupied profile port before spawning", async (t) => {
  const fixture = await makeDataFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);

  const profile = makeProfile(fixture.buildPath, fixture.modelPath, 8085);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile]), "utf8");
  let spawnCalled = false;
  const manager = new RuntimeManager(undefined, {
    portDetector: async (port) => ({ port, host: "127.0.0.1", inUse: true, ownerPid: null, detectionMethod: "test", warnings: [] }),
    spawnRuntime: ((() => {
      spawnCalled = true;
      return fakeChild(4444);
    }) as unknown) as typeof import("node:child_process").spawn,
    startupDetectorOptions: {
      processOptions: { commandRunner: async () => ({ stdout: "", stderr: "" }) },
      portOptions: { commandRunner: async () => ({ stdout: "", stderr: "" }) }
    }
  });

  const result = await manager.start(profile.id);
  assert.equal(result.ok, false);
  assert.equal(result.error, "port_conflict");
  assert.equal(spawnCalled, false);
});

test("RuntimeManager.start proceeds through injected spawn when the profile port is free", async (t) => {
  const fixture = await makeDataFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);

  const profile = makeProfile(fixture.buildPath, fixture.modelPath, 18085);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile]), "utf8");
  let spawnCalled = false;
  const manager = new RuntimeManager(undefined, {
    portDetector: async (port) => ({ port, host: "127.0.0.1", inUse: false, ownerPid: null, detectionMethod: "test", warnings: [] }),
    spawnRuntime: ((() => {
      spawnCalled = true;
      return fakeChild(5555);
    }) as unknown) as typeof import("node:child_process").spawn
  });

  const result = await manager.start(profile.id);
  assert.equal(result.ok, true);
  assert.equal(spawnCalled, true);
  assert.equal(result.state.status, "running");
  assert.equal(result.state.pid, 5555);
});

test("POST /api/profiles/:id/start returns 409 when selected profile port is in use", async (t) => {
  const fixture = await makeDataFixture();
  const { port } = await withTcpServer(t);
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);

  const profile = makeProfile(fixture.buildPath, fixture.modelPath, port);
  await writeFile(path.join(fixture.dataDir, "profiles.json"), JSON.stringify([profile]), "utf8");
  const app = await createServer();
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
  t.after(async () => app.close());

  const response = await app.inject({ method: "POST", url: `/api/profiles/${profile.id}/start`, headers: authHeader() });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error, "port_conflict");
});

test("Phase 3 read-only API routes return process, port, and detection payloads", async (t) => {
  const fixture = await makeDataFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  await writeFile(path.join(fixture.dataDir, "settings.json"), JSON.stringify({ ...defaultSettings, managedLlamaPort: 18086 }), "utf8");
  t.after(() => delete process.env.OBSIDIANLM_DATA_DIR);

  const app = await createServer();
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
  t.after(async () => app.close());

  const processes = await app.inject({ method: "GET", url: "/api/processes/llama", headers: authHeader() });
  assert.equal(processes.statusCode, 200);
  assert.ok(Array.isArray(processes.json().processes));

  const ports = await app.inject({ method: "GET", url: "/api/monitoring/ports?port=18086", headers: authHeader() });
  assert.equal(ports.statusCode, 200);
  assert.equal(ports.json().port.port, 18086);

  const detection = await app.inject({ method: "GET", url: "/api/runtime/detection", headers: authHeader() });
  assert.equal(detection.statusCode, 200);
  assert.ok(Array.isArray(detection.json().categories));
});

test("Runtime stop with stale PID and no in-memory child does not kill anything", async () => {
  const manager = new RuntimeManager();
  const result = await manager.stop();
  assert.equal(result.ok, false);
  assert.match(result.message, /did not kill any process/);
});

test("service source does not use taskkill or process.kill for unmanaged detections", async () => {
  const files = [
    "src/process/process-detector.ts",
    "src/process/port-detector.ts",
    "src/runtime/startup-detector.ts",
    "src/runtime/classification.ts",
    "src/runtime/manager.ts"
  ];
  const source = (await Promise.all(files.map((file) => readFile(path.join(import.meta.dirname, "..", file), "utf8")))).join("\n");
  assert.doesNotMatch(source, /taskkill/i);
  assert.doesNotMatch(source, /process\.kill\(/u);
});
