import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  defaultRouterRuntimeState,
  type CommandSpec,
  type DetectedPort,
  type RouterRuntimeActionResult,
  type RouterRuntimeState,
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
import { analyzeRouterPreset, buildRouterLaunchPreview, generateRouterPreset, RouterPresetError } from "../router/preset-generator.js";
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
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  dataDir?: () => string;
  mkdir?: (directory: string, options: { recursive: true }) => Promise<unknown>;
  environment?: NodeJS.ProcessEnv;
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

    const analyze = this.options.analyzePreset ?? analyzeRouterPreset;
    try {
      let analysis = await analyze(buildId);
      if (analysis.preview.artifact.validationState !== "valid" || analysis.preview.artifact.freshness !== "current") {
        await (this.options.generatePreset ?? generateRouterPreset)(buildId);
        analysis = await analyze(buildId);
      }
      if (analysis.preview.artifact.validationState !== "valid" || analysis.preview.artifact.freshness !== "current") throw new Error("Router preset is not valid and current after generation.");

      const preview = await (this.options.buildLaunchPreview ?? buildRouterLaunchPreview)(buildId);
      if (preview.artifact.validationState !== "valid" || preview.artifact.freshness !== "current" || preview.artifact.sourceRevision !== analysis.preview.artifact.sourceRevision) throw new Error("Router launch preview does not reference the current validated preset.");
      const port = this.portFrom(preview.command.args);
      const preflight = await (this.options.portDetector ?? detectPort)(port, "127.0.0.1");
      if (preflight.inUse) return this.result(false, `Managed router port ${port} is already in use; no process was killed.`, undefined, "port_conflict");

      const domain = await (this.options.loadDomain ?? loadPhase15Domain)();
      const expected = this.expectedModels(domain, buildId, analysis.preview.configuredModelIds);
      const runtimeId = `router_${randomUUID()}` as const;
      this.command = { ...preview.command, args: [...preview.command.args] };
      this.activeExpected = expected.map((model) => ({ ...model }));
      this.processError = null;
      this.routerState = {
        ...structuredClone(defaultRouterRuntimeState),
        activeRuntimeId: runtimeId,
        activeBuildId: buildId as RouterRuntimeState["activeBuildId"],
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
      child.once("error", (error) => { void this.handleProcessError(child, error); });
      child.once("exit", (code, signal) => { void this.handleExit(child, code, signal); });

      const catalog = await this.awaitControlPlane(expected);
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

  async refreshRouterHealth(): Promise<RouterRuntimeState["health"]> {
    if (!this.isOwnedRunning()) throw new Error("Managed router is not running in this service session.");
    const checkedAt = this.now().toISOString();
    try {
      await this.client().health(this.baseUrl());
      this.routerState = { ...this.routerState, health: { endpoint: "/health", state: "healthy", checkedAt } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Router health request failed.";
      this.routerState = { ...this.routerState, health: { endpoint: "/health", state: "unhealthy", checkedAt, message }, warnings: this.withWarning("router_health_failed", message) };
    }
    await this.refreshArtifactStaleness();
    await this.persist();
    return structuredClone(this.routerState.health);
  }

  async refreshRouterControlPlane(): Promise<NonNullable<RouterRuntimeState["catalog"]>> {
    if (!this.isOwnedRunning() || !this.routerState.activeBuildId) throw new Error("Managed router is not running in this service session.");
    await this.refreshRouterHealth();
    try {
      const expected = this.activeExpected;
      if (!expected.length) throw new Error("The launched managed catalog map is unavailable.");
      const catalog = reconcileRouterCatalog(await this.client().models(this.baseUrl()), expected, this.now().toISOString());
      const unsafe = this.catalogMismatch(catalog, expected);
      const normalized = unsafe ? { ...catalog, reconciliationState: "mismatch" as const, warnings: [...catalog.warnings, unsafe] } : catalog;
      this.routerState = { ...this.routerState, catalog: normalized, configuredModelStates: unsafe ? this.nonLiveModelStates() : this.statesFromCatalog(normalized), warnings: unsafe ? this.withWarning("router_catalog_mismatch", unsafe) : this.routerState.warnings };
    } catch (error) {
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

  private async handleProcessError(child: ChildProcessWithoutNullStreams, error: Error): Promise<void> {
    if (this.child !== child) return;
    this.logs.add("system", `Router process error: ${error.message}`);
    this.processError = error.message;
    if (this.routerState.status !== "starting") await this.markFailed(error.message);
  }

  private async handleExit(child: ChildProcessWithoutNullStreams, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    if (this.child !== child) return;
    const stopping = this.routerState.status === "stopping";
    this.child = null;
    this.command = null;
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
  private async serialize<T>(operation: () => Promise<T>): Promise<T> { const next = this.serialized.then(operation, operation); this.serialized = next.then(() => undefined, () => undefined); return next; }
}
