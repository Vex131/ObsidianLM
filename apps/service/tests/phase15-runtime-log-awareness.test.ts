import assert from "node:assert/strict";
import test from "node:test";
import type { DetectedProcess, RouterAlias } from "@obsidianlm/shared";
import { RuntimeLogBuffer } from "../src/runtime/log-buffer.js";
import { RuntimeManager } from "../src/runtime/manager.js";

type OutputHarness = {
  processAwareness: DetectedProcess[];
  captureOutput(stream: "stdout" | "stderr", data: Buffer, child?: unknown, runtimeId?: unknown): void;
  flushPartialOutput(): void;
};

function harness(): { logs: RuntimeLogBuffer; output: OutputHarness } {
  const logs = new RuntimeLogBuffer();
  const manager = new RuntimeManager(logs);
  return { logs, output: manager as unknown as OutputHarness };
}

function child(port: number): DetectedProcess {
  return {
    pid: 200,
    parentPid: 100,
    name: "llama-server.exe",
    executablePath: "C:\\llama\\llama-server.exe",
    commandLine: null,
    startedAt: null,
    detectedAt: new Date(0).toISOString(),
    matchedRuntimeType: "llama.cpp",
    kind: "llama_server",
    confidence: "high",
    reasons: [],
    role: "managed_router_child",
    ownership: "proven",
    configuredModelId: "model_a",
    routerAlias: "alias-a" as RouterAlias,
    childPort: port
  };
}

test("runtime output distinguishes router, proven child, and unknown child-prefix logs", () => {
  const { logs, output } = harness();
  output.processAwareness = [child(39015)];

  output.captureOutput("stdout", Buffer.from("srv main: listening\n[39015] slot print_timing: ok\n[39016] unknown output\n"));

  const entries = logs.getRecentFromMemory();
  assert.deepEqual(entries.map((entry) => entry.origin), ["router", "router_child", "router_child_candidate"]);
  assert.equal(entries[1].message, "slot print_timing: ok");
  assert.equal(entries[1].pid, 200);
  assert.equal(entries[1].configuredModelId, "model_a");
  assert.equal(entries[2].message, "[39016] unknown output");
  assert.equal(entries[2].configuredModelId, undefined);
});

test("runtime output reassembles split prefixes and keeps stdout and stderr tails independent", () => {
  const { logs, output } = harness();
  output.processAwareness = [child(39015)];

  output.captureOutput("stdout", Buffer.from("[390"));
  output.captureOutput("stderr", Buffer.from("stderr tail"));
  output.captureOutput("stdout", Buffer.from("15] slot print_"));
  output.captureOutput("stdout", Buffer.from("timing...\n"));
  output.flushPartialOutput();

  const entries = logs.getRecentFromMemory();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].origin, "router_child");
  assert.equal(entries[0].message, "slot print_timing...");
  assert.equal(entries[1].source, "stderr");
  assert.equal(entries[1].message, "stderr tail");
});

test("unterminated runtime output is bounded and subsequent lines remain visible", () => {
  const { logs, output } = harness();
  output.captureOutput("stdout", Buffer.from(`${"x".repeat(70 * 1024)}\nnext line\n`));

  const entries = logs.getRecentFromMemory();
  assert.equal(entries.length, 2);
  assert.match(entries[0].message, /truncated: runtime output line/u);
  assert.ok(Buffer.byteLength(entries[0].message) < 66 * 1024);
  assert.equal(entries[1].message, "next line");
});

test("output from a replaced router identity cannot inherit target runtime attribution", () => {
  const { logs, output } = harness();
  const source = {};
  const target = {};
  Object.assign(output, { child: target, routerState: { activeRuntimeId: "router_target" }, processAwareness: [child(39015)] });

  output.captureOutput("stdout", Buffer.from("[39015] stale source line\n"), source, "router_source");

  assert.deepEqual(logs.getRecentFromMemory(), []);
});
