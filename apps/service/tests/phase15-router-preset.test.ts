import assert from "node:assert/strict";
import test from "node:test";
import { createConfiguredModelId, createLlamaCppBuildId, createModelArtifactId, createRouterAlias, type ConfiguredModel, type LlamaBuildCapabilitiesManifest, type LlamaCppBuild } from "@obsidianlm/shared";
import { analyzeRouterPreset, buildRouterLaunchPreview, generateRouterPreset, RouterPresetError, type RouterPresetDependencies } from "../src/router/preset-generator.js";
import { routerAutoloadArgument } from "../src/router/autoload-policy.js";
import type { Phase15DomainSnapshot } from "../src/config/phase15-domain.js";

const buildId = createLlamaCppBuildId("preset"); const modelId = createConfiguredModelId("preset"); const artifactId = createModelArtifactId("preset");
const local = (locator: string) => ({ owner: { scope: "local" as const }, locator });
const valueFlags = ["--host", "--port", "--models-preset", "--models-max", "--ctx-size", "--n-gpu-layers", "--device", "--split-mode", "--tensor-split", "--cache-type-k", "--cache-type-v", "--flash-attn", "--batch-size", "--ubatch-size", "--parallel", "--threads", "--threads-batch", "--mmproj", "--safe-value"];
const manifest = (): LlamaBuildCapabilitiesManifest => ({ buildId, serverPath: "C:/llama/llama-server.exe", inspectedAt: "2026-08-28T00:00:00.000Z", origin: { classification: "official", source: "path_hint", evidence: [] }, status: "ready", devices: [], backendHints: [], flags: [...valueFlags.map((canonicalName) => ({ canonicalName, aliases: [], valuePlaceholder: canonicalName === "--device" ? "DEV1,DEV2,..." : canonicalName === "--n-gpu-layers" ? "N|all" : "VALUE" })), { canonicalName: "--models-autoload", aliases: [] }, { canonicalName: "--cont-batching", aliases: [] }, { canonicalName: "--safe-flag", aliases: [] }, { canonicalName: "--no-safe-flag", aliases: [] }, { canonicalName: "--api-key", aliases: [], valuePlaceholder: "SECRET", environmentAlias: "LLAMA_API_KEY" }], router: { status: "candidate", evidence: { modelsPreset: true, modelsMax: true, modelsAutoload: true }, missingRequiredFlags: [], compatibilityHints: [] }, warnings: [] });
const state = (): Phase15DomainSnapshot => ({ schemaVersion: 2, revision: "test", migration: {} as Phase15DomainSnapshot["migration"], compatibilityBindings: [], builds: [{ schemaVersion: 1, id: buildId, displayName: "Build", resource: local("C:/llama"), server: local("C:/llama/llama-server.exe"), tools: [], classification: "official", managedInferenceEligibility: "eligible", serverFingerprint: "server-fingerprint", functionalEvidence: { kind: "functional", state: "eligible", validationProtocolVersion: 1, serverFingerprint: "server-fingerprint", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] }, warnings: [], failures: [] } as LlamaCppBuild], artifacts: [{ schemaVersion: 1, id: artifactId, resource: local("C:/models/model.gguf"), kind: "model", referenceStatus: "available" }], configuredModels: [{ schemaVersion: 1, id: modelId, displayName: "Model", routerAlias: createRouterAlias("model", modelId), artifactId, buildId, enabled: true, llamaArgs: { ctxSize: 4096, metrics: true, webui: true }, referenceStatus: { artifact: "available", build: "available" }, validationStatus: "not_validated" }] });
const dependencies = (snapshot = state(), files = new Map<string, Buffer>()): RouterPresetDependencies => ({ load: async () => snapshot, mutate: async (fn) => ({ snapshot, result: await fn(snapshot) }), dataDir: () => "C:/data", fingerprint: async () => "server-fingerprint", capabilities: async () => manifest(), stat: async (file) => { const content = files.get(file); if (!content) throw new Error("missing"); return { size: content.length, mtime: new Date("2026-08-28T00:00:00.000Z") }; }, readFile: async (file) => { const content = files.get(file); if (!content) throw new Error("missing"); return content; }, writeFile: async (file, content) => { if (files.has(file)) throw new Error("exists"); files.set(file, Buffer.from(content)); }, mkdir: async () => undefined, rename: async (from, to) => { const content = files.get(from); if (!content) throw new Error("missing temp"); files.set(to, content); files.delete(from); }, unlink: async (file) => { files.delete(file); }, settings: async () => ({ managedLlamaPort: 8085 }), random: () => "fixed" });

