import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { defaultRouterRuntimeState, defaultRuntimeState, type RouterRuntimeState } from "@obsidianlm/shared";
import { loadRouterRuntimeState } from "../src/config/storage.js";
import { RuntimeManager, staleRuntimeWarning } from "../src/runtime/manager.js";
import { createRouterClient } from "../src/router/runtime-client.js";

const buildId = "build-a" as RouterRuntimeState["activeBuildId"] & string;
const otherBuildId = "build-b" as RouterRuntimeState["activeBuildId"] & string;
const modelId = "model-a" as RouterRuntimeState["configuredModelStates"][number]["configuredModelId"];
const artifact = { schemaVersion: 1 as const, authority: "derived" as const, buildId, resource: { owner: { scope: "local" as const }, locator: "C:/tmp/router.ini" }, generatorVersion: "fixture", sourceRevision: "revision-a", contentHash: "hash", freshness: "current" as const, validationState: "valid" as const, warnings: [], errors: [] };
const domain = { schemaVersion: 2 as const, revision: "domain", artifacts: [], builds: [{ id: buildId, server: { owner: { scope: "local" }, locator: "C:/llama/llama-server.exe" } }], migration: {}, compatibilityBindings: [], configuredModels: [{ id: modelId, buildId, enabled: true, routerAlias: "managed-model", displayName: "Managed", artifactId: "artifact-a", referenceStatus: { artifact: "available", build: "available" }, validationStatus: "valid" }] } as any;

class FakeChild extends EventEmitter {
  pid = 4321;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kills: NodeJS.Signals[] = [];
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill(signal: NodeJS.Signals): boolean { this.kills.push(signal); this.signalCode = signal; this.emit("kill", signal); this.exitCode = 0; this.emit("exit", 0, signal); return true; }
}

function harness(t: test.TestContext, catalog: unknown[] = [{ id: "managed-model", status: "unloaded" }]) {
  const saved: RouterRuntimeState[] = [];
  const child = new FakeChild();
  let currentCatalog = catalog; let catalogSequence: unknown[][] | null = null; let currentDomain = structuredClone(domain); let spawned = false; let nextPid = 4321;
  const loadRequests: string[] = []; const events: string[] = [];
  child.on("kill", (signal) => { if (signal === "SIGTERM") events.push("source SIGTERM"); });
  child.on("exit", () => { events.push("source exit"); });
  let launch: { executable: string; args: string[]; env?: NodeJS.ProcessEnv } | undefined;
  const command = { executable: "C:/llama/llama-server.exe", args: ["--host", "0.0.0.0", "--port", "8085", "--models-preset", "C:/tmp/router.ini", "--models-max", "1", "--models-autoload"], displayCommand: "llama-server.exe --host 0.0.0.0 --port 8085 --models-preset C:/tmp/router.ini --models-max 1 --models-autoload", commandHash: "command-hash" };
  const manager = new RuntimeManager(undefined, {
    dataDir: () => t.name ? path.join(tmpdir(), "obsidianlm-router-runtime-test") : tmpdir(),
    mkdir: async () => undefined,
    loadRouterState: async () => structuredClone(defaultRouterRuntimeState),
    saveRouterState: async (state) => { saved.push(structuredClone(state)); },
    analyzePreset: async () => ({ preview: { artifact, configuredModelIds: [modelId] } } as any),
    generatePreset: async () => ({ artifact } as any),
    buildLaunchPreview: async () => ({ kind: "router_launch" as const, command, artifact, policy: { modelsMax: 1, modelsAutoload: true } }),
    loadDomain: async () => structuredClone(currentDomain),
    portDetector: async (port, host = "127.0.0.1") => { if (spawned && child.exitCode !== null) events.push("port release"); return { port, host, inUse: spawned && child.exitCode === null, ownerPid: spawned && child.exitCode === null ? child.pid : null, detectionMethod: "fixture", warnings: [] }; },
    spawnRuntime: ((executable: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => { events.push("target spawn"); child.pid = nextPid; launch = { executable, args: [...args], env: options.env }; spawned = true; child.exitCode = null; child.signalCode = null; return child as any; }) as any,
    routerClient: { health: async () => { events.push("health"); }, models: async () => { events.push("models"); return catalogSequence?.length ? catalogSequence.shift()! : currentCatalog; }, loadModel: async (_baseUrl, alias) => { events.push(`load ${alias}`); loadRequests.push(alias); } },
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    sleep: async () => undefined,
    startupDeadlineMs: 100,
    stopTimeoutMs: 100,
    environment: { LLAMA_CACHE: "inherited", LLAMA_MODEL: "secret", PATH: "safe" }
  });
  t.after(async () => { if (child.exitCode === null) child.kill("SIGTERM"); });
  return { manager, child, saved, command, launch: () => launch, loadRequests, events, setCatalog: (value: unknown[]) => { currentCatalog = value; }, setCatalogSequence: (value: unknown[][]) => { catalogSequence = value; }, setDomain: (value: any) => { currentDomain = value; }, setNextPid: (value: number) => { nextPid = value; } };
}

test("router runtime storage defaults and malformed backup preserve legacy runtime-state", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "obsidianlm-router-state-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const oldData = process.env.OBSIDIANLM_DATA_DIR; process.env.OBSIDIANLM_DATA_DIR = dir;
  t.after(() => { if (oldData === undefined) delete process.env.OBSIDIANLM_DATA_DIR; else process.env.OBSIDIANLM_DATA_DIR = oldData; });
  await writeFile(path.join(dir, "runtime-state.json"), JSON.stringify({ ...defaultRuntimeState, status: "running", pid: 99 }));
  assert.deepEqual(await loadRouterRuntimeState(), defaultRouterRuntimeState);
  await writeFile(path.join(dir, "router-runtime-state.json"), "malformed");
  assert.deepEqual(await loadRouterRuntimeState(), defaultRouterRuntimeState);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, "runtime-state.json"), "utf8")).pid, 99);
  assert.equal((await readdir(dir)).filter((name) => /^router-runtime-state\.json\.invalid-/.test(name)).length, 1);
});

