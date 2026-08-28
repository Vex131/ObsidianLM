import assert from "node:assert/strict";
import test from "node:test";
import {
  createConfiguredModelId,
  createLlamaCppBuildId,
  createModelArtifactId,
  createRouterAlias,
  type ConfiguredModel,
  type LlamaBuildCapabilitiesManifest,
  type LlamaCppBuild,
  type ModelArtifact
} from "@obsidianlm/shared";
import { reconcileRouterCatalog } from "../src/router/catalog.js";
import { createManagedRouterEnvironment } from "../src/router/environment.js";
import { validateFunctionalRouterBuild, RouterValidationError } from "../src/router/functional-validator.js";
import { runRouterProbe, type RouterProbeWorkspace } from "../src/router/probe-runner.js";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileBuildFingerprintInSnapshot, type Phase15DomainSnapshot } from "../src/config/phase15-domain.js";
import { getLlamaBuildCapabilitiesForServer } from "../src/discovery/llama-build-capabilities.js";
import { fingerprintServerExecutable } from "../src/router/fingerprint.js";

const observedAt = "2026-08-28T00:00:00.000Z";
const modelId = createConfiguredModelId("router-model");
const alias = createRouterAlias("Router model", modelId);

test("reconcileRouterCatalog preserves ownership boundaries, duplicates, missing entries, and states", () => {
  const expected = [{ routerAlias: alias, configuredModelId: modelId }];
  const states = ["unloaded", "loading", "loaded", "sleeping", "failed", "unknown"] as const;
  for (const state of states) {
    const snapshot = reconcileRouterCatalog([{ id: alias, status: state }], expected, observedAt);
    assert.equal(snapshot.entries[0]?.state, state);
    assert.equal(snapshot.entries[0]?.ownership, "managed");
  }
  assert.equal(reconcileRouterCatalog([{ id: alias, state: "unloaded", status: { failed: true } }], expected, observedAt).entries[0]?.state, "failed");

  const mixed = reconcileRouterCatalog([
    { id: alias, status: "loaded" },
    { id: "external-model", status: "unloaded", source: "cache" },
    { id: "duplicate", status: "sleeping" },
    { id: "duplicate", status: "loading" },
    { id: "unknown-status", status: "warming" },
    { id: "no-status" }
  ], expected, observedAt);
  assert.equal(mixed.reconciliationState, "mismatch");
  assert.equal(mixed.entries.find((entry) => entry.routerIdentifier === alias)?.ownership, "managed");
  assert.equal(mixed.entries.find((entry) => entry.routerIdentifier === "external-model")?.ownership, "external");
  assert.equal(mixed.entries.filter((entry) => entry.routerIdentifier === "duplicate").every((entry) => entry.ownership === "unknown"), true);
  assert.equal(mixed.entries.find((entry) => entry.routerIdentifier === "unknown-status")?.state, "unknown");
  assert.equal(mixed.entries.find((entry) => entry.routerIdentifier === "no-status")?.state, "unknown");

  const missing = reconcileRouterCatalog([], expected, observedAt);
  assert.equal(missing.reconciliationState, "mismatch");
  assert.match(missing.warnings.join(" "), /missing/i);
  assert.equal(reconcileRouterCatalog([{ id: alias }], [...expected, ...expected], observedAt).reconciliationState, "mismatch");
  assert.equal(reconcileRouterCatalog([{}], expected, observedAt).entries[0]?.ownership, "unknown");

  const pathOnly = reconcileRouterCatalog([{ id: "/models/router-model.gguf", path: "/models/router-model.gguf" }], [{ routerAlias: "/models/router-model.gguf", configuredModelId: modelId }], observedAt);
  assert.equal(pathOnly.entries[0]?.ownership, "managed");
  const pathDoesNotPromote = reconcileRouterCatalog([{ id: "/models/router-model.gguf", path: "/models/router-model.gguf" }], [{ routerAlias: alias, configuredModelId: modelId }], observedAt);
  assert.equal(pathDoesNotPromote.entries[0]?.ownership, "external");
});

