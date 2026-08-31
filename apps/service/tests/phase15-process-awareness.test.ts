import assert from "node:assert/strict";
import test from "node:test";
import fastify from "fastify";
import type {
  DetectedProcess,
  RouterProcessAwarenessContext,
} from "@obsidianlm/shared";
import { registerProcessRoutes } from "../src/api/processes.js";
import type { RuntimeManager } from "../src/runtime/manager.js";
import {
  classifyRouterProcesses,
  parseRouterProcessCommandLine,
} from "../src/process/process-awareness.js";
import { detectLlamaServerProcesses } from "../src/process/process-detector.js";

const context: RouterProcessAwarenessContext = {
  runtimeId: null,
  routerPid: 100,
  activeBuildId: null,
  buildServerLocator: "C:/llama/llama-server.exe",
  ownershipEvidence: "current_process_child",
  expectedModels: [
    { configuredModelId: "model-a" as any, routerAlias: "alpha" as any },
  ],
  previousRouterPid: 90,
  previousBuildServerLocator: "C:/llama/llama-server.exe",
};
const detected = (
  pid: number,
  parentPid: number | null,
  commandLine: string | null = "llama-server --alias alpha --port 8080",
  executablePath: string | null = "C:\\llama\\llama-server.exe",
): DetectedProcess => ({
  pid,
  parentPid,
  name: "llama-server.exe",
  executablePath,
  commandLine,
  startedAt: null,
  detectedAt: new Date(0).toISOString(),
  matchedRuntimeType: "llama.cpp",
  kind: "llama_server",
  confidence: "medium",
  reasons: [],
});

test("router process awareness requires current ownership proof and exact full executable paths", () => {
  const classified = classifyRouterProcesses(
    [
      detected(103, 999, "llama-server"),
      detected(101, 100),
      detected(100, null, null, "C:\\router.exe"),
      detected(102, 100, "llama-server", "C:\\other\\llama-server.exe"),
    ],
    context,
  );
  assert.deepEqual(
    classified.map((process) => process.role),
    [
      "managed_router",
      "managed_router_child",
      "unmanaged_llama_server",
      "unmanaged_llama_server",
    ],
  );
  assert.equal(classified[1].configuredModelId, "model-a");
  assert.equal(classified[1].childPort, 8080);
  assert.equal(
    classifyRouterProcesses([detected(101, 100)], {
      ...context,
      ownershipEvidence: "persisted_candidate",
    })[0].role,
    "unmanaged_llama_server",
  );
});

test("proven child ownership survives unknown alias while missing paths and stale parent PIDs remain unproven", () => {
  const classified = classifyRouterProcesses(
    [
      detected(201, 100, "llama-server --alias unknown --port 39015"),
      detected(202, 100, "llama-server --alias alpha", null),
      detected(203, 90),
    ],
    { ...context, previousRouterPid: 90 },
  );
  assert.equal(classified[0].role, "managed_router_child");
  assert.equal(classified[0].configuredModelId, undefined);
  assert.equal(classified[1].role, "unmanaged_llama_server");
  assert.equal(classified[2].role, "unmanaged_llama_server");
});

test("router process awareness classifies live previous candidates and avoids duplicate attribution", () => {
  const classified = classifyRouterProcesses(
    [
      detected(92, 90, "llama-server --alias alpha --port 8081"),
      detected(90, null),
      detected(91, 90, "llama-server --alias alpha --port 8081"),
    ],
    context,
  );
  assert.deepEqual(
    classified.map((process) => process.pid),
    [90, 91, 92],
  );
  assert.deepEqual(
    classified.map((process) => process.role),
    [
      "previous_managed_router_candidate",
      "previous_managed_router_child_candidate",
      "previous_managed_router_child_candidate",
    ],
  );
  assert.equal(classified[1].configuredModelId, undefined);
  assert.equal(classified[1].childPort, undefined);
  assert.match(classified[1].reasons.join(" "), /duplicated/);
});

test("command parsing accepts quoted clean values and rejects malformed values", () => {
  assert.deepEqual(
    parseRouterProcessCommandLine('llama-server --alias "alpha" --port=8081'),
    { routerAlias: "alpha", childPort: 8081 },
  );
  assert.deepEqual(
    parseRouterProcessCommandLine(
      'llama-server --alias="alpha beta" --port=bad',
    ),
    { routerAlias: null, childPort: null },
  );
  assert.deepEqual(
    parseRouterProcessCommandLine('llama-server --alias "unterminated'),
    { routerAlias: null, childPort: null },
  );
  assert.deepEqual(
    parseRouterProcessCommandLine(
      "llama-server --alias alpha --alias beta --alias alpha --port 1 --port 2 --port 3",
    ),
    { routerAlias: null, childPort: null },
  );
  assert.deepEqual(
    parseRouterProcessCommandLine(
      "llama-server --alias alpha --alias --port 39015 --port bad",
    ),
    { routerAlias: null, childPort: null },
  );
});

test("process detector includes POSIX parents and ignores malformed rows", async () => {
  const result = await detectLlamaServerProcesses({
    platform: "linux",
    now: () => new Date(0),
    commandRunner: async () => ({
      stdout:
        "10 2 llama-server llama-server --port 8080\n11 nope llama-server llama-server\nbad row",
      stderr: "",
    }),
  });
  assert.equal(result.detectionMethod, "ps -axo pid=,ppid=,comm=,args=");
  assert.deepEqual(
    result.processes.map(({ pid, parentPid }) => ({ pid, parentPid })),
    [
      { pid: 10, parentPid: 2 },
      { pid: 11, parentPid: null },
    ],
  );
});

test("process detector requests Windows parent process IDs", async () => {
  let query = "";
  const result = await detectLlamaServerProcesses({
    platform: "win32",
    commandRunner: async (_file, args) => {
      query = args.at(-1) ?? "";
      return {
        stdout: JSON.stringify({
          ProcessId: 20,
          ParentProcessId: "invalid",
          Name: "llama-server.exe",
          ExecutablePath: "C:\\llama\\llama-server.exe",
        }),
        stderr: "",
      };
    },
  });
  assert.match(query, /ParentProcessId/);
  assert.deepEqual(
    result.processes.map(({ pid, parentPid }) => ({ pid, parentPid })),
    [{ pid: 20, parentPid: null }],
  );
});

test("process API preserves safe awareness metadata while redacting paths and command lines", async (t) => {
  const process = {
    ...detected(200, 100),
    role: "managed_router_child" as const,
    ownership: "proven" as const,
    configuredModelId: "model-a" as any,
    routerAlias: "alpha" as any,
    childPort: 39015,
  };
  const manager = {
    refreshProcessAwareness: async () => ({
      processes: [process],
      warnings: [],
      detectionMethod: "test",
    }),
  } as unknown as RuntimeManager;
  const app = fastify({ logger: false });
  await registerProcessRoutes(app, manager);
  t.after(async () => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/processes/llama",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json() as { processes: DetectedProcess[] };
  assert.equal(body.processes[0].parentPid, 100);
  assert.equal(body.processes[0].role, "managed_router_child");
  assert.equal(body.processes[0].configuredModelId, "model-a");
  assert.equal(body.processes[0].childPort, 39015);
  assert.equal(body.processes[0].commandLine, null);
  assert.equal(body.processes[0].executablePath, "llama-server.exe");
  assert.equal("actions" in body.processes[0], false);
});