test("initialize never adopts persisted router candidate and clears its PID", async () => {
  const persisted = { ...defaultRouterRuntimeState, activeBuildId: buildId, pid: 55, status: "running" as const, startedByObsidianLM: true };
  const dir = await mkdtemp(path.join(tmpdir(), "obsidianlm-router-init-"));
  await writeFile(path.join(dir, "runtime-state.json"), JSON.stringify(defaultRuntimeState));
  await writeFile(path.join(dir, "settings.json"), JSON.stringify({ managedLlamaPort: 8085 }));
  const oldData = process.env.OBSIDIANLM_DATA_DIR; process.env.OBSIDIANLM_DATA_DIR = dir;
  let saved: RouterRuntimeState | undefined;
  const manager = new RuntimeManager(undefined, { loadRouterState: async () => persisted, saveRouterState: async (state) => { saved = state; }, startupDetectorOptions: { processOptions: { platform: "linux", commandRunner: async () => { throw new Error("detector unavailable"); } } } });
  await manager.initialize();
  assert.equal(saved?.pid, null); assert.equal(saved?.ownershipEvidence, "persisted_candidate"); assert.equal(saved?.status, "unknown_previous_runtime"); assert.match(saved?.message ?? "", new RegExp(staleRuntimeWarning.slice(0, 20)));
  if (oldData === undefined) delete process.env.OBSIDIANLM_DATA_DIR; else process.env.OBSIDIANLM_DATA_DIR = oldData;
  await rm(dir, { recursive: true, force: true });
});

test("start verifies health and catalog, accepts unloaded, uses exact command and controlled environment", async (t) => {
  const h = harness(t); const result = await h.manager.start(buildId, null);
  assert.equal(result.ok, true); assert.equal(result.routerState.configuredModelStates[0]?.state, "unloaded"); assert.deepEqual(h.manager.getActiveCommand(), h.command);
  assert.equal(h.launch()?.executable, h.command.executable); assert.deepEqual(h.launch()?.args, h.command.args);
  assert.equal(h.launch()?.env?.LLAMA_CACHE?.endsWith(path.join("generated", "llama-router", "cache", buildId)), true);
  assert.equal(Object.keys(h.launch()?.env ?? {}).some((name) => name !== "LLAMA_CACHE" && name.toUpperCase().startsWith("LLAMA_")), false);
  assert.equal(h.command.args.includes("--models-dir"), false);
  assert.deepEqual(h.child.kills, []);
});

test("occupied port prevents spawn and stop never kills a persisted candidate", async (t) => {
  const h = harness(t); let spawns = 0; (h.manager as any).options.spawnRuntime = () => { spawns++; return h.child; };
  (h.manager as any).options.portDetector = async (port: number, host = "127.0.0.1") => ({ port, host, inUse: true, ownerPid: 999, detectionMethod: "fixture", warnings: [] });
  const result = await h.manager.start(buildId); assert.equal(result.error, "port_conflict"); assert.equal(spawns, 0); assert.deepEqual(h.child.kills, []);
  const candidate = new RuntimeManager(undefined, { loadRouterState: async () => ({ ...defaultRouterRuntimeState, status: "running", pid: 44, ownershipEvidence: "persisted_candidate" }) });
  assert.equal((await candidate.stop()).error, "not_running");
});