test("router preset rendering is deterministic, safe, and exactly fresh by bytes", async () => {
  const files = new Map<string, Buffer>(); const deps = dependencies(state(), files); const first = await analyzeRouterPreset(buildId, deps); const second = await analyzeRouterPreset(buildId, deps);
  assert.equal(first.preview.content, second.preview.content); assert.match(first.preview.content, /^version = 1\n\n\[model\]/); assert.match(first.preview.content, /model = C:\/models\/model.gguf/); assert.equal(first.preview.artifact.resource.locator, "C:\\data\\generated\\llama-router\\" + buildId + ".ini"); assert.equal(first.preview.artifact.validationState, "valid"); assert.equal(first.preview.artifact.contentHash.length, 64);
  files.set(first.preview.artifact.resource.locator, Buffer.from(first.preview.content)); assert.equal((await analyzeRouterPreset(buildId, deps)).preview.artifact.freshness, "current");
  files.set(first.preview.artifact.resource.locator, Buffer.from(`${first.preview.content} `)); assert.equal((await analyzeRouterPreset(buildId, deps)).preview.artifact.freshness, "stale");
  const unsafe = state(); unsafe.configuredModels[0]!.routerAlias = "bad]alias" as typeof unsafe.configuredModels[0]["routerAlias"];
  await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(unsafe)), RouterPresetError);
});

test("preset selects enabled models for only one Build and revisions ignore unrelated, disabled, and cosmetic edits", async () => {
  const base = state(); const disabledId = createConfiguredModelId("disabled"); const otherId = createConfiguredModelId("other"); const otherBuildId = createLlamaCppBuildId("other");
  base.configuredModels.push({ ...structuredClone(base.configuredModels[0]!), id: disabledId, routerAlias: createRouterAlias("disabled", disabledId), enabled: false });
  base.builds.push({ ...structuredClone(base.builds[0]!), id: otherBuildId, displayName: "Other" });
  base.configuredModels.push({ ...structuredClone(base.configuredModels[0]!), id: otherId, routerAlias: createRouterAlias("other", otherId), buildId: otherBuildId });
  const first = await analyzeRouterPreset(buildId, dependencies(base)); assert.deepEqual(first.preview.configuredModelIds, [modelId]); assert.doesNotMatch(first.preview.content, /\[(disabled|other)\]/);
  base.builds[0]!.displayName = "Cosmetic"; base.builds[0]!.classification = "custom"; base.configuredModels.find((item) => item.id === disabledId)!.llamaArgs = { ctxSize: 999 }; base.configuredModels.find((item) => item.id === otherId)!.llamaArgs = { ctxSize: 777 };
  assert.equal((await analyzeRouterPreset(buildId, dependencies(base))).sourceHash, first.sourceHash);
  base.configuredModels.find((item) => item.id === disabledId)!.enabled = true;
  assert.notEqual((await analyzeRouterPreset(buildId, dependencies(base))).sourceHash, first.sourceHash);
});

test("structured settings, devices, gpu all, projector, and fixed key order serialize through exact Build flags", async () => {
  const fixture = state(); const projectorId = createModelArtifactId("projector"); fixture.artifacts.push({ schemaVersion: 1, id: projectorId, resource: local("E:\\Vision\\Projector Files\\mmproj.gguf"), kind: "mmproj", referenceStatus: "available" });
  const model = fixture.configuredModels[0]!; model.projector = { artifactId: projectorId, selection: "explicit", validationStatus: "not_validated" }; model.llamaArgs = { ctxSize: 131072, gpuLayers: "all", devices: ["CUDA0", "CUDA1"], splitMode: "layer", tensorSplit: "1,1", cacheTypeK: "q8_0", cacheTypeV: "q8_0", flashAttention: true, batchSize: 2048, ubatchSize: 512, parallel: 2, threads: 8, threadsBatch: 12, contBatching: true, metrics: true, webui: true };
  fixture.artifacts[0]!.resource.locator = "C:\\Models\\Qwen 27B\\model.gguf"; const preview = (await analyzeRouterPreset(buildId, dependencies(fixture))).preview;
  assert.match(preview.content, /model = C:\\Models\\Qwen 27B\\model\.gguf/); assert.match(preview.content, /mmproj = E:\\Vision\\Projector Files\\mmproj\.gguf/); assert.match(preview.content, /n-gpu-layers = all/); assert.match(preview.content, /device = CUDA0,CUDA1/); assert.equal((preview.content.match(/^device =/gm) ?? []).length, 1); assert.match(preview.content, /flash-attn = on/); assert.match(preview.content, /cont-batching = true/); assert.doesNotMatch(preview.content, /^(metrics|webui) =/m); assert.equal(preview.artifact.warnings.length, 2);
  assert.ok(preview.content.indexOf("model =") < preview.content.indexOf("mmproj =") && preview.content.indexOf("mmproj =") < preview.content.indexOf("ctx-size ="));
});

