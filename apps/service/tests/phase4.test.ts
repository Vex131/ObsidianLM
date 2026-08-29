import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import fastify from "fastify";
import { defaultSettings, type DetectedProcess, type GpuMonitoringStatus, type RouterAlias } from "@obsidianlm/shared";
import { createServer } from "../src/server.js";
import { registerMonitoringRoutes } from "../src/api/monitoring.js";
import type { RuntimeManager, RuntimeManagerOptions } from "../src/runtime/manager.js";
import {
  classifyGpuProcesses,
  getGpuMonitoringStatus,
  parseComputeProcessCsv,
  parseGpuCsv,
  type CommandResult,
  type GpuCommandRunner
} from "../src/monitoring/gpu-monitor.js";

const adminToken = "phase4-valid-admin-token";

function authHeader(): { authorization: string } {
  return { authorization: `Bearer ${adminToken}` };
}

async function makeDataFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase4-"));
  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ ...defaultSettings, managedLlamaPort: 18087 }), "utf8");
  return { root, dataDir };
}

async function createFixtureApp(t: TestContext, commandRunner: GpuCommandRunner, runtimeManagerOptions: RuntimeManagerOptions = {}) {
  const fixture = await makeDataFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  const app = await createServer({ gpuMonitorOptions: { commandRunner }, runtimeManagerOptions: { processDetector: async () => ({ processes: [], warnings: [], detectionMethod: "fixture" }), ...runtimeManagerOptions } });
  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { token: adminToken } });
  assert.equal(setup.statusCode, 201);
  t.after(async () => {
    await app.close();
    delete process.env.OBSIDIANLM_DATA_DIR;
  });
  return { app, fixture };
}

function runnerWithOutputs(outputs: string[]): GpuCommandRunner {
  let calls = 0;
  return async (): Promise<CommandResult> => ({ stdout: outputs[calls++] ?? "", stderr: "" });
}