test("external catalog rejects startup and terminates owned child; RouterClient exposes only control-plane methods", async (t) => {
  const h = harness(t, [{ id: "external-model", status: "loaded" }]); const result = await h.manager.start(buildId);
  assert.equal(result.ok, false); assert.match(result.message, /external|unknown|missing/i); assert.deepEqual(h.child.kills, ["SIGTERM"]); assert.deepEqual(Object.keys(createRouterClient({ fetch: async () => new Response("ok") })), ["health", "models", "loadModel"]);
});

test("same-Build model switching loads exactly once and preserves the owned runtime", async (t) => {
  const loaded = harness(t); assert.equal((await loaded.manager.start(buildId, "profile-a")).ok, true);
  const before = { pid: loaded.manager.getRouterState().pid, command: loaded.manager.getActiveCommand() };
  loaded.setCatalog([{ id: "managed-model", status: "loaded" }]);
  const alreadyLoaded = await loaded.manager.switchModel(modelId);
  assert.equal(alreadyLoaded.ok, true); assert.deepEqual(loaded.loadRequests, []); assert.equal(loaded.manager.getRouterState().compatibilityProfileId, null);
  assert.equal(loaded.manager.getRouterState().pid, before.pid); assert.deepEqual(loaded.manager.getActiveCommand(), before.command);

  const loading = harness(t); assert.equal((await loading.manager.start(buildId)).ok, true);
  loading.setCatalogSequence([[{ id: "managed-model", status: "loading" }], [{ id: "managed-model", status: "loaded" }]]);
  assert.equal((await loading.manager.switchModel(modelId)).ok, true); assert.deepEqual(loading.loadRequests, []);

  const unloaded = harness(t); assert.equal((await unloaded.manager.start(buildId)).ok, true);
  unloaded.setCatalogSequence([[{ id: "managed-model", status: "unloaded" }], [{ id: "managed-model", status: "loaded" }]]);
  const switched = await unloaded.manager.switchModel(modelId);
  assert.equal(switched.ok, true); assert.deepEqual(unloaded.loadRequests, ["managed-model"]);
  assert.deepEqual(unloaded.child.kills, []); assert.equal(unloaded.manager.getRouterState().status, "running");
});

test("same-Build switch uses the launched alias and live catalog remains authoritative after external residency changes", async (t) => {
  const h = harness(t); const modelB = { ...structuredClone(domain.configuredModels[0]), id: "model-b", routerAlias: "managed-model-b", displayName: "Managed B" };
  h.setDomain({ ...structuredClone(domain), configuredModels: [...domain.configuredModels, modelB] });
  (h.manager as any).options.analyzePreset = async () => ({ preview: { artifact, configuredModelIds: [modelId, modelB.id] } });
  h.setCatalog([{ id: "managed-model", status: "loaded" }, { id: "managed-model-b", status: "unloaded" }]);
  assert.equal((await h.manager.start(buildId)).ok, true); const before = h.manager.getRouterState(); const command = h.manager.getActiveCommand();
  h.setCatalogSequence([
    [{ id: "managed-model", status: "loaded" }, { id: "managed-model-b", status: "unloaded" }],
    [{ id: "managed-model", status: "unloaded" }, { id: "managed-model-b", status: "loading" }],
    [{ id: "managed-model", status: "unloaded" }, { id: "managed-model-b", status: "loaded" }]
  ]);
  assert.equal((await h.manager.switchModel(modelB.id)).ok, true); assert.deepEqual(h.loadRequests, ["managed-model-b"]);
  const after = h.manager.getRouterState(); assert.equal(after.pid, before.pid); assert.equal(after.activeRuntimeId, before.activeRuntimeId); assert.equal(after.activeBuildId, before.activeBuildId); assert.equal(after.commandHash, before.commandHash); assert.equal(after.startedAt, before.startedAt); assert.deepEqual(h.manager.getActiveCommand(), command);
  h.setCatalog([{ id: "managed-model", status: "loaded" }, { id: "managed-model-b", status: "unloaded" }]); await h.manager.refreshRouterControlPlane();
  assert.equal(h.manager.getRouterState().configuredModelStates.find((state) => state.configuredModelId === modelId)?.state, "loaded");
  assert.equal(h.manager.getRouterState().configuredModelStates.find((state) => state.configuredModelId === modelB.id)?.state, "unloaded");
});