test("projector and unsupported structured settings fail instead of degrading", async () => {
  const missing = state(); missing.configuredModels[0]!.projector = { artifactId: createModelArtifactId("missing"), selection: "explicit", validationStatus: "invalid" };
  await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(missing)), /Projector/);
  const unsupported = state(); unsupported.configuredModels[0]!.llamaArgs = { batchSize: 42 }; const noBatch = manifest(); noBatch.flags = noBatch.flags.filter((flag) => flag.canonicalName !== "--batch-size");
  await assert.rejects(() => analyzeRouterPreset(buildId, { ...dependencies(unsupported), capabilities: async () => noBatch }), /batchSize/);
});

test("custom arguments reject router ownership, duplicates, unknown flags, unsafe values, and secrets without leaking values", async () => {
  const safeState = state(); safeState.configuredModels[0]!.flagOverrides = [{ flag: "--safe-flag" }, { flag: "--no-safe-flag" }]; safeState.configuredModels[0]!.extraArgs = ["--safe-value", "ok"];
  const safeContent = (await analyzeRouterPreset(buildId, dependencies(safeState))).preview.content; assert.match(safeContent, /safe-flag = true/); assert.match(safeContent, /no-safe-flag = true/); assert.match(safeContent, /safe-value = ok/);
  for (const args of [["--model", "C:/other.gguf"], ["--unknown"], ["--safe-value"], ["--safe-value", "bad\n[owned]"], ["--safe-value", "#comment"], ["--safe-value", ";comment"], ["--safe-value", "ok", "--safe-value", "again"]]) { const fixture = state(); fixture.configuredModels[0]!.extraArgs = args; await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(fixture)), RouterPresetError); }
  const secret = "fake-token-must-not-leak"; const fixture = state(); fixture.configuredModels[0]!.extraArgs = ["--api-key", secret]; let message = ""; await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(fixture)), (error: unknown) => { message = error instanceof Error ? error.message : String(error); return true; }); assert.equal(message.includes(secret), false);
  const duplicate = state(); duplicate.configuredModels[0]!.llamaArgs = { threads: 4 }; duplicate.configuredModels[0]!.flagOverrides = [{ flag: "--threads", values: ["8"] }]; await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(duplicate)), /duplicate/);
});

test("eligibility, current executable fingerprint, and zero enabled models are prerequisites", async () => {
  for (const eligibility of ["not_validated", "ineligible", "failed"] as const) { const fixture = state(); fixture.builds[0]!.managedInferenceEligibility = eligibility; await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(fixture)), /not currently validated/); }
  const stale = state(); let invalidated = false; await assert.rejects(() => analyzeRouterPreset(buildId, { ...dependencies(stale), fingerprint: async () => "replacement", mutate: async (fn) => { invalidated = true; return { snapshot: stale, result: await fn(stale) }; } }), /not currently validated/); assert.equal(invalidated, true); assert.equal(stale.builds[0]!.managedInferenceEligibility, "not_validated");
  const empty = state(); empty.configuredModels[0]!.enabled = false; await assert.rejects(() => analyzeRouterPreset(buildId, dependencies(empty)), /At least one enabled/);
});

