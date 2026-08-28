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
const domain = { schemaVersion: 2 as const, revision: "domain", artifacts: [], builds: [], migration: {}, compatibilityBindings: [], configuredModels: [{ id: modelId, buildId, enabled: true, routerAlias: "managed-model", displayName: "Managed", artifactId: "artifact-a", referenceStatus: { artifact: "available", build: "available" }, validationStatus: "valid" }] } as any;

class FakeChild extends EventEmitter {
  pid = 4321;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  kills: NodeJS.Signals[] = [];
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill(signal: NodeJS.Signals): boolean { this.kills.push(signal); this.signalCode = signal; this.exitCode = 0; this.emit("exit", 0, signal); return true; }
}

function harness(t: test.TestContext, catalog: unknown[] = [{ id: "managed-model", status: "unloaded" }]) {
  const saved: RouterRuntimeState[] = [];
  const child = new FakeChild();
  let currentCatalog = catalog; let spawned = false;
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
    loadDomain: async () => structuredClone(domain),
    portDetector: async (port, host = "127.0.0.1") => ({ port, host, inUse: spawned && child.exitCode === null, ownerPid: spawned && child.exitCode === null ? child.pid : null, detectionMethod: "fixture", warnings: [] }),
    spawnRuntime: ((executable: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => { launch = { executable, args: [...args], env: options.env }; spawned = true; child.exitCode = null; child.signalCode = null; return child as any; }) as any,
    routerClient: { health: async () => undefined, models: async () => currentCatalog },
    now: () => new Date("2026-08-29T00:00:00.000Z"),
    sleep: async () => undefined,
    startupDeadlineMs: 100,
    stopTimeoutMs: 100,
    environment: { LLAMA_CACHE: "inherited", LLAMA_MODEL: "secret", PATH: "safe" }
  });
  t.after(async () => { if (child.exitCode === null) child.kill("SIGTERM"); });
  return { manager, child, saved, command, launch: () => launch, setCatalog: (value: unknown[]) => { currentCatalog = value; } };
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

test("external catalog rejects startup and terminates owned child; no inference client method exists", async (t) => {
  const h = harness(t, [{ id: "external-model", status: "loaded" }]); const result = await h.manager.start(buildId);
  assert.equal(result.ok, false); assert.match(result.message, /external|unknown|missing/i); assert.deepEqual(h.child.kills, ["SIGTERM"]); assert.deepEqual(Object.keys(createRouterClient({ fetch: async () => new Response("ok") })), ["health", "models"]);
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