test("same-Build switching rejects invalid or unsafe catalog states without unload, restart, or inference", async (t) => {
  const cases: Array<{ name: string; catalog: unknown[]; error: string }> = [
    { name: "failed", catalog: [{ id: "managed-model", status: "failed" }], error: "model_load_failed" },
    { name: "unknown", catalog: [{ id: "managed-model", status: "unknown" }], error: "model_state_unknown" },
    { name: "missing", catalog: [], error: "router_catalog_mismatch" }
  ];
  for (const item of cases) {
    const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true, item.name);
    h.setCatalog(item.catalog); const result = await h.manager.switchModel(modelId);
    assert.equal(result.ok, false, item.name); assert.equal(result.error, item.error, item.name);
    assert.deepEqual(h.child.kills, [], item.name);
  }
  const timeout = harness(t); assert.equal((await timeout.manager.start(buildId)).ok, true);
  (timeout.manager as any).options.modelSwitchDeadlineMs = 1; timeout.setCatalog([{ id: "managed-model", status: "unloaded" }]);
  const timedOut = await timeout.manager.switchModel(modelId);
  assert.equal(timedOut.error, "model_load_timeout"); assert.deepEqual(timeout.loadRequests, ["managed-model"]); assert.deepEqual(timeout.child.kills, []);
});

test("same-Build switching refuses a managed residency violation without unloading either model", async (t) => {
  const h = harness(t, [{ id: "managed-model", status: "loaded" }, { id: "second-model", status: "loaded" }]);
  const second = { ...structuredClone(domain.configuredModels[0]), id: "model-second", routerAlias: "second-model" };
  h.setDomain({ ...structuredClone(domain), configuredModels: [...domain.configuredModels, second] });
  (h.manager as any).options.analyzePreset = async () => ({ preview: { artifact, configuredModelIds: [modelId, "model-second"] } });
  assert.equal((await h.manager.start(buildId)).ok, true);
  const result = await h.manager.switchModel(modelId);
  assert.equal(result.error, "residency_policy_violation"); assert.deepEqual(h.loadRequests, []); assert.deepEqual(h.child.kills, []);
});

test("same-Build switch validates mapping, alias, Build, enabled state, and runtime ownership before loading", async (t) => {
  const variants = [
    { error: "not_found", mutate: (value: any) => { value.configuredModels = []; } },
    { error: "runtime_preset_restart_required", mutate: (value: any) => { value.configuredModels[0].routerAlias = "changed-alias"; } },
    { error: "build_switch_required", mutate: (value: any) => { value.configuredModels[0].buildId = otherBuildId; value.builds.push({ id: otherBuildId, server: { owner: { scope: "local" }, locator: "C:/llama/other-server.exe" } }); } },
    { error: "configured_model_disabled", mutate: (value: any) => { value.configuredModels[0].enabled = false; } }
  ];
  for (const variant of variants) {
    const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true); const next = structuredClone(domain); variant.mutate(next); h.setDomain(next);
    const result = await h.manager.switchModel(modelId); assert.equal(result.error, variant.error); assert.deepEqual(h.loadRequests, []); assert.deepEqual(h.child.kills, []);
  }
  const stopped = harness(t); const result = await stopped.manager.switchModel(modelId); assert.equal(result.error, "not_running"); assert.deepEqual(stopped.loadRequests, []);
});

