import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  defaultRouterRuntimeState,
  type CommandSpec,
  type ConfiguredModel,
  type ConfiguredModelId,
  type DetectedPort,
  type LlamaCppBuildId,
  type RouterLaunchPreview,
  type RouterRuntimeActionResult,
  type RouterRuntimeState,
  type RouterSwitchActionResult,
  type RouterSwitchKind,
  type RouterSwitchStage,
  type RuntimeProfile,
  type RuntimeState,
  type StartupDetectionSummary
} from "@obsidianlm/shared";
import { loadPhase15Domain, type Phase15DomainSnapshot } from "../config/phase15-domain.js";
import { getDataDir } from "../config/paths.js";
import { loadRouterRuntimeState, saveRouterRuntimeState } from "../config/storage.js";
import { detectPort } from "../process/port-detector.js";
import { reconcileRouterCatalog, type ExpectedRouterModel } from "../router/catalog.js";
import { createManagedRouterEnvironment } from "../router/environment.js";
import { analyzeRouterPreset, buildRouterLaunchPreview, generateRouterPreset, RouterPresetError, type RouterPresetAnalysis } from "../router/preset-generator.js";
import { createRouterClient, type RouterClient } from "../router/runtime-client.js";
import { RuntimeLogBuffer } from "./log-buffer.js";
import { runStartupDetection, type StartupDetectorOptions } from "./startup-detector.js";

export const staleRuntimeWarning = "Previous router runtime evidence was not adopted or stopped because current ownership is unproven.";

export interface RuntimeManagerOptions {
  startupDetectorOptions?: StartupDetectorOptions;
  portDetector?: (port: number, host?: string) => Promise<DetectedPort>;
  spawnRuntime?: typeof spawn;
  loadRouterState?: () => Promise<RouterRuntimeState>;
  saveRouterState?: (state: RouterRuntimeState) => Promise<void>;
  analyzePreset?: typeof analyzeRouterPreset;
  generatePreset?: typeof generateRouterPreset;
  buildLaunchPreview?: typeof buildRouterLaunchPreview;
  loadDomain?: () => Promise<Phase15DomainSnapshot>;
  routerClient?: RouterClient;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  startupDeadlineMs?: number;
  modelSwitchDeadlineMs?: number;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  dataDir?: () => string;
  mkdir?: (directory: string, options: { recursive: true }) => Promise<unknown>;
  environment?: NodeJS.ProcessEnv;
}

interface PreparedRouterStart {
  buildId: LlamaCppBuildId;
  analysis: RouterPresetAnalysis;
  preview: RouterLaunchPreview;
  expected: ExpectedRouterModel[];
}

class RuntimeSwitchError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

