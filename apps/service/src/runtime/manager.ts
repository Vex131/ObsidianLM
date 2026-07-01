import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  defaultRuntimeState,
  type CommandSpec,
  type DetectedPort,
  type RuntimeActionResult,
  type RuntimeProfile,
  type RuntimeState,
  type StartupDetectionSummary
} from "@obsidianlm/shared";
import { loadRuntimeState, saveRuntimeState } from "../config/storage.js";
import { detectPort } from "../process/port-detector.js";
import { buildLlamaCppServerCommand } from "./command.js";
import { getProfile, isLlamaCppServerProfile, validateProfile, withProfileOperation } from "./profiles.js";
import { RuntimeLogBuffer } from "./log-buffer.js";
import { runStartupDetection, type StartupDetectorOptions } from "./startup-detector.js";

export const staleRuntimeWarning = "Previous runtime state exists, but ObsidianLM did not adopt or stop it because Phase 3 requires conservative proof.";

interface RuntimeManagerOptions {
  startupDetectorOptions?: StartupDetectorOptions;
  portDetector?: (port: number, host?: string) => Promise<DetectedPort>;
  spawnRuntime?: typeof spawn;
}

export class RuntimeManager {
  private child: ChildProcessWithoutNullStreams | null = null;
  private activeProfile: RuntimeProfile | null = null;
  private state: RuntimeState = defaultRuntimeState;
  private detectionSummary: StartupDetectionSummary | null = null;

  constructor(readonly logs = new RuntimeLogBuffer(), private readonly options: RuntimeManagerOptions = {}) {}

  async initialize(): Promise<void> {
    const previousState = await loadRuntimeState();
    this.detectionSummary = await runStartupDetection(this.child?.pid ?? null, this.options.startupDetectorOptions);

    if (this.detectionSummary.categories.includes("previous_managed_stale_state")) {
      this.state = {
        ...defaultRuntimeState,
        status: "stopped",
        message: "Previous runtime state was stale; no matching live process was found."
      };
      this.logs.add("system", "Previous runtime state was stale. No matching live process was found and no process was killed.");
      return;
    }

    if (previousState.startedByObsidianLM && previousState.pid && ["starting", "running", "stopping"].includes(previousState.status)) {
      this.state = {
        ...previousState,
        pid: null,
        startedByObsidianLM: false,
        status: "unknown_previous_runtime",
        message: staleRuntimeWarning
      };
      await saveRuntimeState(this.state);
      this.logs.add("system", staleRuntimeWarning);
      return;
    }

    this.state = previousState;
  }

  getState(): RuntimeState {
    return { ...this.state };
  }

  getActiveProfile(): RuntimeProfile | null {
    return this.activeProfile;
  }

  getWarnings(): string[] {
    return [...new Set([...(this.state.status === "unknown_previous_runtime" ? [staleRuntimeWarning] : []), ...(this.detectionSummary?.warnings.map((warning) => warning.message) ?? [])])];
  }

  getDetectionSummary(): StartupDetectionSummary | null {
    return this.detectionSummary ? structuredClone(this.detectionSummary) : null;
  }

  async refreshDetection(options: Partial<StartupDetectorOptions> = {}): Promise<StartupDetectionSummary> {
    this.detectionSummary = await runStartupDetection(this.child?.pid ?? null, { ...this.options.startupDetectorOptions, ...options });
    return this.detectionSummary;
  }

  getActiveCommand(): CommandSpec | null {
    if (!this.activeProfile || !isLlamaCppServerProfile(this.activeProfile)) {
      return null;
    }

    return buildLlamaCppServerCommand(this.activeProfile);
  }

  async start(profileId: string): Promise<RuntimeActionResult> {
    return withProfileOperation(() => this.startLocked(profileId));
  }