test("cross-Build switch preflights before stopping, reuses the port, loads the target, and creates new identity", async (t) => {
  const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true);
  const source = h.manager.getRouterState(); const sourceRuntimeId = source.activeRuntimeId; const sourcePid = source.pid; const sourceStartedAt = source.startedAt;
  const targetId = "model-b"; const targetBuild = { id: otherBuildId, server: { owner: { scope: "local" }, locator: "C:/llama/other-server.exe" } };
  const target = { id: targetId, buildId: otherBuildId, enabled: true, routerAlias: "target-model", displayName: "Target", artifactId: "artifact-b", referenceStatus: { artifact: "available", build: "available" }, validationStatus: "valid" };
  const targetDomain = { ...structuredClone(domain), builds: [...domain.builds, targetBuild], configuredModels: [...domain.configuredModels, target] };
  const targetArtifact = { ...artifact, buildId: otherBuildId, sourceRevision: "revision-b" };
  (h.manager as any).options.loadDomain = async () => { h.events.push("preflight"); return structuredClone(targetDomain); };
  (h.manager as any).options.analyzePreset = async (id: string) => { h.events.push("preflight"); return { preview: { artifact: targetArtifact, configuredModelIds: id === otherBuildId ? [targetId] : [modelId] } }; };
  (h.manager as any).options.buildLaunchPreview = async () => { h.events.push("preflight"); return { kind: "router_launch", command: { ...h.command, args: [...h.command.args, "--target-build"], commandHash: "target-command" }, artifact: targetArtifact, policy: { modelsMax: 1, modelsAutoload: true } }; };
  h.setCatalogSequence([[{ id: "target-model", status: "unloaded" }], [{ id: "target-model", status: "unloaded" }], [{ id: "target-model", status: "loaded" }]]); h.setNextPid(9876);
  let clock = 0; (h.manager as any).options.now = () => new Date(Date.UTC(2026, 7, 29, 0, 0, 1 + clock++));
  h.events.length = 0;
  const result = await h.manager.switchBuild(targetId);
  assert.equal(result.ok, true); assert.equal(result.stage, "completed"); assert.deepEqual(h.loadRequests, ["target-model"]);
  assert.deepEqual(h.child.kills, ["SIGTERM"]); assert.equal(h.manager.getRouterState().status, "running"); assert.equal(h.manager.getRouterState().pid, 9876);
  const preflight = h.events.indexOf("preflight"); const stop = h.events.indexOf("source SIGTERM"); const exit = h.events.indexOf("source exit"); const release = h.events.indexOf("port release"); const spawn = h.events.indexOf("target spawn"); const health = h.events.indexOf("health", spawn); const models = h.events.indexOf("models", health); const load = h.events.indexOf("load target-model", models);
  assert.ok(preflight >= 0 && preflight < stop); assert.ok(stop < exit && exit < release && release < spawn && spawn < health && health < models && models < load);
  assert.equal(h.manager.getRouterState().port, source.port); assert.notEqual(h.manager.getRouterState().activeRuntimeId, sourceRuntimeId); assert.notEqual(h.manager.getRouterState().pid, sourcePid); assert.notEqual(h.manager.getRouterState().startedAt, sourceStartedAt);
  assert.equal(h.launch()?.args.includes("--target-build"), true); assert.equal(h.manager.getActiveCommand()?.commandHash, "target-command");
  assert.equal(h.events.filter((event) => event === "target spawn").length, 1);
});

function crossBuildFixture(h: ReturnType<typeof harness>) {
  const targetId = "model-b";
  const target = { id: targetId, buildId: otherBuildId, enabled: true, routerAlias: "target-model", displayName: "Target", artifactId: "artifact-b", referenceStatus: { artifact: "available", build: "available" }, validationStatus: "valid" };
  const targetDomain = { ...structuredClone(domain), builds: [...domain.builds, { id: otherBuildId, server: { owner: { scope: "local" }, locator: "C:/llama/other-server.exe" } }], configuredModels: [...domain.configuredModels, target] };
  const targetArtifact = { ...artifact, buildId: otherBuildId, sourceRevision: "revision-b" };
  (h.manager as any).options.loadDomain = async () => structuredClone(targetDomain);
  (h.manager as any).options.analyzePreset = async () => ({ preview: { artifact: targetArtifact, configuredModelIds: [targetId] } });
  (h.manager as any).options.buildLaunchPreview = async () => ({ kind: "router_launch", command: { ...h.command, args: [...h.command.args, "--target-build"], commandHash: "target-command" }, artifact: targetArtifact, policy: { modelsMax: 1, modelsAutoload: true } });
  return targetId;
}