test("generation is atomic, source-race guarded, and launch preview owns router controls", async () => {
  const files = new Map<string, Buffer>(); const deps = dependencies(state(), files); const preview = await generateRouterPreset(buildId, deps); assert.equal(files.get(preview.artifact.resource.locator)?.toString(), preview.content);
  const race = dependencies(state(), new Map([[preview.artifact.resource.locator, Buffer.from("old")]])); let calls = 0; race.fingerprint = async () => ++calls > 2 ? "changed" : "stable";
  await assert.rejects(() => generateRouterPreset(buildId, race), RouterPresetError); assert.equal((await race.readFile!(preview.artifact.resource.locator)).toString(), "old");
  const launch = await buildRouterLaunchPreview(buildId, deps); assert.deepEqual(launch.command.args, ["--host", "0.0.0.0", "--port", "8085", "--models-preset", preview.artifact.resource.locator, "--models-max", "1", "--models-autoload"]);
  assert.equal(launch.command.args.some((arg) => arg === "--model" || arg === "--models-dir"), false);
});

test("source races and filesystem failures preserve the previous target and clean only their temp", async () => {
  const old = Buffer.from("old preset"); const files = new Map<string, Buffer>(); const expectedPath = `C:\\data\\generated\\llama-router\\${buildId}.ini`; files.set(expectedPath, old); const before = state(); const after = structuredClone(before); after.configuredModels[0]!.llamaArgs = { ctxSize: 8192 }; let loads = 0;
  const race = dependencies(before, files); race.load = async () => ++loads === 1 ? before : after; await assert.rejects(() => generateRouterPreset(buildId, race), /source changed/); assert.equal(files.get(expectedPath)?.toString(), old.toString()); assert.equal([...files.keys()].some((key) => key.endsWith(".tmp")), false);
  const writeFailure = dependencies(state(), files); writeFailure.writeFile = async () => { throw new Error("temp write failed"); }; await assert.rejects(() => generateRouterPreset(buildId, writeFailure), /temp write failed/); assert.equal(files.get(expectedPath)?.toString(), old.toString());
  const hashFailure = dependencies(state(), files); hashFailure.writeFile = async (file) => { files.set(file, Buffer.from("corrupt temp")); }; await assert.rejects(() => generateRouterPreset(buildId, hashFailure), /did not verify/); assert.equal(files.get(expectedPath)?.toString(), old.toString());
  const renameFailure = dependencies(state(), files); renameFailure.rename = async () => { throw new Error("rename failed"); }; await assert.rejects(() => generateRouterPreset(buildId, renameFailure), /rename failed/); assert.equal(files.get(expectedPath)?.toString(), old.toString()); assert.equal([...files.keys()].some((key) => key.endsWith(".tmp")), false);
});

test("concurrent generation for one Build conflicts while the first writer owns the lock", async () => {
  const files = new Map<string, Buffer>(); const deps = dependencies(state(), files); const originalWrite = deps.writeFile!; let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }); let started!: () => void; const writing = new Promise<void>((resolve) => { started = resolve; });
  deps.writeFile = async (...args) => { started(); await hold; return originalWrite(...args); };
  const first = generateRouterPreset(buildId, deps); await writing; await assert.rejects(() => generateRouterPreset(buildId, deps), /already running/); release(); await first;
});

test("manual generated-file edits remain stale and explicit regeneration restores preview bytes", async () => {
  const files = new Map<string, Buffer>(); const deps = dependencies(state(), files); const generated = await generateRouterPreset(buildId, deps); const domainBefore = structuredClone(state()); files.set(generated.artifact.resource.locator, Buffer.from("version = 1\n\n[manual]\nmodel = C:/wrong.gguf\n")); assert.equal((await analyzeRouterPreset(buildId, deps)).preview.artifact.freshness, "stale"); const restored = await generateRouterPreset(buildId, deps); assert.equal(files.get(restored.artifact.resource.locator)?.toString(), restored.content); assert.deepEqual(state(), domainBefore);
});

test("autoload omission needs negative-only help that proves enabled default", () => {
  const negative = manifest(); negative.flags = [{ canonicalName: "--no-models-autoload", aliases: [], description: "Disable autoload (default: enabled)" }];
  assert.equal(routerAutoloadArgument(negative), undefined);
  negative.flags[0]!.description = "Disable autoload";
  assert.throws(() => routerAutoloadArgument(negative));
});