  private async startLocked(profileId: string): Promise<RuntimeActionResult> {
    if (this.child) {
      return {
        ok: false,
        message: "Another managed runtime is already active in this service session.",
        state: this.getState(),
        warnings: this.getWarnings()
      };
    }

    const profile = await getProfile(profileId);
    if (!profile) {
      return {
        ok: false,
        message: "Profile not found.",
        state: this.getState(),
        errors: ["Profile not found."]
      };
    }

    const validation = await validateProfile(profile);
    if (!validation.valid) {
      return {
        ok: false,
        message: "Profile validation failed.",
        state: this.getState(),
        errors: validation.errors,
        warnings: validation.warnings
      };
    }

    if (!isLlamaCppServerProfile(profile)) {
      return {
        ok: false,
        message: "Unsupported profile type.",
        state: this.getState(),
        errors: ["Phase 1 only supports llama.cpp server profiles."]
      };
    }

    const portStatus = await (this.options.portDetector ?? detectPort)(profile.port, "127.0.0.1");
    if (portStatus.inUse) {
      const message = `Port ${profile.port} is already in use by another process. ObsidianLM will not start a duplicate runtime.`;
      this.detectionSummary = await this.refreshDetection();
      return {
        ok: false,
        error: "port_conflict",
        message,
        state: this.getState(),
        errors: [message],
        warnings: this.getWarnings()
      };
    }

    const command = buildLlamaCppServerCommand(profile);
    await this.logs.startLogFile(profile.id);

    this.state = {
      activeRuntimeId: `runtime-${Date.now()}`,
      activeProfileId: profile.id,
      pid: null,
      port: profile.port,
      startedByObsidianLM: true,
      startedAt: new Date().toISOString(),
      commandHash: command.commandHash,
      status: "starting",
      exitedAt: null,
      exitCode: null,
      signal: null,
      message: null
    };
    await saveRuntimeState(this.state);
    this.logs.add("system", `Starting profile ${profile.name} with ${command.executable}`);

    try {
      const child = (this.options.spawnRuntime ?? spawn)(command.executable, command.args, {
        shell: false,
        windowsHide: true
      });

      this.child = child;
      this.activeProfile = profile;
      this.state = {
        ...this.state,
        pid: child.pid ?? null,
        status: "running"
      };
      await saveRuntimeState(this.state);

      child.stdout.on("data", (data: Buffer) => this.captureOutput("stdout", data));
      child.stderr.on("data", (data: Buffer) => this.captureOutput("stderr", data));

      child.once("error", (error) => {
        void this.handleError(error);
      });

      child.once("exit", (code, signal) => {
        void this.handleExit(code, signal);
      });

      return {
        ok: true,
        message: "Runtime started.",
        state: this.getState(),
        command,
        warnings: validation.warnings
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start runtime.";
      this.child = null;
      this.activeProfile = null;
      this.state = {
        ...this.state,
        pid: null,
        status: "failed",
        message
      };
      await saveRuntimeState(this.state);
      this.logs.add("system", message);

      return {
        ok: false,
        message,
        state: this.getState(),
        command,
        errors: [message]
      };
    }
  }

  async stop(): Promise<RuntimeActionResult> {
    if (!this.child) {
      const warnings = this.getWarnings();
      return {
        ok: false,
        message: "No active in-memory managed runtime exists in this service session. ObsidianLM did not kill any process.",
        state: this.getState(),
        warnings
      };
    }

    this.state = {
      ...this.state,
      status: "stopping",
      message: "Stop requested by ObsidianLM."
    };
    await saveRuntimeState(this.state);
    this.logs.add("system", "Stopping active managed runtime.");
    this.child.kill("SIGTERM");

    return {
      ok: true,
      message: "Stop signal sent to active managed runtime.",
      state: this.getState(),
      warnings: this.getWarnings()
    };
  }

  async shutdown(): Promise<void> {
    if (!this.child) {
      return;
    }

    this.logs.add("system", "Service shutdown stopping active managed runtime child process.");
    this.child.kill("SIGTERM");
    await this.waitForCurrentExit(5000);
  }

  async restart(): Promise<RuntimeActionResult> {
    const profileId = this.activeProfile?.id ?? this.state.activeProfileId;
    if (!profileId || !this.child) {
      return {
        ok: false,
        message: "No active managed profile is running in this service session to restart.",
        state: this.getState(),
        warnings: this.getWarnings()
      };
    }

    await this.stop();
    await this.waitForCurrentExit(5000);
    return this.start(profileId);
  }

  private captureOutput(stream: "stdout" | "stderr", data: Buffer): void {
    const lines = data.toString("utf8").split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      this.logs.add(stream, line);
    }
  }

  private async handleError(error: Error): Promise<void> {
    this.logs.add("system", `Runtime process error: ${error.message}`);
    this.child = null;
    this.activeProfile = null;
    this.state = {
      ...this.state,
      pid: null,
      status: "failed",
      message: error.message
    };
    await saveRuntimeState(this.state);
  }

  private async handleExit(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    this.logs.add("system", `Runtime process exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    this.child = null;
    this.activeProfile = null;
    this.state = {
      ...this.state,
      pid: null,
      status: code === 0 || this.state.status === "stopping" ? "exited" : "failed",
      exitedAt: new Date().toISOString(),
      exitCode: code,
      signal,
      message: code === 0 || this.state.status === "stopping" ? "Runtime exited." : "Runtime exited unexpectedly."
    };
    await saveRuntimeState(this.state);
  }

  private async waitForCurrentExit(timeoutMs: number): Promise<void> {
    const child = this.child;
    if (!child) {
      return;
    }

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, timeoutMs);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