const active = (state: RouterRuntimeState) => ["starting", "running", "stopping"].includes(state.status);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class RuntimeManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private routerState: RouterRuntimeState = structuredClone(defaultRouterRuntimeState);
  private detectionSummary: StartupDetectionSummary | null = null;
  private command: CommandSpec | null = null;
  private activeExpected: ExpectedRouterModel[] = [];
  private processError: string | null = null;
  private serialized = Promise.resolve();

  constructor(readonly logs = new RuntimeLogBuffer(), private readonly options: RuntimeManagerOptions = {}) {}

  async initialize(): Promise<void> {
    this.routerState = await (this.options.loadRouterState ?? loadRouterRuntimeState)();
    const previousPid = this.routerState.pid;
    this.detectionSummary = await runStartupDetection(null, { ...this.options.startupDetectorOptions, reconcileStaleState: false });
    if (!active(this.routerState)) return;

    const detectionUnavailable = this.detectionSummary.warnings.some((warning) => warning.category === "no_runtime_detected");
    const possibleMatch = previousPid !== null && (
      this.detectionSummary.processes.some((process) => process.pid === previousPid)
      || this.detectionSummary.ports.some((port) => port.ownerPid === previousPid)
    );
    const uncertain = detectionUnavailable || possibleMatch;
    this.routerState = {
      ...this.routerState,
      pid: null,
      startedByObsidianLM: false,
      ownershipEvidence: uncertain ? "persisted_candidate" : "unproven",
      status: uncertain ? "unknown_previous_runtime" : "stopped",
      health: { endpoint: "/health", state: "unknown" },
      catalog: undefined,
      configuredModelStates: this.nonLiveModelStates(),
      previousRuntimeUncertainty: uncertain ? `${staleRuntimeWarning}${previousPid ? ` Previous PID evidence: ${previousPid}.` : ""}` : undefined,
      message: uncertain ? staleRuntimeWarning : "Previous router runtime state was stale; no matching process was found."
    };
    await this.persist();
    this.logs.add("system", this.routerState.message ?? staleRuntimeWarning);
  }

  getRouterState(): RouterRuntimeState { return structuredClone(this.routerState); }

  /** Read-only legacy/UI projection. It is never persisted as current runtime authority. */
  getState(): RuntimeState {
    const state = this.routerState;
    return {
      activeRuntimeId: state.activeRuntimeId,
      activeProfileId: state.compatibilityProfileId ?? null,
      pid: state.pid,
      port: state.port,
      startedByObsidianLM: state.startedByObsidianLM,
      startedAt: state.startedAt,
      commandHash: state.commandHash,
      status: state.status,
      exitedAt: state.exitedAt,
      exitCode: state.exitCode,
      signal: state.signal,
      message: state.message ?? state.errors.at(-1) ?? state.previousRuntimeUncertainty ?? null
    };
  }

  getActiveProfile(): RuntimeProfile | null { return null; }
  getActiveCommand(): CommandSpec | null { return this.command ? { ...this.command, args: [...this.command.args] } : null; }
  getWarnings(): string[] { return [...new Set([...this.routerState.warnings.map((warning) => warning.message), ...(this.detectionSummary?.warnings.map((warning) => warning.message) ?? [])])]; }
  getDetectionSummary(): StartupDetectionSummary | null { return this.detectionSummary ? structuredClone(this.detectionSummary) : null; }

  async refreshDetection(options: Partial<StartupDetectorOptions> = {}): Promise<StartupDetectionSummary> {
    this.detectionSummary = await runStartupDetection(this.child?.pid ?? null, { ...this.options.startupDetectorOptions, ...options, reconcileStaleState: false });
    return this.detectionSummary;
  }

  async start(buildId: string, compatibilityProfileId?: string | null): Promise<RouterRuntimeActionResult> {
    return this.serialize(() => this.startLocked(buildId, compatibilityProfileId));
  }

  private async startLocked(buildId: string, compatibilityProfileId?: string | null): Promise<RouterRuntimeActionResult> {
    if (this.child || active(this.routerState)) {
      const code = this.routerState.activeBuildId && this.routerState.activeBuildId !== buildId ? "different_build_active" : "runtime_active";
      return this.result(false, "A managed router is already active; no process was started.", undefined, code);
    }

    try {
      return await this.startPreparedRouter(await this.prepareRouterStart(buildId), compatibilityProfileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to prepare the managed router.";
      await this.markFailed(message);
      return this.result(false, message, [message], this.errorCode(error));
    }
  }

  private async prepareRouterStart(buildId: string): Promise<PreparedRouterStart> {
    const analyze = this.options.analyzePreset ?? analyzeRouterPreset;
    let analysis = await analyze(buildId);
    if (analysis.preview.artifact.validationState !== "valid" || analysis.preview.artifact.freshness !== "current") {
      await (this.options.generatePreset ?? generateRouterPreset)(buildId);
      analysis = await analyze(buildId);
    }
    if (analysis.preview.artifact.validationState !== "valid" || analysis.preview.artifact.freshness !== "current") throw new Error("Router preset is not valid and current after generation.");
    const preview = await (this.options.buildLaunchPreview ?? buildRouterLaunchPreview)(buildId);
    if (preview.artifact.validationState !== "valid" || preview.artifact.freshness !== "current" || preview.artifact.sourceRevision !== analysis.preview.artifact.sourceRevision) throw new Error("Router launch preview does not reference the current validated preset.");
    const domain = await (this.options.loadDomain ?? loadPhase15Domain)();
    return { buildId: buildId as LlamaCppBuildId, analysis, preview, expected: this.expectedModels(domain, buildId, analysis.preview.configuredModelIds) };
  }

  private async revalidatePreparedRouter(prepared: PreparedRouterStart): Promise<PreparedRouterStart> {
    const analysis = await (this.options.analyzePreset ?? analyzeRouterPreset)(prepared.buildId);
    if (analysis.preview.artifact.validationState !== "valid" || analysis.preview.artifact.freshness !== "current") throw new Error("Prepared target router preset is no longer valid and current.");
    const preview = await (this.options.buildLaunchPreview ?? buildRouterLaunchPreview)(prepared.buildId);
    if (preview.artifact.validationState !== "valid" || preview.artifact.freshness !== "current" || preview.artifact.sourceRevision !== analysis.preview.artifact.sourceRevision) throw new Error("Revalidated target launch preview does not reference the current validated preset.");
    const domain = await (this.options.loadDomain ?? loadPhase15Domain)();
    const expected = this.expectedModels(domain, prepared.buildId, analysis.preview.configuredModelIds);
    const unchanged = analysis.executableFingerprint === prepared.analysis.executableFingerprint
      && analysis.preview.artifact.sourceRevision === prepared.analysis.preview.artifact.sourceRevision
      && analysis.preview.artifact.contentHash === prepared.analysis.preview.artifact.contentHash
      && preview.command.commandHash === prepared.preview.command.commandHash
      && JSON.stringify(expected) === JSON.stringify(prepared.expected);
    if (!unchanged) throw new Error("Prepared target Build or router preset changed before launch.");
    return { ...prepared, analysis, preview, expected };
  }

  private async startPreparedRouter(prepared: PreparedRouterStart, compatibilityProfileId?: string | null): Promise<RouterRuntimeActionResult> {
    const { buildId, preview, expected } = prepared;
    try {
      const port = this.portFrom(preview.command.args);
      const preflight = await (this.options.portDetector ?? detectPort)(port, "127.0.0.1");
      if (preflight.inUse) return this.result(false, `Managed router port ${port} is already in use; no process was killed.`, undefined, "port_conflict");
      const runtimeId = `router_${randomUUID()}` as const;
      this.command = { ...preview.command, args: [...preview.command.args] };
      this.activeExpected = expected.map((model) => ({ ...model }));
      this.processError = null;
      this.routerState = {
        ...structuredClone(defaultRouterRuntimeState),
        activeRuntimeId: runtimeId,
        activeBuildId: buildId,
        host: "0.0.0.0",
        port,
        startedByObsidianLM: true,
        ownershipEvidence: "unproven",
        startedAt: this.now().toISOString(),
        commandHash: preview.command.commandHash,
        status: "starting",
        generatedArtifact: structuredClone(preview.artifact),
        compatibilityProfileId: compatibilityProfileId ?? null,
        health: { endpoint: "/health", state: "checking" },
        configuredModelStates: expected.map((model) => ({ configuredModelId: model.configuredModelId, state: "unknown" }))
      };
      await this.persist();
      await this.logs.startLogFile(runtimeId);
      this.logs.add("system", `Starting managed router for Build ${buildId}.`);

      const cache = path.join((this.options.dataDir ?? getDataDir)(), "generated", "llama-router", "cache", buildId);
      await (this.options.mkdir ?? mkdir)(cache, { recursive: true });
      const env = createManagedRouterEnvironment(this.options.environment ?? process.env, cache);
      const child = (this.options.spawnRuntime ?? spawn)(preview.command.executable, preview.command.args, { shell: false, windowsHide: true, env, stdio: "pipe" });
      if (!child.pid) throw new Error("Managed router spawn did not return a process ID.");
      this.child = child;
      this.routerState = { ...this.routerState, pid: child.pid ?? null, ownershipEvidence: "current_process_child" };
      await this.persist();
      child.stdout.on("data", (data: Buffer) => this.captureOutput("stdout", data));
      child.stderr.on("data", (data: Buffer) => this.captureOutput("stderr", data));
      child.once("error", (error) => { void this.serialize(() => this.handleProcessError(child, error, runtimeId)); });
      child.once("exit", (code, signal) => { void this.serialize(() => this.handleExit(child, code, signal, runtimeId)); });

      const catalog = await this.awaitControlPlane(expected);
      if (this.child !== child || child.exitCode !== null || this.routerState.activeRuntimeId !== runtimeId || this.routerState.ownershipEvidence !== "current_process_child") throw new Error("Router child exited or changed before startup verification completed.");
      this.routerState = {
        ...this.routerState,
        status: "running",
        health: { endpoint: "/health", state: "healthy", checkedAt: this.now().toISOString() },
        catalog,
        configuredModelStates: this.statesFromCatalog(catalog),
        message: "Managed router is running."
      };
      await this.persist();
      return this.result(true, "Managed router started after /health and /models verification.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start managed router.";
      const child = this.child;
      if (child) {
        const exited = await this.terminateChild(child, this.options.stopTimeoutMs ?? 5_000);
        if (!exited) {
          this.routerState = { ...this.routerState, status: "failed", message: `${message} The owned child did not exit after SIGTERM.`, errors: [...this.routerState.errors, message], previousRuntimeUncertainty: "The current in-memory child may still be running; replacement is blocked." };
          await this.persist();
          return this.result(false, this.routerState.message!, [message], this.errorCode(error));
        }
      }
      await this.markFailed(message);
      return this.result(false, message, [message], this.errorCode(error));
    }
  }

  async stop(): Promise<RouterRuntimeActionResult> { return this.serialize(() => this.stopLocked()); }

  private async stopLocked(): Promise<RouterRuntimeActionResult> {
    const child = this.child;
    if (!child || this.routerState.ownershipEvidence !== "current_process_child") return this.result(false, "No active in-memory managed router exists in this service session. No process was killed.", undefined, "not_running");
    this.routerState = { ...this.routerState, status: "stopping", message: "Stop requested by ObsidianLM." };
    await this.persist();
    this.logs.add("system", "Stopping the current owned managed router.");
    if (!await this.terminateChild(child, this.options.stopTimeoutMs ?? 5_000)) {
      this.routerState = { ...this.routerState, status: "failed", message: "Managed router did not exit after SIGTERM; replacement is blocked.", errors: [...this.routerState.errors, "Graceful router stop timed out."], previousRuntimeUncertainty: "The current in-memory child may still be running." };
      await this.persist();
      return this.result(false, this.routerState.message!, ["Graceful router stop timed out."], "stop_timeout");
    }
    if (this.child === child) await this.handleExit(child, child.exitCode, child.signalCode);
    const released = await this.waitForPortRelease(this.routerState.port, 2_000);
    if (!released) {
      const warning = { code: "port_conflict", message: "The managed router exited, but its configured port remains occupied. No port owner was killed." };
      this.routerState = { ...this.routerState, warnings: [...this.routerState.warnings, warning], message: warning.message };
      await this.persist();
      return this.result(false, warning.message, undefined, "port_conflict");
    }
    return this.result(true, "Managed router stopped and its port was released.");
  }

  async restart(): Promise<RouterRuntimeActionResult> {
    return this.serialize(async () => {
      if (!this.child || this.routerState.ownershipEvidence !== "current_process_child" || !this.routerState.activeBuildId) return this.result(false, "Restart requires the current in-memory owned router.", undefined, "not_running");
      const buildId = this.routerState.activeBuildId;
      const compatibilityProfileId = this.routerState.compatibilityProfileId ?? null;
      const stopped = await this.stopLocked();
      return stopped.ok ? this.startLocked(buildId, compatibilityProfileId) : stopped;
    });
  }

  async switchModel(configuredModelId: string): Promise<RouterSwitchActionResult> {
    return this.serialize(() => this.loadConfiguredModelLocked(configuredModelId, null, "same_build_model"));
  }

  async switchBuild(configuredModelId: string): Promise<RouterSwitchActionResult> {
    return this.serialize(() => this.switchBuildLocked(configuredModelId));
  }

  async activateCompatibilityProfile(configuredModelId: string, profileId: string): Promise<RouterSwitchActionResult> {
    return this.serialize(async () => {
      let target: ConfiguredModel;
      try { target = this.targetModel(await (this.options.loadDomain ?? loadPhase15Domain)(), configuredModelId); }
      catch (error) { return this.switchFailure(error, "same_build_model", configuredModelId, this.routerState.activeBuildId, null, "validated"); }
      if (this.isOwnedRunning()) {
        if (this.routerState.activeBuildId !== target.buildId) return this.switchResult(false, "A different Build is active. Use the explicit cross-Build switch action.", "same_build_model", target.id, this.routerState.activeBuildId, target.buildId, "failed", "build_switch_required");
        return this.loadConfiguredModelLocked(target.id, profileId, "same_build_model");
      }
      if (this.child || active(this.routerState)) return this.switchResult(false, "Profile activation requires a stopped runtime or the current owned running router.", "same_build_model", target.id, this.routerState.activeBuildId, target.buildId, "failed", "not_running");
      const started = await this.startLocked(target.buildId, profileId);
      if (!started.ok) return this.switchResult(false, started.message, "same_build_model", target.id, null, target.buildId, "failed", started.error, started.errors);
      return this.loadConfiguredModelLocked(target.id, profileId, "same_build_model", null);
    });
  }

  private async switchBuildLocked(configuredModelId: string): Promise<RouterSwitchActionResult> {
    const sourceBuildId = this.routerState.activeBuildId;
    let target: ConfiguredModel;
    try { target = this.targetModel(await (this.options.loadDomain ?? loadPhase15Domain)(), configuredModelId); }
    catch (error) { return this.switchFailure(error, "cross_build", configuredModelId, sourceBuildId, null, "target_preflight"); }
    if (!this.isOwnedRunning()) return this.switchResult(false, "Cross-Build switching requires the current in-memory owned running router.", "cross_build", target.id, sourceBuildId, target.buildId, "failed", "not_running");
    if (target.buildId === sourceBuildId) return this.switchResult(false, "The target uses the active Build. Use the same-Build model switch action.", "cross_build", target.id, sourceBuildId, target.buildId, "failed", "same_build_switch_required");

    let prepared: PreparedRouterStart;
    try {
      prepared = await this.prepareRouterStart(target.buildId);
      const expected = prepared.expected.find((model) => model.configuredModelId === target.id);
      if (!expected || expected.routerAlias !== target.routerAlias) throw new RuntimeSwitchError("runtime_preset_restart_required", "Target Configured Model is not represented exactly in the prepared router preset.");
    } catch (error) {
      return this.switchFailure(error, "cross_build", target.id, sourceBuildId, target.buildId, "target_preflight");
    }

    this.logs.add("system", `Preparing cross-Build switch from Build ${sourceBuildId} to Build ${target.buildId}.`);
    const stopped = await this.stopLocked();
    if (!stopped.ok) return this.switchResult(false, stopped.message, "cross_build", target.id, sourceBuildId, target.buildId, stopped.error === "port_conflict" ? "port_release" : "source_stop", stopped.error, stopped.errors);
    this.logs.add("system", "Source router stopped; managed port released.");

    try { prepared = await this.revalidatePreparedRouter(prepared); }
    catch (error) { return this.switchFailure(error, "cross_build", target.id, sourceBuildId, target.buildId, "target_revalidation"); }

    this.logs.add("system", `Starting target Build ${target.buildId} router.`);
    const started = await this.startPreparedRouter(prepared, null);
    if (!started.ok) return this.switchResult(false, started.message, "cross_build", target.id, sourceBuildId, target.buildId, "target_start", "cross_build_target_start_failed", started.errors);
    const loaded = await this.loadConfiguredModelLocked(target.id, null, "cross_build", sourceBuildId);
    if (!loaded.ok) return { ...loaded, error: "cross_build_target_model_failed", stage: "target_model_load" };
    this.logs.add("system", `Target model ${target.id} loaded; cross-Build switch complete.`);
    return { ...loaded, stage: "completed" };
  }

  private async loadConfiguredModelLocked(configuredModelId: string, compatibilityProfileId: string | null, switchKind: RouterSwitchKind, sourceBuildId = this.routerState.activeBuildId): Promise<RouterSwitchActionResult> {
    let target: ConfiguredModel;
    try { target = this.targetModel(await (this.options.loadDomain ?? loadPhase15Domain)(), configuredModelId); }
    catch (error) { return this.switchFailure(error, switchKind, configuredModelId, sourceBuildId, null, "validated"); }
    if (!this.isOwnedRunning() || !this.routerState.activeBuildId || !this.child) return this.switchResult(false, "Model switching requires the current in-memory owned running router.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "not_running");
    if (target.buildId !== this.routerState.activeBuildId) return this.switchResult(false, "The target Configured Model requires a different Build.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "build_switch_required");
    const launched = this.activeExpected.find((model) => model.configuredModelId === target.id);
    if (!launched || launched.routerAlias !== target.routerAlias) return this.switchResult(false, "The target Configured Model does not exactly match the running router preset; restart the preset before switching.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "runtime_preset_restart_required");

    const identity = { child: this.child, runtimeId: this.routerState.activeRuntimeId, buildId: this.routerState.activeBuildId };
    this.logs.add("system", `Switching managed router model to ${target.displayName} (${target.id}).`);
    let catalog: NonNullable<RouterRuntimeState["catalog"]>;
    try { catalog = await this.refreshRouterControlPlaneLocked(); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Router catalog refresh failed before model switching.";
      return this.switchResult(false, message, switchKind, target.id, sourceBuildId, target.buildId, "failed", this.sameRuntime(identity) ? "router_catalog_mismatch" : "not_running", [message]);
    }
    let mismatch = this.catalogMismatch(catalog, this.activeExpected);
    if (mismatch) return this.switchResult(false, mismatch, switchKind, target.id, sourceBuildId, target.buildId, "failed", "router_catalog_mismatch");
    let entry = catalog.entries.find((item) => item.ownership === "managed" && item.configuredModelId === target.id);
    if (!entry) return this.switchResult(false, "The target model is absent from the reconciled router catalog.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "runtime_preset_restart_required");
    if (["unavailable", "unknown"].includes(entry.state)) return this.switchResult(false, entry.state === "unavailable" ? "The target model is unavailable." : "The target model state is unknown.", switchKind, target.id, sourceBuildId, target.buildId, "failed", entry.state === "unavailable" ? "model_not_available" : "model_state_unknown");

    let requested = false;
    if (!["loaded", "loading"].includes(entry.state)) {
      try {
        await this.client().loadModel(this.baseUrl(), String(launched.routerAlias));
        requested = true;
        this.logs.add("system", `Router accepted load request for alias ${launched.routerAlias}.`);
      } catch (error) {
        if (this.sameRuntime(identity)) catalog = await this.refreshRouterControlPlaneLocked();
        const message = error instanceof Error ? error.message : "Router model load request failed.";
        return this.switchResult(false, message, switchKind, target.id, sourceBuildId, target.buildId, "failed", "model_load_failed", [message]);
      }
    }

    const deadline = Date.now() + (this.options.modelSwitchDeadlineMs ?? 60_000);
    while (true) {
      if (!this.sameRuntime(identity)) return this.switchResult(false, "The managed router exited or changed during model loading.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "not_running");
      if (entry.state === "loaded") {
        const loaded = catalog.entries.filter((item) => item.ownership === "managed" && item.state === "loaded");
        if (loaded.length > 1) return this.switchResult(false, "Router reported multiple loaded managed models despite models-max=1. No model was unloaded by ObsidianLM.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "residency_policy_violation");
        this.routerState = { ...this.routerState, compatibilityProfileId, message: `Managed model ${target.id} is loaded.`, warnings: this.routerState.warnings.filter((warning) => !["model_load_failed", "model_load_timeout"].includes(warning.code)) };
        await this.persist();
        this.logs.add("system", `Managed model ${target.id} is loaded.`);
        return this.switchResult(true, requested ? "Router model load completed." : "Target model was already loaded.", switchKind, target.id, sourceBuildId, target.buildId, "completed");
      }
      if (entry.state === "failed") return this.switchResult(false, "Router reported that the target model failed to load.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "model_load_failed");
      if (Date.now() >= deadline) {
        this.routerState = { ...this.routerState, warnings: this.withWarning("model_load_timeout", `Model load timed out for ${target.id}.`) };
        await this.persist();
        return this.switchResult(false, "Timed out waiting for the target model to become loaded.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "model_load_timeout");
      }
      await (this.options.sleep ?? delay)(this.options.pollIntervalMs ?? 200);
      try { catalog = await this.refreshRouterControlPlaneLocked(); }
      catch (error) {
        const message = error instanceof Error ? error.message : "Router catalog refresh failed during model switching.";
        return this.switchResult(false, message, switchKind, target.id, sourceBuildId, target.buildId, "failed", this.sameRuntime(identity) ? "model_load_failed" : "not_running", [message]);
      }
      mismatch = this.catalogMismatch(catalog, this.activeExpected);
      if (mismatch) return this.switchResult(false, mismatch, switchKind, target.id, sourceBuildId, target.buildId, "failed", "router_catalog_mismatch");
      entry = catalog.entries.find((item) => item.ownership === "managed" && item.configuredModelId === target.id);
      if (!entry) return this.switchResult(false, "The target model disappeared from the reconciled router catalog.", switchKind, target.id, sourceBuildId, target.buildId, "failed", "router_catalog_mismatch");
      if (["unavailable", "unknown"].includes(entry.state)) return this.switchResult(false, entry.state === "unavailable" ? "The target model became unavailable." : "The target model state became unknown.", switchKind, target.id, sourceBuildId, target.buildId, "failed", entry.state === "unavailable" ? "model_not_available" : "model_state_unknown");
    }
  }

  async refreshRouterHealth(): Promise<RouterRuntimeState["health"]> { return this.serialize(() => this.refreshRouterHealthLocked()); }

  private async refreshRouterHealthLocked(): Promise<RouterRuntimeState["health"]> {
    if (!this.isOwnedRunning()) throw new Error("Managed router is not running in this service session.");
    const identity = { child: this.child, runtimeId: this.routerState.activeRuntimeId, buildId: this.routerState.activeBuildId };
    const checkedAt = this.now().toISOString();
    try {
      await this.client().health(this.baseUrl());
      if (!this.sameRuntime(identity)) throw new RuntimeSwitchError("not_running", "Managed router changed during health refresh.");
      this.routerState = { ...this.routerState, health: { endpoint: "/health", state: "healthy", checkedAt } };
    } catch (error) {
      if (!this.sameRuntime(identity)) throw error;
      const message = error instanceof Error ? error.message : "Router health request failed.";
      this.routerState = { ...this.routerState, health: { endpoint: "/health", state: "unhealthy", checkedAt, message }, warnings: this.withWarning("router_health_failed", message) };
    }
    await this.refreshArtifactStaleness();
    await this.persist();
    return structuredClone(this.routerState.health);
  }

  async refreshRouterControlPlane(): Promise<NonNullable<RouterRuntimeState["catalog"]>> { return this.serialize(() => this.refreshRouterControlPlaneLocked()); }

  private async refreshRouterControlPlaneLocked(): Promise<NonNullable<RouterRuntimeState["catalog"]>> {
    if (!this.isOwnedRunning() || !this.routerState.activeBuildId) throw new Error("Managed router is not running in this service session.");
    const identity = { child: this.child, runtimeId: this.routerState.activeRuntimeId, buildId: this.routerState.activeBuildId };
    await this.refreshRouterHealthLocked();
    try {
      const expected = this.activeExpected;
      if (!expected.length) throw new Error("The launched managed catalog map is unavailable.");
      const catalog = reconcileRouterCatalog(await this.client().models(this.baseUrl()), expected, this.now().toISOString());
      if (!this.sameRuntime(identity)) throw new RuntimeSwitchError("not_running", "Managed router changed during catalog refresh.");
      const unsafe = this.catalogMismatch(catalog, expected);
      const normalized = unsafe ? { ...catalog, reconciliationState: "mismatch" as const, warnings: [...catalog.warnings, unsafe] } : catalog;
      this.routerState = { ...this.routerState, catalog: normalized, configuredModelStates: unsafe ? this.nonLiveModelStates() : this.statesFromCatalog(normalized), warnings: unsafe ? this.withWarning("router_catalog_mismatch", unsafe) : this.routerState.warnings };
    } catch (error) {
      if (!this.sameRuntime(identity)) throw error;
      const message = error instanceof Error ? error.message : "Router catalog refresh failed.";
      this.routerState = { ...this.routerState, catalog: { endpoint: "/models", observedAt: this.now().toISOString(), entries: [], reconciliationState: "failed", warnings: [message] }, configuredModelStates: this.nonLiveModelStates(), warnings: this.withWarning("router_catalog_failed", message) };
    }
    await this.persist();
    return structuredClone(this.routerState.catalog!);
  }

  async shutdown(): Promise<void> {
    await this.serialize(async () => {
      const child = this.child;
      if (!child || this.routerState.ownershipEvidence !== "current_process_child") return;
      if (!await this.terminateChild(child, this.options.stopTimeoutMs ?? 5_000)) {
        this.routerState = { ...this.routerState, status: "failed", previousRuntimeUncertainty: "Service shutdown could not confirm the owned router exited.", message: "Managed router did not exit before the shutdown deadline." };
        await this.persist();
      }
    });
  }

  private async awaitControlPlane(expected: ExpectedRouterModel[]): Promise<NonNullable<RouterRuntimeState["catalog"]>> {
    const deadline = Date.now() + (this.options.startupDeadlineMs ?? 15_000);
    let lastError = "Router control plane did not become ready.";
    while (Date.now() < deadline) {
      const child = this.child;
      if (!child || child.exitCode !== null) throw new Error("Router child exited before startup verification completed.");
      if (this.processError) throw new Error(this.processError);
      try {
        const owner = await (this.options.portDetector ?? detectPort)(this.routerState.port!, "127.0.0.1");
        if (!owner.inUse) throw new Error("Managed router port is not accepting connections.");
        if (owner.ownerPid !== null && owner.ownerPid !== child.pid) throw new Error("Managed router port is owned by a different process.");
        await this.client().health(this.baseUrl());
        const catalog = reconcileRouterCatalog(await this.client().models(this.baseUrl()), expected, this.now().toISOString());
        const mismatch = this.catalogMismatch(catalog, expected);
        if (mismatch) throw new Error(mismatch);
        return catalog;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
      }
      await (this.options.sleep ?? delay)(this.options.pollIntervalMs ?? 200);
    }
    throw new Error(lastError);
  }

  private expectedModels(domain: Phase15DomainSnapshot, buildId: string, artifactIds: readonly string[]): ExpectedRouterModel[] {
    const idSet = new Set(artifactIds);
    const models = domain.configuredModels.filter((model) => idSet.has(model.id));
    if (models.length !== idSet.size || models.some((model) => !model.enabled || model.buildId !== buildId)) throw new Error("Authoritative model configuration changed after router preset validation.");
    return models.map((model) => ({ routerAlias: model.routerAlias, configuredModelId: model.id })).sort((a, b) => a.configuredModelId.localeCompare(b.configuredModelId));
  }

  private targetModel(domain: Phase15DomainSnapshot, configuredModelId: string): ConfiguredModel {
    const model = domain.configuredModels.find((entry) => entry.id === configuredModelId);
    if (!model) throw new RuntimeSwitchError("not_found", "Configured Model not found.");
    if (!model.enabled) throw new RuntimeSwitchError("configured_model_disabled", "The target Configured Model is disabled.");
    if (model.validationStatus !== "valid" || model.referenceStatus.artifact !== "available" || model.referenceStatus.build !== "available") throw new RuntimeSwitchError("prerequisite", "The target Configured Model is not structurally valid and available.");
    const build = domain.builds.find((entry) => entry.id === model.buildId);
    if (!build) throw new RuntimeSwitchError("prerequisite", "The target Configured Model does not reference a registered Build.");
    if (build.server.owner.scope !== "local") throw new RuntimeSwitchError("unsupported_scope", "Node-owned Builds cannot be executed by this local Controller.");
    return model;
  }

  private catalogMismatch(catalog: NonNullable<RouterRuntimeState["catalog"]>, expected: ExpectedRouterModel[]): string | null {
    if (catalog.reconciliationState !== "reconciled") return catalog.warnings.at(-1) ?? "Router catalog did not reconcile.";
    if (catalog.entries.some((entry) => entry.ownership !== "managed")) return "Router catalog contains an external or unknown entry.";
    const managed = new Set(catalog.entries.filter((entry) => entry.ownership === "managed").map((entry) => entry.configuredModelId));
    return expected.some((model) => !managed.has(model.configuredModelId)) ? "Router catalog is missing an expected managed alias." : null;
  }

  private statesFromCatalog(catalog: NonNullable<RouterRuntimeState["catalog"]>): RouterRuntimeState["configuredModelStates"] {
    return catalog.entries.filter((entry) => entry.ownership === "managed").map((entry) => ({ configuredModelId: entry.configuredModelId, state: entry.state })).sort((a, b) => a.configuredModelId.localeCompare(b.configuredModelId));
  }

  private nonLiveModelStates(): RouterRuntimeState["configuredModelStates"] { return this.routerState.configuredModelStates.map((model) => ({ ...model, state: "unknown" })); }
  private isOwnedRunning(): boolean { return !!this.child && this.child.exitCode === null && this.routerState.status === "running" && this.routerState.ownershipEvidence === "current_process_child"; }
  private sameRuntime(identity: { child: ChildProcessWithoutNullStreams | null; runtimeId: RouterRuntimeState["activeRuntimeId"]; buildId: RouterRuntimeState["activeBuildId"] }): boolean {
    return identity.child !== null && this.child === identity.child && identity.child.exitCode === null && this.routerState.activeRuntimeId === identity.runtimeId && this.routerState.activeBuildId === identity.buildId && this.isOwnedRunning();
  }
  private baseUrl(): string { return `http://127.0.0.1:${this.routerState.port}`; }
  private client(): RouterClient { return this.options.routerClient ?? createRouterClient(); }

  private async terminateChild(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<boolean> {
    if (this.child !== child || this.routerState.ownershipEvidence !== "current_process_child") return false;
    if (child.exitCode !== null) return true;
    return new Promise<boolean>((resolve) => {
      const onExit = (): void => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { child.off("exit", onExit); resolve(child.exitCode !== null); }, timeoutMs);
      child.once("exit", onExit);
      child.kill("SIGTERM");
      if (child.exitCode !== null) onExit();
    });
  }

  private async waitForPortRelease(port: number | null, timeoutMs: number): Promise<boolean> {
    if (port === null) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await (this.options.portDetector ?? detectPort)(port, "127.0.0.1")).inUse) return true;
      await (this.options.sleep ?? delay)(this.options.pollIntervalMs ?? 100);
    }
    return false;
  }

  private async handleProcessError(child: ChildProcessWithoutNullStreams, error: Error, runtimeId?: RouterRuntimeState["activeRuntimeId"]): Promise<void> {
    if (this.child !== child || runtimeId !== undefined && this.routerState.activeRuntimeId !== runtimeId) return;
    this.logs.add("system", `Router process error: ${error.message}`);
    this.processError = error.message;
    if (this.routerState.status !== "starting") await this.markFailed(error.message);
  }

  private async handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null, runtimeId?: RouterRuntimeState["activeRuntimeId"]): Promise<void> {
    if (this.child !== child || runtimeId !== undefined && this.routerState.activeRuntimeId !== runtimeId) return;
    const stopping = this.routerState.status === "stopping";
    this.child = null;
    this.command = null;
    this.activeExpected = [];
    this.routerState = {
      ...this.routerState,
      pid: null,
      ownershipEvidence: "unproven",
      status: stopping ? "exited" : "failed",
      exitedAt: this.now().toISOString(),
      exitCode: code,
      signal,
      health: { endpoint: "/health", state: "unknown" },
      catalog: undefined,
      configuredModelStates: this.nonLiveModelStates(),
      message: stopping ? "Managed router exited." : "Managed router exited unexpectedly.",
      errors: stopping ? this.routerState.errors : [...this.routerState.errors, `Router process exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`]
    };
    this.logs.add("system", `Router process exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    await this.persist();
  }

  private async markFailed(message: string): Promise<void> {
    this.child = null;
    this.command = null;
    this.activeExpected = [];
    this.routerState = { ...this.routerState, pid: null, ownershipEvidence: "unproven", status: "failed", health: { endpoint: "/health", state: "failed", checkedAt: this.now().toISOString(), message }, catalog: undefined, configuredModelStates: this.nonLiveModelStates(), message, errors: [...this.routerState.errors, message] };
    await this.persist();
  }

  private async refreshArtifactStaleness(): Promise<void> {
    if (!this.routerState.activeBuildId || !this.routerState.generatedArtifact) return;
    try {
      const current = await (this.options.analyzePreset ?? analyzeRouterPreset)(this.routerState.activeBuildId);
      if (current.preview.artifact.sourceRevision !== this.routerState.generatedArtifact.sourceRevision || current.preview.artifact.freshness !== "current" || current.preview.artifact.validationState !== "valid") this.routerState = { ...this.routerState, warnings: this.withWarning("running_preset_stale", "Running router preset is stale or invalid relative to current configuration.") };
    } catch {
      this.routerState = { ...this.routerState, warnings: this.withWarning("running_build_changed", "The active Build or router preset no longer validates against current configuration.") };
    }
  }

  private withWarning(code: string, message: string): RouterRuntimeState["warnings"] { return [...this.routerState.warnings.filter((warning) => warning.code !== code), { code, message }]; }
  private captureOutput(stream: "stdout" | "stderr", data: Buffer): void { for (const line of data.toString("utf8").split(/\r?\n/u).filter(Boolean)) this.logs.add(stream, line); }
  private portFrom(args: string[]): number { const index = args.findIndex((arg) => arg === "--port"); const port = Number(args[index + 1]); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Router launch preview has no valid managed port."); return port; }
  private errorCode(error: unknown): string { return error instanceof RouterPresetError ? error.code : "runtime_start_failed"; }
  private now(): Date { return (this.options.now ?? (() => new Date()))(); }
  private async persist(): Promise<void> { await (this.options.saveRouterState ?? saveRouterRuntimeState)(this.routerState); }
  private result(ok: boolean, message: string, errors?: string[], error?: string): RouterRuntimeActionResult { const command = this.getActiveCommand(); return { ok, message, state: this.getState(), routerState: this.getRouterState(), ...(error ? { error } : {}), ...(errors?.length ? { errors } : {}), ...(command ? { command } : {}), warnings: this.getWarnings() }; }
  private switchResult(ok: boolean, message: string, switchKind: RouterSwitchKind, targetConfiguredModelId: ConfiguredModelId, sourceBuildId: LlamaCppBuildId | null, targetBuildId: LlamaCppBuildId | null, stage: RouterSwitchStage, error?: string, errors?: string[]): RouterSwitchActionResult {
    return { ...this.result(ok, message, errors, error), switchKind, targetConfiguredModelId, sourceBuildId, targetBuildId, stage };
  }
  private switchFailure(error: unknown, switchKind: RouterSwitchKind, configuredModelId: string, sourceBuildId: LlamaCppBuildId | null, targetBuildId: LlamaCppBuildId | null, stage: RouterSwitchStage): RouterSwitchActionResult {
    const message = error instanceof Error ? error.message : "Router switch failed.";
    const code = error instanceof RuntimeSwitchError || error instanceof RouterPresetError
      ? error.code
      : switchKind === "cross_build"
        ? stage === "target_revalidation" ? "cross_build_target_revalidation_failed" : "cross_build_target_preflight_failed"
        : "model_load_failed";
    return this.switchResult(false, message, switchKind, configuredModelId as ConfiguredModelId, sourceBuildId, targetBuildId, stage, code, [message]);
  }
  private async serialize<T>(operation: () => Promise<T>): Promise<T> { const next = this.serialized.then(operation, operation); this.serialized = next.then(() => undefined, () => undefined); return next; }
}