test("createManagedRouterEnvironment removes inherited LLAMA variables and controls cache", () => {
  const environment = createManagedRouterEnvironment({ LLAMA_CACHE: "inherited", llama_server: "spoofed", PATH: "safe" }, "C:/controlled/cache");
  assert.deepEqual(environment, { PATH: "safe", LLAMA_CACHE: "C:/controlled/cache" });
});

test("executable fingerprints and capability cache change for same-size timestamp-preserving replacement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "obsidianlm-fingerprint-test-")); const server = join(directory, "llama-server.exe"); t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(server, "AAAA"); const originalTime = (await stat(server)).mtime; const firstFingerprint = await fingerprintServerExecutable(server); let probes = 0;
  const runner = async (_server: string, args: string[]) => { probes += 1; return { ok: true, stdout: args[0] === "--help" ? "  --models-preset FILE  preset\n  --models-max N  max\n  --models-autoload  autoload\n" : "llama.cpp version 1.0.0", stderr: "" }; };
  await getLlamaBuildCapabilitiesForServer(server, "same-size-a", [], runner);
  await writeFile(server, "BBBB"); await utimes(server, originalTime, originalTime); const secondFingerprint = await fingerprintServerExecutable(server);
  await getLlamaBuildCapabilitiesForServer(server, "same-size-a", [], runner);
  assert.notEqual(secondFingerprint, firstFingerprint); assert.equal(probes, 6);
});

test("runRouterProbe uses a bounded safe command, controlled environment, and cleans up", async (t) => {
  let workspacePath = "";
  let presetPath = "";
  let cachePath = "";
  let child: ChildProcess | undefined;
  const calls: string[] = [];
  let requested: { executable: string; args: readonly string[]; options: { env: NodeJS.ProcessEnv; shell: false; windowsHide: true } } | undefined;
  const workspaceFactory = async (modelPath: string, routerAlias: string): Promise<RouterProbeWorkspace> => {
    workspacePath = await mkdtemp(join(tmpdir(), "obsidianlm-probe-test-"));
    cachePath = join(workspacePath, "cache"); presetPath = join(workspacePath, "probe.ini");
    await mkdir(cachePath); await writeFile(presetPath, `[${routerAlias}]\nmodel = ${modelPath}\n`);
    return { path: workspacePath, cachePath, presetPath, remove: async () => rm(workspacePath, { recursive: true, force: true }) };
  };
  t.after(async () => { if (child && child.exitCode === null) child.kill("SIGKILL"); if (workspacePath) await rm(workspacePath, { recursive: true, force: true }); });
  const result = await runRouterProbe({ executable: "C:/untrusted/llama-server.exe", modelPath: "C:/models/model.gguf", routerAlias: "managed-model", autoloadFlag: "--models-autoload", timeoutMs: 500 }, {
    createWorkspace: workspaceFactory,
    spawn: (executable, args, options) => {
      requested = { executable, args, options: { env: options.env, shell: options.shell, windowsHide: options.windowsHide } };
      child = nodeSpawn(process.execPath, ["-e", "setInterval(() => {}, 10000)"], options);
      return child;
    },
    allocatePort: (() => { let allocation = 0; return async () => ++allocation === 1 ? 8085 : 49152; })(),
    fetch: async (url) => {
      const parsed = new URL(typeof url === "string" ? url : url instanceof URL ? url : url.url); calls.push(`${parsed.hostname}:${parsed.port}${parsed.pathname}`);
      return parsed.pathname === "/health" ? new Response("ok", { status: 200 }) : new Response(JSON.stringify([{ id: "managed-model", status: "loaded" }]), { status: 200, headers: { "content-type": "application/json" } });
    },
    sleep: async () => undefined,
    now: (() => { let value = 0; return () => value += 1; })()
  });
  assert.equal(result.classification, "eligible");
  assert.equal(requested?.executable, "C:/untrusted/llama-server.exe");
  assert.deepEqual(requested?.args, ["--host", "127.0.0.1", "--port", "49152", "--models-preset", join(workspacePath, "probe.ini"), "--models-max", "1", "--models-autoload"]);
  assert.equal(requested?.options.shell, false); assert.equal(requested?.options.windowsHide, true);
  assert.equal(requested?.options.env.LLAMA_CACHE, join(workspacePath, "cache"));
  assert.equal(Object.keys(requested?.options.env ?? {}).some((name) => name.toUpperCase().startsWith("LLAMA_") && name !== "LLAMA_CACHE"), false);
  assert.equal(requested?.args.some((arg) => arg === "--models-dir" || arg.includes("model.gguf")), false);
  assert.deepEqual(calls, ["127.0.0.1:49152/health", "127.0.0.1:49152/models"]);
  assert.equal(result.cleanup.childTerminated, true); assert.equal(result.cleanup.workspaceRemoved, true);
  assert.equal(await import("node:fs/promises").then(({ stat }) => stat(presetPath).then(() => true, () => false)), false);
  assert.equal(await import("node:fs/promises").then(({ stat }) => stat(cachePath).then(() => true, () => false)), false);
  assert.equal(await import("node:fs/promises").then(({ stat }) => stat(workspacePath).then(() => true, () => false)), false);
});