test("cross-Build failures preserve or stop the source without spawning an unsafe target", async (t) => {
  const preflight = harness(t); assert.equal((await preflight.manager.start(buildId)).ok, true); const sourcePid = preflight.manager.getRouterState().pid; const targetId = crossBuildFixture(preflight);
  (preflight.manager as any).options.analyzePreset = async () => { throw new Error("generation failed"); };
  assert.equal((await preflight.manager.switchBuild(targetId)).error, "cross_build_target_preflight_failed"); assert.equal(preflight.manager.getRouterState().pid, sourcePid); assert.deepEqual(preflight.child.kills, []);

  for (const mode of ["timeout", "occupied"] as const) {
    const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true); const target = crossBuildFixture(h);
    if (mode === "timeout") h.child.kill = ((signal: NodeJS.Signals) => { h.child.kills.push(signal); return true; }) as any;
    else { let occupied = false; h.child.on("kill", () => { occupied = true; }); (h.manager as any).options.portDetector = async (port: number, host = "127.0.0.1") => ({ port, host, inUse: occupied || h.child.exitCode === null, ownerPid: occupied ? 9999 : h.child.exitCode === null ? h.child.pid : null, detectionMethod: "fixture", warnings: [] }); }
    const result = await h.manager.switchBuild(target); assert.equal(result.ok, false); assert.equal(result.error, mode === "timeout" ? "stop_timeout" : "port_conflict"); assert.equal(h.launch()?.args.includes("--target-build"), false);
  }

  const revalidated = harness(t); assert.equal((await revalidated.manager.start(buildId)).ok, true); const target = crossBuildFixture(revalidated); let analyzes = 0;
  (revalidated.manager as any).options.analyzePreset = async () => ({ preview: { artifact: { ...artifact, buildId: otherBuildId, sourceRevision: ++analyzes === 1 ? "revision-b" : "changed" }, configuredModelIds: [target] } });
  assert.equal((await revalidated.manager.switchBuild(target)).error, "cross_build_target_revalidation_failed"); assert.equal(revalidated.manager.getRouterState().status, "exited"); assert.equal(revalidated.launch()?.args.includes("--target-build"), false);

  const stalePreview = harness(t); assert.equal((await stalePreview.manager.start(buildId)).ok, true); const staleTarget = crossBuildFixture(stalePreview); let previews = 0;
  (stalePreview.manager as any).options.buildLaunchPreview = async () => ({ kind: "router_launch", command: { ...stalePreview.command, args: [...stalePreview.command.args, "--target-build"], commandHash: "target-command" }, artifact: { ...artifact, buildId: otherBuildId, sourceRevision: "revision-b", freshness: ++previews === 1 ? "current" : "stale" }, policy: { modelsMax: 1, modelsAutoload: true } });
  assert.equal((await stalePreview.manager.switchBuild(staleTarget)).error, "cross_build_target_revalidation_failed"); assert.equal(stalePreview.manager.getRouterState().status, "exited"); assert.equal(stalePreview.events.filter((event) => event === "target spawn").length, 1);
});

test("cross-Build target model failure leaves the healthy target router running without rollback", async (t) => {
  const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true); const target = crossBuildFixture(h); h.setNextPid(9876);
  h.setCatalogSequence([[{ id: "target-model", status: "unloaded" }], [{ id: "target-model", status: "unloaded" }], [{ id: "target-model", status: "failed" }]]);
  h.events.length = 0;
  const result = await h.manager.switchBuild(target);
  assert.equal(result.error, "cross_build_target_model_failed"); assert.equal(result.stage, "target_model_load");
  assert.equal(h.manager.getRouterState().status, "running"); assert.equal(h.manager.getRouterState().activeBuildId, otherBuildId); assert.equal(h.manager.getRouterState().pid, 9876);
  assert.deepEqual(h.loadRequests, ["target-model"]); assert.equal(h.events.filter((event) => event === "target spawn").length, 1); assert.deepEqual(h.child.kills, ["SIGTERM"]);
});

test("cross-Build target spawn and health failures never restart the source", async (t) => {
  const spawnFailure = harness(t); assert.equal((await spawnFailure.manager.start(buildId)).ok, true); const spawnTarget = crossBuildFixture(spawnFailure); spawnFailure.events.length = 0;
  (spawnFailure.manager as any).options.spawnRuntime = () => { spawnFailure.events.push("target spawn"); throw new Error("target spawn failed"); };
  const spawnResult = await spawnFailure.manager.switchBuild(spawnTarget);
  assert.equal(spawnResult.error, "cross_build_target_start_failed"); assert.equal(spawnResult.stage, "target_start"); assert.equal(spawnFailure.manager.getRouterState().status, "failed"); assert.equal(spawnFailure.events.filter((event) => event === "target spawn").length, 1);

  const healthFailure = harness(t); assert.equal((await healthFailure.manager.start(buildId)).ok, true); const healthTarget = crossBuildFixture(healthFailure); healthFailure.events.length = 0;
  (healthFailure.manager as any).options.routerClient = { health: async () => { throw new Error("target health failed"); }, models: async () => [], loadModel: async () => undefined };
  (healthFailure.manager as any).options.startupDeadlineMs = 1;
  const healthResult = await healthFailure.manager.switchBuild(healthTarget);
  assert.equal(healthResult.error, "cross_build_target_start_failed"); assert.equal(healthFailure.manager.getRouterState().status, "failed"); assert.equal(healthFailure.events.filter((event) => event === "target spawn").length, 1);
});