function errorWithCode(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function detectedProcess(pid: number, role: DetectedProcess["role"], ownership: DetectedProcess["ownership"], extra: Partial<DetectedProcess> = {}): DetectedProcess {
  return {
    pid,
    parentPid: null,
    name: "llama-server",
    executablePath: null,
    commandLine: null,
    startedAt: null,
    detectedAt: "2026-01-01T00:00:00.000Z",
    matchedRuntimeType: "llama.cpp",
    kind: "llama_server",
    confidence: "high",
    reasons: [],
    role,
    ownership,
    ...extra
  };
}

const representativeGpuCsv = [
  "0, GPU-111, NVIDIA GeForce RTX 4090, 00000000:01:00.0, 555.85, 12.5, 24564, 1024, 23540, 17, 44, 82.50, 450.00",
  "1, GPU-222, NVIDIA RTX A6000, 00000000:02:00.0, 555.85, 12.5, 49140, 2048, 47092, 0, 35, 20.25, 300.00"
].join("\n");

test("GPU CSV parser handles representative multi-GPU output and numeric conversions", () => {
  const gpus = parseGpuCsv(representativeGpuCsv);

  assert.equal(gpus.length, 2);
  assert.equal(gpus[0].index, 0);
  assert.equal(gpus[0].uuid, "GPU-111");
  assert.equal(gpus[0].name, "NVIDIA GeForce RTX 4090");
  assert.equal(gpus[0].driverVersion, "555.85");
  assert.equal(gpus[0].cudaVersion, "12.5");
  assert.equal(gpus[0].memoryTotalMiB, 24564);
  assert.equal(gpus[0].memoryUsedMiB, 1024);
  assert.equal(gpus[0].memoryFreeMiB, 23540);
  assert.equal(gpus[0].utilizationGpuPercent, 17);
  assert.equal(gpus[0].temperatureGpuC, 44);
  assert.equal(gpus[0].powerDrawW, 82.5);
  assert.equal(gpus[0].powerLimitW, 450);
  assert.equal(gpus[1].index, 1);
  assert.equal(gpus[1].memoryTotalMiB, 49140);
  assert.equal(gpus[1].powerDrawW, 20.25);
});

test("GPU CSV parser maps N/A fields to null without losing valid fields", () => {
  const gpus = parseGpuCsv("0, GPU-NA, NVIDIA Test GPU, 00000000:03:00.0, 555.85, [N/A], 8192, N/A, 8192, [N/A], N/A, N/A, 250.00");

  assert.equal(gpus.length, 1);
  assert.equal(gpus[0].cudaVersion, null);
  assert.equal(gpus[0].memoryTotalMiB, 8192);
  assert.equal(gpus[0].memoryUsedMiB, null);
  assert.equal(gpus[0].memoryFreeMiB, 8192);
  assert.equal(gpus[0].utilizationGpuPercent, null);
  assert.equal(gpus[0].temperatureGpuC, null);
  assert.equal(gpus[0].powerDrawW, null);
  assert.equal(gpus[0].powerLimitW, 250);
});

test("compute process parser handles empty output and N/A memory", () => {
  assert.deepEqual(parseComputeProcessCsv("\n"), []);

  const processes = parseComputeProcessCsv("1234, C:\\llama.cpp\\llama-server.exe, GPU-111, N/A");
  assert.equal(processes.length, 1);
  assert.equal(processes[0].pid, 1234);
  assert.equal(processes[0].processName, "llama-server.exe");
  assert.equal(processes[0].gpuUuid, "GPU-111");
  assert.equal(processes[0].usedMemoryMiB, null);
});

test("GPU process classification distinguishes current managed, possible llama, and unknown processes", () => {
  const gpus = parseGpuCsv(representativeGpuCsv);
  const rawProcesses = parseComputeProcessCsv([
    "1111, C:\\llama.cpp\\llama-server.exe, GPU-111, 1536",
    "2222, /opt/llama.cpp/llama-server, GPU-222, 2048",
    "3333, python.exe, GPU-222, 512"
  ].join("\n"));

  const processes = classifyGpuProcesses(rawProcesses, gpus, 1111);

  assert.equal(processes[0].kind, "current_managed_runtime");
  assert.equal(processes[0].matchedRuntimeType, "llama.cpp");
  assert.equal(processes[0].gpuIndex, 0);
  assert.equal(processes[1].kind, "possible_llama_runtime");
  assert.equal(processes[1].matchedRuntimeType, "llama.cpp");
  assert.equal(processes[1].gpuIndex, 1);
  assert.equal(processes[2].kind, "unknown_gpu_process");
  assert.equal(processes[2].matchedRuntimeType, null);
  assert.equal(processes[2].usedMemoryMiB, 512);
});

test("GPU process classification uses proven router roles, child metadata, and excludes previous candidates", () => {
  const gpus = parseGpuCsv(representativeGpuCsv);
  const rawProcesses = parseComputeProcessCsv([
    "10, router.exe, GPU-111, 100",
    "20, llama-server.exe, GPU-222, 8000",
    "30, llama-server.exe, GPU-222, 200",
    "40, llama-server.exe, GPU-111, 300"
  ].join("\n"));
  const processes = classifyGpuProcesses(rawProcesses, gpus, [
    detectedProcess(10, "managed_router", "proven"),
    detectedProcess(20, "managed_router_child", "proven", { parentPid: 10, configuredModelId: "model_a", routerAlias: "alias-a" as RouterAlias }),
    detectedProcess(30, "managed_router_child", "candidate"),
    detectedProcess(40, "previous_managed_router_child_candidate", "candidate")
  ]);

  assert.deepEqual(processes.map((process) => process.kind), ["managed_router", "possible_llama_runtime", "managed_router_child", "possible_managed_router_child"]);
  assert.equal(processes[2].parentPid, 10);
  assert.equal(processes[2].configuredModelId, "model_a");
  assert.equal(processes[2].routerAlias, "alias-a");
  assert.equal(processes[1].kind, "possible_llama_runtime");
});

test("GPU monitor summarizes router memory, deduplicates rows, and retains PID rows on separate GPUs", async () => {
  const status = await getGpuMonitoringStatus([
    detectedProcess(10, "managed_router", "proven"),
    detectedProcess(20, "managed_router_child", "proven", { parentPid: 10 })
  ], {
    commandRunner: runnerWithOutputs([representativeGpuCsv, [
      "20, llama-server.exe, GPU-222, 8000",
      "10, router.exe, GPU-111, 100",
      "20, llama-server.exe, GPU-222, 8000",
      "20, llama-server.exe, GPU-111, 50",
      "30, llama-server.exe, GPU-111, 400"
    ].join("\n")])
  });

  assert.deepEqual(status.processes.map((process) => [process.gpuIndex, process.pid]), [[0, 10], [0, 20], [0, 30], [1, 20]]);
  assert.equal(status.processes.length, 4);
  assert.equal(status.processes[2].kind, "possible_llama_runtime");
  assert.equal(status.summary.managedRouterGpuMemoryMiB, 100);
  assert.equal(status.summary.managedRouterChildrenGpuMemoryMiB, 8050);
  assert.equal(status.summary.managedRuntimeGpuMemoryMiB, 8150);
  assert.equal(status.summary.currentManagedRuntimeGpuMemoryMiB, 8150);
});

test("GPU monitor warns and avoids managed attribution without process awareness", async () => {
  const status = await getGpuMonitoringStatus(null, {
    commandRunner: runnerWithOutputs([representativeGpuCsv, "10, llama-server.exe, GPU-111, 100"])
  });

  assert.equal(status.processes[0].kind, "possible_llama_runtime");
  assert.ok(status.warnings.some((warning) => warning.code === "process_awareness_unavailable"));
});

test("GPU API reuses proven process awareness for child attribution", async (t) => {
  const awareness = [detectedProcess(10, "managed_router", "proven"), detectedProcess(20, "managed_router_child", "proven", { parentPid: 10, configuredModelId: "model_a" })];
  const manager = { refreshProcessAwareness: async () => ({ processes: awareness, warnings: [], detectionMethod: "fixture" }), setGpuStatusSnapshot: () => {} } as unknown as RuntimeManager;
  const app = fastify({ logger: false });
  await registerMonitoringRoutes(app, manager, { commandRunner: runnerWithOutputs([representativeGpuCsv, "10, router.exe, GPU-111, 100\n20, llama-server.exe, GPU-222, 8000"]) });
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/monitoring/gpu" });
  assert.equal(response.statusCode, 200);
  const body = response.json() as GpuMonitoringStatus;
  assert.deepEqual(body.processes.map((process) => process.kind), ["managed_router", "managed_router_child"]);
  assert.equal(body.processes[1].configuredModelId, "model_a");
  assert.equal(body.summary.currentManagedRuntimeGpuMemoryMiB, 8100);
});

test("GPU API reports unavailable ownership when process detection returns warnings instead of throwing", async (t) => {
  const manager = { refreshProcessAwareness: async () => ({ processes: [], warnings: ["Process detection is unavailable: fixture"], detectionMethod: "fixture", available: false }), setGpuStatusSnapshot: () => {} } as unknown as RuntimeManager;
  const app = fastify({ logger: false });
  await registerMonitoringRoutes(app, manager, { commandRunner: runnerWithOutputs([representativeGpuCsv, "20, llama-server.exe, GPU-222, 8000"]) });
  t.after(async () => app.close());

  const body = (await app.inject({ method: "GET", url: "/api/monitoring/gpu" })).json() as GpuMonitoringStatus;
  assert.equal(body.processes[0].kind, "possible_llama_runtime");
  assert.ok(body.warnings.some((warning) => warning.code === "process_awareness_unavailable"));
});

test("GPU monitor reports missing nvidia-smi without throwing", async () => {
  const status = await getGpuMonitoringStatus(null, {
    commandRunner: async () => {
      throw errorWithCode("ENOENT", "nvidia-smi not found");
    }
  });

  assert.equal(status.available, false);
  assert.equal(status.summary.gpuCount, 0);
  assert.equal(status.warnings[0].code, "nvidia_smi_missing");
  assert.equal(status.summary.warningsCount, 1);
});

test("GPU monitor reports failed nvidia-smi when preferred and fallback queries fail", async () => {
  const status = await getGpuMonitoringStatus(null, {
    commandRunner: async () => {
      throw Object.assign(new Error("query failed"), { stderr: "driver unavailable" });
    }
  });

  assert.equal(status.available, false);
  assert.equal(status.summary.gpuCount, 0);
  assert.equal(status.warnings[0].code, "nvidia_smi_failed");
  assert.match(status.warnings[0].message, /driver unavailable/);
});

test("GET /api/monitoring/gpu returns a stable GPU monitoring shape", async (t) => {
  const { app } = await createFixtureApp(t, runnerWithOutputs([
    representativeGpuCsv,
    "1111, C:\\llama.cpp\\llama-server.exe, GPU-111, 1536\n3333, python.exe, GPU-222, 512"
  ]));

  const response = await app.inject({ method: "GET", url: "/api/monitoring/gpu", headers: authHeader() });
  assert.equal(response.statusCode, 200);
  const body = response.json() as GpuMonitoringStatus;
  assert.equal(body.available, true);
  assert.equal(body.detectionMethod, "nvidia-smi");
  assert.equal(body.driverVersion, "555.85");
  assert.equal(body.cudaVersion, "12.5");
  assert.equal(body.summary.gpuCount, 2);
  assert.equal(body.summary.totalMemoryMiB, 73704);
  assert.equal(body.summary.usedMemoryMiB, 3072);
  assert.equal(body.summary.freeMemoryMiB, 70632);
  assert.equal(body.summary.unknownGpuProcessCount, 1);
  assert.ok(Array.isArray(body.gpus));
  assert.ok(Array.isArray(body.processes));
  assert.ok(Array.isArray(body.warnings));
  assert.equal(typeof body.checkedAt, "string");
  assert.equal(body.gpus[0].processes.length, 1);
  assert.equal(body.processes[0].kind, "possible_llama_runtime");
  assert.equal(body.processes[0].processName, "llama-server.exe");
  assert.doesNotMatch(body.processes[0].processName, /[\\/]/u);

  const status = (await app.inject({ method: "GET", url: "/api/status" })).json();
  assert.equal(status.gpu.available, true);
  assert.equal(status.gpu.gpuCount, body.summary.gpuCount);
  assert.equal(status.gpu.checkedAt, body.checkedAt);
});

test("GET /api/status returns its initialized unavailable GPU snapshot without monitor execution", async (t) => {
  const { app } = await createFixtureApp(t, async () => {
    throw Object.assign(new Error("nvidia-smi failed"), { stderr: "GPU query failed" });
  });

  const response = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.service, "running");
  assert.equal(body.gpu.available, false);
  assert.equal(body.gpu.gpuCount, 0);
  assert.equal(body.gpu.warningsCount, 0);
});

test("GET /api/status uses initialized snapshots without live process or GPU probes", async (t) => {
  let gpuCalls = 0;
  let processCalls = 0;
  const { app } = await createFixtureApp(t, async () => {
    gpuCalls += 1;
    return { stdout: "", stderr: "" };
  }, {
    processDetector: async () => {
      processCalls += 1;
      return { processes: [], warnings: [], detectionMethod: "fixture" };
    }
  });
  assert.equal(app.initialConfig.disableRequestLogging, true);

  const responses = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: "GET", url: "/api/status" })));
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.deepEqual(Object.keys(body.detection).sort(), ["categories", "checkedAt", "ports", "warnings"]);
    assert.deepEqual(Object.keys(body.gpu).sort(), ["available", "checkedAt", "currentManagedRuntimeGpuMemoryMiB", "gpuCount", "totalMemoryMiB", "unknownGpuProcessCount", "usedMemoryMiB", "warningsCount"]);
    assert.equal(body.gpu.available, false);
  }
  assert.equal(processCalls, 0);
  assert.equal(gpuCalls, 0);
});