test("runRouterProbe classifies timeout as failed and confirms owned-child cleanup", async (t) => {
  let child: ChildProcess | undefined; t.after(() => { if (child?.exitCode === null) child.kill("SIGKILL"); });
  let clock = 0;
  const result = await runRouterProbe({ executable: "C:/fixture/llama-server.exe", modelPath: "C:/models/model.gguf", routerAlias: "timeout-model", autoloadFlag: "--models-autoload", timeoutMs: 3 }, {
    spawn: (_executable, _args, options) => { child = nodeSpawn(process.execPath, ["-e", "setInterval(() => {}, 10000)"], options); return child; },
    allocatePort: async () => 49153,
    fetch: async () => { throw new Error("not ready"); },
    sleep: async () => undefined,
    now: () => ++clock
  });
  assert.equal(result.classification, "failed"); assert.equal(result.cleanup.childTerminated, true); assert.equal(result.cleanup.workspaceRemoved, true);
});

const local = (locator: string) => ({ owner: { scope: "local" as const }, locator });
const buildId = createLlamaCppBuildId("validation-build");
const artifactId = createModelArtifactId("validation-model");
const build: LlamaCppBuild = {
  schemaVersion: 1, id: buildId, displayName: "Validation build", resource: local("/fixtures/build"), server: local("/fixtures/llama-server"),
  tools: [], classification: "official", managedInferenceEligibility: "not_validated", warnings: [], failures: []
};
const artifact: ModelArtifact = { schemaVersion: 1, id: artifactId, resource: local("/fixtures/model.gguf"), kind: "model", referenceStatus: "available" };
const model: ConfiguredModel = {
  schemaVersion: 1, id: modelId, displayName: "Router model", routerAlias: alias, artifactId, buildId,
  enabled: true, referenceStatus: { artifact: "available", build: "available" }, validationStatus: "not_validated"
};
const snapshot = (): Phase15DomainSnapshot => ({ schemaVersion: 2, revision: "fixture", artifacts: [structuredClone(artifact)], configuredModels: [structuredClone(model)], builds: [structuredClone(build)], migration: {} as Phase15DomainSnapshot["migration"], compatibilityBindings: [] });
const manifest = (status: LlamaBuildCapabilitiesManifest["router"]["status"] = "candidate"): LlamaBuildCapabilitiesManifest => ({
  buildId, serverPath: "/fixtures/llama-server", inspectedAt: observedAt, origin: { classification: "official", source: "path_hint", evidence: [] },
  status: "ready", devices: [], backendHints: [], flags: ["--models-preset", "--models-max", "--models-autoload"].map((canonicalName) => ({ canonicalName, aliases: [] })),
  router: { status, evidence: { modelsPreset: true, modelsMax: true, modelsAutoload: true }, missingRequiredFlags: [], compatibilityHints: [] }, warnings: []
});
const dependencies = (state = snapshot()) => {
  let current = state;
  const mutate = async <T>(mutator: (value: Phase15DomainSnapshot) => T | Promise<T>) => { const result = await mutator(current); return { snapshot: current, result }; };
  return { load: async () => current, mutate, fingerprint: async () => "fingerprint-current", staticProbe: async () => manifest(), resourceAvailable: async () => true, managedPort: async () => 8085 };
};
const eligibleProbe = async () => ({ launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, models: [{ id: alias, status: "unloaded" }], classification: "eligible" as const, reason: "ok", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } });

