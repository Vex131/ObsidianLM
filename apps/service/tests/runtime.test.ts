import assert from "node:assert/strict";
import test from "node:test";
import type { LlamaCppProfile } from "@obsidianlm/shared";
import { buildLlamaCppServerCommand } from "../src/runtime/command.js";
import { validateProfile } from "../src/runtime/profiles.js";
import { RuntimeManager } from "../src/runtime/manager.js";

const representativeProfile: LlamaCppProfile = {
  id: "example-local-llama-server",
  name: "Example local llama.cpp server",
  runtimeType: "llama.cpp",
  providerKind: "server",
  buildPath: "C:\\llama.cpp\\llama-server.exe",
  modelPath: "D:\\Models\\qwen.gguf",
  host: "0.0.0.0",
  port: 8085,
  llamaArgs: {
    ctxSize: 262144,
    gpuLayers: "all",
    devices: ["CUDA0", "CUDA1"],
    splitMode: "layer",
    tensorSplit: "5,3",
    cacheTypeK: "q8_0",
    cacheTypeV: "q8_0",
    flashAttention: true,
    batchSize: 4096,
    ubatchSize: 1024,
    parallel: 1,
    threads: 8,
    threadsBatch: 16,
    contBatching: true,
    metrics: true,
    webui: true
  },
  extraArgs: ["--timeout", "3600"]
};

test("buildLlamaCppServerCommand maps profile fields to llama-server args", () => {
  const command = buildLlamaCppServerCommand(representativeProfile);

  assert.equal(command.executable, representativeProfile.buildPath);
  assert.deepEqual(command.args, [
    "--model",
    representativeProfile.modelPath,
    "--host",
    "0.0.0.0",
    "--port",
    "8085",
    "--ctx-size",
    "262144",
    "--n-gpu-layers",
    "all",
    "--device",
    "CUDA0",
    "--device",
    "CUDA1",
    "--split-mode",
    "layer",
    "--tensor-split",
    "5,3",
    "--cache-type-k",
    "q8_0",
    "--cache-type-v",
    "q8_0",
    "--flash-attn",
    "on",
    "--batch-size",
    "4096",
    "--ubatch-size",
    "1024",
    "--parallel",
    "1",
    "--threads",
    "8",
    "--threads-batch",
    "16",
    "--cont-batching",
    "--metrics",
    "--webui",
    "--timeout",
    "3600"
  ]);
  assert.match(command.displayCommand, /llama-server\.exe/);
  assert.match(command.displayCommand, /--model/);
  assert.equal(command.commandHash.length, 16);
});

test("validateProfile returns clear errors for missing buildPath", async () => {
  const result = await validateProfile({
    ...representativeProfile,
    buildPath: ""
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("buildPath is required."));
});

test("validateProfile returns clear errors for missing modelPath", async () => {
  const result = await validateProfile({
    ...representativeProfile,
    modelPath: ""
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("modelPath is required."));
});

test("validateProfile rejects unsupported runtimeType", async () => {
  const result = await validateProfile({
    ...representativeProfile,
    runtimeType: "ollama"
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("Unsupported runtimeType. Phase 1 only supports llama.cpp."));
});

test("validateProfile rejects malformed llamaArgs values", async () => {
  const result = await validateProfile({
    ...representativeProfile,
    llamaArgs: {
      ...representativeProfile.llamaArgs,
      ctxSize: "bad"
    }
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("llamaArgs.ctxSize must be a number when provided."));
});

test("RuntimeManager stop does not kill anything without an in-memory child", async () => {
  const manager = new RuntimeManager();
  const result = await manager.stop();

  assert.equal(result.ok, false);
  assert.match(result.message, /did not kill any process/);
});
