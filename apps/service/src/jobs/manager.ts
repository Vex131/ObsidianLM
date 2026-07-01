import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { JobRecord, JobType } from "@obsidianlm/shared";
import { getJobLogsDir } from "../config/paths.js";
import { loadJobs, saveJobs } from "../config/storage.js";
import { safeBasename } from "../api/sanitize.js";

export interface JobRunConfig {
  type: JobType;
  executable: string;
  args?: string[];
  cwd?: string | null;
  resultPath?: string | null;
}

interface JobManagerOptions {
  spawnJob?: typeof spawn;
}

const tailLimit = 100;

function now(): string {
  return new Date().toISOString();
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/gu, "_");
}

function looksLikeLocalPath(value: string): boolean {
  return path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/u.test(value) || value.startsWith("/") || value.startsWith("\\\\");
}

export function redactLocalPaths(value: string): string {
  return value
    .replace(/\\\\[^\s\\/'"`]+\\[^\s'"`]+/gu, "[redacted-local-path]")
    .replace(/[a-zA-Z]:[\\/][^\s'"`]+(?:\s[^\s'"`]+)*/gu, "[redacted-local-path]")
    .replace(/(?<!:)\/(?:[^\s'"`<>|/]+\/)+[^\s'"`<>|]+/gu, "[redacted-local-path]");
}

function sanitizeArg(arg: string): string {
  return looksLikeLocalPath(arg) ? "[redacted-local-path]" : redactLocalPaths(arg);
}

export function sanitizeJobForApi(job: JobRecord): JobRecord {
  const executable = safeBasename(job.executable);
  const args = job.args.map(sanitizeArg);
  return {
    ...job,
    executable,
    args,
    cwd: job.cwd && looksLikeLocalPath(job.cwd) ? null : job.cwd,
    command: [executable, ...args].join(" "),
    logPath: job.logPath ? safeBasename(job.logPath) : null,
    resultPath: job.resultPath ? safeBasename(job.resultPath) : null,
    errorMessage: job.errorMessage ? redactLocalPaths(job.errorMessage) : null
  };
}

export class JobManager {
  private jobs: JobRecord[] = [];
  private child: ChildProcessWithoutNullStreams | null = null;
  private activeJobId: string | null = null;
  private startingJob = false;
  private readonly tails = new Map<string, string[]>();

  constructor(private readonly options: JobManagerOptions = {}) {}

  async initialize(): Promise<void> {
    await mkdir(getJobLogsDir(), { recursive: true });
    this.jobs = await loadJobs();
    let changed = false;
    this.jobs = this.jobs.map((job) => {
      if (job.status !== "queued" && job.status !== "running") {
        return job;
      }
      changed = true;
      return {
        ...job,
        status: "failed",
        finishedAt: now(),
        errorMessage: "Job was interrupted by service startup; no previous job process was adopted or killed."
      };
    });
    if (changed) {
      await saveJobs(this.jobs);
    }
  }

  listJobs(): JobRecord[] {
    return this.jobs.map((job) => ({ ...job, args: [...job.args] })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(id: string): JobRecord | null {
    const job = this.jobs.find((item) => item.id === id);
    return job ? { ...job, args: [...job.args] } : null;
  }

  hasActiveJob(): boolean {
    return this.startingJob || this.jobs.some((job) => job.status === "queued" || job.status === "running");
  }

  async startJob(config: JobRunConfig): Promise<{ ok: boolean; message: string; job: JobRecord | null }> {
    if (this.child || this.hasActiveJob()) {
      return { ok: false, message: "Another job is already queued or running. Phase 6 allows one active job at a time.", job: null };
    }

    this.startingJob = true;

    try {
      const id = `job-${randomUUID()}`;
      const args = config.args ?? [];
      const createdAt = now();
      const logPath = await this.createLogPath(id, config.type);
      const job: JobRecord = {
        id,
        type: config.type,
        status: "queued",
        createdAt,
        startedAt: null,
        finishedAt: null,
        command: [config.executable, ...args].join(" "),
        executable: config.executable,
        args,
        cwd: config.cwd ?? null,
        exitCode: null,
        signal: null,
        logPath,
        resultPath: config.resultPath ?? null,
        errorMessage: null
      };

      this.jobs = [job, ...this.jobs];
      await saveJobs(this.jobs);
      await this.runQueuedJob(job);
      return { ok: true, message: "Job queued.", job: this.getJob(id) };
    } finally {
      this.startingJob = false;
    }
  }

  async cancelJob(id: string): Promise<{ ok: boolean; message: string; job: JobRecord | null }> {
    const job = this.jobs.find((item) => item.id === id);
    if (!job) {
      return { ok: false, message: "Job not found.", job: null };
    }
    if (this.activeJobId !== id || !this.child) {
      return { ok: false, message: "Only the current in-memory managed job can be cancelled. No unknown process was killed.", job: this.getJob(id) };
    }

    const signalled = this.child.kill("SIGTERM");
    if (!signalled) {
      return { ok: false, message: "Cancel signal could not be sent to the current managed job. No unknown process was killed.", job: this.getJob(id) };
    }
    await this.updateJob(id, { status: "cancelled", errorMessage: "Cancellation requested by ObsidianLM." });
    return { ok: true, message: "Cancel signal sent to current managed job.", job: this.getJob(id) };
  }

  async getLogs(id: string, limit = tailLimit): Promise<string[]> {
    const inMemory = this.tails.get(id);
    if (inMemory?.length) {
      return inMemory.slice(-limit);
    }

    const job = this.getJob(id);
    if (!job?.logPath) {
      return [];
    }

    try {
      const file = await readFile(job.logPath, "utf8");
      return file.split(/\r?\n/u).filter(Boolean).slice(-limit);
    } catch {
      return [];
    }
  }

  async shutdown(): Promise<void> {
    if (!this.child || !this.activeJobId) {
      return;
    }
    await this.updateJob(this.activeJobId, { status: "cancelled", errorMessage: "Service shutdown cancelled current managed job." });
    this.child.kill("SIGTERM");
  }

  private async runQueuedJob(job: JobRecord): Promise<void> {
    await this.updateJob(job.id, { status: "running", startedAt: now() });
    await this.writeLog(job, `system: Starting ${safeBasename(job.executable)} with redacted local command details.`);

    try {
      const child = (this.options.spawnJob ?? spawn)(job.executable, job.args, {
        cwd: job.cwd ?? undefined,
        shell: false,
        windowsHide: true
      });
      this.child = child;
      this.activeJobId = job.id;

      child.stdout.on("data", (data: Buffer) => void this.captureOutput(job, "stdout", data));
      child.stderr.on("data", (data: Buffer) => void this.captureOutput(job, "stderr", data));
      child.once("error", (error) => void this.handleError(job.id, error));
      child.once("exit", (code, signal) => void this.handleExit(job.id, code, signal));
    } catch (error) {
      await this.handleError(job.id, error instanceof Error ? error : new Error("Failed to start job."));
    }
  }

  private async handleError(id: string, error: Error): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    if (job) {
      await this.writeLog(job, `system: Job process error: ${error.message}`);
    }
    this.child = null;
    this.activeJobId = null;
    await this.updateJob(id, { status: "failed", finishedAt: now(), errorMessage: error.message });
  }

  private async handleExit(id: string, code: number | null, signal: NodeJS.Signals | null): Promise<void> {
    const job = this.jobs.find((item) => item.id === id);
    const wasCancelled = job?.status === "cancelled";
    if (job) {
      await this.writeLog(job, `system: Job exited with code ${code ?? "null"} and signal ${signal ?? "null"}.`);
    }
    this.child = null;
    this.activeJobId = null;
    await this.updateJob(id, {
      status: wasCancelled ? "cancelled" : code === 0 ? "completed" : "failed",
      finishedAt: now(),
      exitCode: code,
      signal,
      errorMessage: wasCancelled ? job?.errorMessage ?? "Job cancelled." : code === 0 ? null : `Job exited with code ${code ?? "null"}.`
    });
  }

  private async captureOutput(job: JobRecord, stream: "stdout" | "stderr", data: Buffer): Promise<void> {
    const lines = data.toString("utf8").split(/\r?\n/u).filter(Boolean);
    for (const line of lines) {
      await this.writeLog(job, `${stream}: ${line}`);
    }
  }

  private async writeLog(job: JobRecord, line: string): Promise<void> {
    const timestamped = `${now()} ${line}`;
    const tail = this.tails.get(job.id) ?? [];
    tail.push(timestamped);
    if (tail.length > tailLimit) {
      tail.splice(0, tail.length - tailLimit);
    }
    this.tails.set(job.id, tail);
    if (job.logPath) {
      await appendFile(job.logPath, `${timestamped}\n`, "utf8");
    }
  }

  private async createLogPath(id: string, type: JobType): Promise<string> {
    await mkdir(getJobLogsDir(), { recursive: true });
    const timestamp = now().replace(/[:.]/gu, "-");
    return path.join(getJobLogsDir(), `${timestamp}-${safeId(type)}-${safeId(id)}.log`);
  }

  private async updateJob(id: string, patch: Partial<JobRecord>): Promise<void> {
    this.jobs = this.jobs.map((job) => (job.id === id ? { ...job, ...patch } : job));
    await saveJobs(this.jobs);
  }
}