test("validateFunctionalRouterBuild records eligible evidence including protocol, fingerprint, and catalog boundary", async () => {
  const deps = dependencies();
  const result = await validateFunctionalRouterBuild(buildId, undefined, { ...deps, probe: eligibleProbe, now: () => new Date(observedAt) });
  assert.equal(result.outcome, "eligible");
  assert.equal(result.build.functionalEvidence?.validationProtocolVersion, 1);
  assert.equal(result.build.functionalEvidence?.serverFingerprint, "fingerprint-current");
  assert.equal(result.build.functionalEvidence?.catalogBoundaryVerified, true);
});

test("unsupported static capabilities are ineligible without probing; missing model is not validated", async () => {
  const unsupported = dependencies(); let probes = 0;
  const unsupportedResult = await validateFunctionalRouterBuild(buildId, undefined, { ...unsupported, staticProbe: async () => ({ ...manifest("unsupported"), router: { ...manifest("unsupported").router, missingRequiredFlags: ["--models-preset"] } }), probe: async () => { probes += 1; return await eligibleProbe(); } });
  assert.equal(unsupportedResult.outcome, "ineligible"); assert.equal(probes, 0);
  const missing = snapshot(); missing.configuredModels = [];
  await assert.rejects(() => validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(missing), probe: async () => { probes += 1; return await eligibleProbe(); } }), (error: unknown) => error instanceof RouterValidationError && error.code === "prerequisite");
  assert.equal(probes, 0);
  assert.equal(missing.builds[0]?.functionalEvidence, undefined);
  const wrong = snapshot(); const otherBuildId = createLlamaCppBuildId("other-build"); wrong.builds.push({ ...structuredClone(build), id: otherBuildId }); wrong.configuredModels[0]!.buildId = otherBuildId;
  await assert.rejects(() => validateFunctionalRouterBuild(buildId, modelId, { ...dependencies(wrong), probe: async () => { probes += 1; return await eligibleProbe(); } }), (error: unknown) => error instanceof RouterValidationError && error.code === "conflict");
  assert.equal(probes, 0);
  const unavailable = snapshot(); const prior = unavailable.builds[0]!; prior.serverFingerprint = "fingerprint-current"; prior.managedInferenceEligibility = "eligible"; prior.validatedAt = observedAt; prior.functionalEvidence = { kind: "functional", state: "eligible", validationProtocolVersion: 1, serverFingerprint: "fingerprint-current", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] };
  await assert.rejects(() => validateFunctionalRouterBuild(buildId, modelId, { ...dependencies(unavailable), resourceAvailable: async () => false }), (error: unknown) => error instanceof RouterValidationError && error.code === "prerequisite");
  assert.equal(prior.managedInferenceEligibility, "not_validated"); assert.equal(prior.functionalEvidence, undefined); assert.equal(prior.validatedAt, undefined);
});

test("deterministic control-plane incompatibility is ineligible while operational timeout is failed", async () => {
  const cases = [
    { name: "preset", probe: { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, classification: "ineligible" as const, reason: "preset rejected", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } }, field: "presetAccepted" },
    { name: "health", probe: { launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, classification: "ineligible" as const, reason: "/health returned 404", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } }, field: "healthVerified" },
    { name: "models", probe: { launchAttempted: true, presetAccepted: false, healthVerified: true, modelsVerified: false, classification: "ineligible" as const, reason: "/models returned 404", warnings: [], failures: [], cleanup: { childTerminated: true, workspaceRemoved: true } }, field: "modelsVerified" }
  ];
  for (const item of cases) {
    const result = await validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(), probe: async () => item.probe });
    assert.equal(result.outcome, "ineligible", item.name); assert.equal((result.build.functionalEvidence as unknown as Record<string, unknown>)[item.field], false);
  }
  const failed = await validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(), probe: async () => ({ launchAttempted: true, presetAccepted: false, healthVerified: false, modelsVerified: false, classification: "failed", reason: "timed out", warnings: [], failures: ["probe_timeout"], cleanup: { childTerminated: true, workspaceRemoved: true } }) });
  assert.equal(failed.outcome, "failed"); assert.equal(failed.build.managedInferenceEligibility, "failed");
});