test("cross-Build rejects same-Build targets and missing running sources without side effects", async (t) => {
  const same = harness(t); assert.equal((await same.manager.start(buildId)).ok, true); const result = await same.manager.switchBuild(modelId); assert.equal(result.error, "same_build_switch_required"); assert.deepEqual(same.child.kills, []);
  const stopped = harness(t); const stoppedResult = await stopped.manager.switchBuild(modelId); assert.equal(stoppedResult.error, "not_running"); assert.deepEqual(stopped.child.kills, []);
  const remote = harness(t); assert.equal((await remote.manager.start(buildId)).ok, true); const remoteDomain = structuredClone(domain); remoteDomain.builds.push({ id: otherBuildId, server: { owner: { scope: "node", nodeId: "node-a" }, locator: "remote" } }); remoteDomain.configuredModels.push({ ...structuredClone(domain.configuredModels[0]), id: "model-remote", buildId: otherBuildId }); remote.setDomain(remoteDomain);
  assert.equal((await remote.manager.switchBuild("model-remote")).error, "unsupported_scope"); assert.deepEqual(remote.child.kills, []);
});

test("compatibility profile activation starts a stopped runtime and keeps same-Build activation in place", async (t) => {
  const stopped = harness(t, [{ id: "managed-model", status: "loaded" }]);
  const started = await stopped.manager.activateCompatibilityProfile(modelId, "profile-a");
  assert.equal(started.ok, true); assert.equal(stopped.manager.getRouterState().compatibilityProfileId, "profile-a"); assert.deepEqual(stopped.loadRequests, []);
  const running = await stopped.manager.activateCompatibilityProfile(modelId, "profile-b");
  assert.equal(running.ok, true); assert.equal(stopped.manager.getRouterState().compatibilityProfileId, "profile-b"); assert.deepEqual(stopped.child.kills, []);
  assert.equal((await stopped.manager.switchModel(modelId)).ok, true); assert.equal(stopped.manager.getRouterState().compatibilityProfileId, null);
  const other = harness(t); assert.equal((await other.manager.start(buildId)).ok, true); const target = crossBuildFixture(other);
  assert.equal((await other.manager.activateCompatibilityProfile(target, "profile-other")).error, "build_switch_required"); assert.deepEqual(other.child.kills, []);
});

test("same-build and different-build starts conflict; restart preserves build and compatibility null", async (t) => {
  const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true);
  assert.equal((await h.manager.start(buildId)).error, "runtime_active"); assert.equal((await h.manager.start(otherBuildId)).error, "different_build_active");
  assert.equal((await h.manager.restart()).ok, true); assert.equal(h.manager.getRouterState().activeBuildId, buildId); assert.equal(h.manager.getRouterState().compatibilityProfileId, null);
});

test("refresh observes loaded state, records later mismatch without killing, and exit clears PID", async (t) => {
  const h = harness(t); assert.equal((await h.manager.start(buildId, "legacy-profile")).ok, true);
  h.setCatalog([{ id: "managed-model", status: "loaded" }]); const refreshed = await h.manager.refreshRouterControlPlane(); assert.equal(refreshed.entries[0]?.state, "loaded");
  h.setCatalog([{ id: "external-model", status: "loaded" }]); await h.manager.refreshRouterControlPlane(); assert.equal(h.child.kills.length, 0);
  h.child.exitCode = 7; h.child.emit("exit", 7, null); await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(h.manager.getRouterState().pid, null); assert.equal(h.manager.getRouterState().status, "failed");
});

test("stale child errors cannot fail a replacement and synchronous stop exit is observed", async (t) => {
  const h = harness(t);
  assert.equal((await h.manager.start(buildId)).ok, true);
  await (h.manager as any).handleProcessError(new FakeChild(), new Error("stale child error"));
  assert.equal(h.manager.getRouterState().status, "running");
  assert.equal((await h.manager.stop()).ok, true);
  assert.equal(h.manager.getRouterState().status, "exited");
});

test("same-revision non-current artifact is reported stale without stopping the router", async (t) => {
  const h = harness(t);
  assert.equal((await h.manager.start(buildId)).ok, true);
  (h.manager as any).options.analyzePreset = async () => ({ preview: { artifact: { ...artifact, freshness: "stale" }, configuredModelIds: [modelId] } });
  await h.manager.refreshRouterHealth();
  assert.equal(h.manager.getRouterState().status, "running");
  assert.match(h.manager.getWarnings().join("\n"), /stale or invalid/u);
  assert.deepEqual(h.child.kills, []);
});