test("external catalog entries, remote ownership, concurrency, and stale fingerprints are guarded", async () => {
  const external = dependencies();
  const result = await validateFunctionalRouterBuild(buildId, undefined, { ...external, probe: async () => ({ ...(await eligibleProbe()), models: [{ id: alias }, { id: "external" }] }) });
  assert.equal(result.outcome, "ineligible"); assert.equal(result.build.functionalEvidence?.catalogBoundaryVerified, false);
  const missingExpected = await validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(), probe: async () => ({ ...(await eligibleProbe()), models: [{ id: "unrelated", path: artifact.resource.locator }] }) });
  assert.equal(missingExpected.outcome, "ineligible"); assert.equal(missingExpected.build.functionalEvidence?.modelsVerified, false);

  const remote = snapshot(); remote.builds[0]!.server = { owner: { scope: "node", nodeId: "other-node" }, locator: "/remote/server" };
  let spawned = false;
  await assert.rejects(() => validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(remote), probe: async () => { spawned = true; return await eligibleProbe(); } }), /local Node/);
  assert.equal(spawned, false);

  const concurrent = dependencies(); let release!: () => void; const hold = new Promise<void>((resolve) => { release = resolve; }); let calls = 0;
  const first = validateFunctionalRouterBuild(buildId, undefined, { ...concurrent, probe: async () => { calls += 1; await hold; return await eligibleProbe(); } });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => validateFunctionalRouterBuild(buildId), /already running/); release(); await first; assert.equal(calls, 1);

  const stale = dependencies(); let fingerprints = 0;
  const staleResult = await validateFunctionalRouterBuild(buildId, undefined, { ...stale, fingerprint: async () => (++fingerprints <= 2 ? "fingerprint-current" : "fingerprint-changed"), probe: eligibleProbe });
  assert.equal(staleResult.outcome, "stale"); assert.equal(staleResult.build.functionalEvidence, undefined);
});

test("Build fingerprint reconciliation invalidates executable replacement but cosmetic edits do not", () => {
  const state = snapshot(); const stored = state.builds[0]!;
  stored.serverFingerprint = "fingerprint-current";
  stored.managedInferenceEligibility = "eligible";
  stored.validatedAt = observedAt;
  stored.functionalEvidence = { kind: "functional", state: "eligible", validationProtocolVersion: 1, serverFingerprint: "fingerprint-current", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] };
  stored.displayName = "Cosmetic rename"; stored.classification = "custom";
  reconcileBuildFingerprintInSnapshot(state, buildId, "fingerprint-current");
  assert.equal(stored.managedInferenceEligibility, "eligible"); assert.ok(stored.functionalEvidence);
  reconcileBuildFingerprintInSnapshot(state, buildId, "fingerprint-replaced");
  assert.equal(stored.id, buildId); assert.equal(stored.displayName, "Cosmetic rename"); assert.equal(stored.classification, "custom");
  assert.equal(stored.managedInferenceEligibility, "not_validated"); assert.equal(stored.functionalEvidence, undefined); assert.equal(stored.validatedAt, undefined);
});

test("functional validation omits negative-only autoload flag only when help proves enabled default", async () => {
  let autoloadFlag: string | undefined;
  const negative = manifest(); negative.flags = [{ canonicalName: "--models-preset", aliases: [] }, { canonicalName: "--models-max", aliases: [] }, { canonicalName: "--no-models-autoload", aliases: [], description: "Disable autoload (default: enabled)" }];
  await validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(), staticProbe: async () => negative, probe: async (input) => { autoloadFlag = input.autoloadFlag; return await eligibleProbe(); } });
  assert.equal(autoloadFlag, undefined);
  negative.flags[2]!.description = "Disable autoload";
  await assert.rejects(() => validateFunctionalRouterBuild(buildId, undefined, { ...dependencies(), staticProbe: async () => negative, probe: eligibleProbe }), /does not prove/);
});