test("lifecycle serialization prevents duplicate or replacement races", async (t) => {
  const starts = harness(t);
  const [firstStart, secondStart] = await Promise.all([starts.manager.start(buildId), starts.manager.start(buildId)]);
  assert.equal(firstStart.ok, true);
  assert.equal(secondStart.error, "runtime_active");

  const startStop = harness(t);
  const [started, stopped] = await Promise.all([startStop.manager.start(buildId), startStop.manager.stop()]);
  assert.equal(started.ok, true);
  assert.equal(stopped.ok, true);
  assert.equal(startStop.manager.getRouterState().status, "exited");

  const restartStart = harness(t);
  assert.equal((await restartStart.manager.start(buildId)).ok, true);
  const [restarted, blockedStart] = await Promise.all([restartStart.manager.restart(), restartStart.manager.start(buildId)]);
  assert.equal(restarted.ok, true);
  assert.equal(blockedStart.error, "runtime_active");

  const stopRestart = harness(t);
  assert.equal((await stopRestart.manager.start(buildId)).ok, true);
  const [stopResult, restartResult] = await Promise.all([stopRestart.manager.stop(), stopRestart.manager.restart()]);
  assert.equal(stopResult.ok, true);
  assert.equal(restartResult.error, "not_running");
});

test("model switches serialize with another switch, stop, and restart", async (t) => {
  async function race(action: "switch" | "stop" | "restart") {
    const h = harness(t); assert.equal((await h.manager.start(buildId)).ok, true); h.setCatalog([{ id: "managed-model", status: "loading" }]);
    let release!: () => void; let sleeping!: () => void; const entered = new Promise<void>((resolve) => { sleeping = resolve; }); const gate = new Promise<void>((resolve) => { release = resolve; });
    (h.manager as any).options.sleep = async () => { sleeping(); await gate; h.setCatalog([{ id: "managed-model", status: "loaded" }]); };
    const first = h.manager.switchModel(modelId); await entered;
    const second = action === "switch" ? h.manager.switchModel(modelId) : action === "stop" ? h.manager.stop() : h.manager.restart();
    await new Promise<void>((resolve) => setImmediate(resolve)); assert.deepEqual(h.child.kills, []); release();
    const [firstResult, secondResult] = await Promise.all([first, second]); assert.equal(firstResult.ok, true); assert.equal(secondResult.ok, true);
    if (action === "switch") assert.deepEqual(h.loadRequests, []); else assert.deepEqual(h.child.kills, ["SIGTERM"]);
  }
  await race("switch"); await race("stop"); await race("restart");
});

test("post-preflight owner race and health timeout fail startup and stop only the owned child", async (t) => {
  const raced = harness(t);
  let checks = 0;
  (raced.manager as any).options.portDetector = async (port: number, host = "127.0.0.1") => ({ port, host, inUse: checks++ > 0, ownerPid: checks > 1 ? 9999 : null, detectionMethod: "fixture", warnings: [] });
  const raceResult = await raced.manager.start(buildId);
  assert.equal(raceResult.ok, false);
  assert.match(raceResult.message, /different process/u);
  assert.deepEqual(raced.child.kills, ["SIGTERM"]);

  const unhealthy = harness(t);
  (unhealthy.manager as any).options.startupDeadlineMs = 5;
  (unhealthy.manager as any).options.routerClient = { health: async () => { throw new Error("health unavailable"); }, models: async () => [] };
  const healthResult = await unhealthy.manager.start(buildId);
  assert.equal(healthResult.ok, false);
  assert.match(healthResult.message, /health unavailable/u);
  assert.deepEqual(unhealthy.child.kills, ["SIGTERM"]);
});

test("child exit after control-plane response cannot be overwritten by startup success", async (t) => {
  const h = harness(t);
  (h.manager as any).options.routerClient = {
    health: async () => undefined,
    models: async () => { h.child.exitCode = 7; h.child.emit("exit", 7, null); return [{ id: "managed-model", status: "unloaded" }]; },
    loadModel: async () => undefined
  };
  const result = await h.manager.start(buildId);
  assert.equal(result.ok, false); assert.notEqual(h.manager.getRouterState().status, "running"); assert.equal(h.manager.getRouterState().pid, null);
});

test("spawn failure and graceful-stop timeout remain bounded and non-live", async (t) => {
  const spawnFailure = harness(t);
  (spawnFailure.manager as any).options.spawnRuntime = () => { throw new Error("spawn failed"); };
  const failed = await spawnFailure.manager.start(buildId);
  assert.equal(failed.ok, false);
  assert.equal(failed.routerState.status, "failed");
  assert.equal(failed.routerState.pid, null);

  const timeout = harness(t);
  assert.equal((await timeout.manager.start(buildId)).ok, true);
  timeout.child.kill = ((signal: NodeJS.Signals) => { timeout.child.kills.push(signal); return true; }) as any;
  (timeout.manager as any).options.stopTimeoutMs = 5;
  const stopped = await timeout.manager.stop();
  assert.equal(stopped.error, "stop_timeout");
  assert.equal(stopped.routerState.status, "failed");
  assert.match(stopped.routerState.previousRuntimeUncertainty ?? "", /may still be running/u);
});
