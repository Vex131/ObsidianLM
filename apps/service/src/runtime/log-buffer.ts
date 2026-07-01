import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeLogEntry } from "@obsidianlm/shared";
import { getRuntimeLogsDir } from "../config/paths.js";

type LogListener = (entry: RuntimeLogEntry) => void;

export class RuntimeLogBuffer {
  private readonly entries: RuntimeLogEntry[] = [];
  private readonly listeners = new Set<LogListener>();
  private nextId = 1;
  private activeLogFile: string | null = null;

  constructor(private readonly maxEntries = 500) {}

  async startLogFile(profileId: string): Promise<string> {
    const runtimeLogsDir = getRuntimeLogsDir();
    await mkdir(runtimeLogsDir, { recursive: true });
    const safeProfileId = profileId.replace(/[^a-zA-Z0-9_.-]/gu, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    this.activeLogFile = path.join(runtimeLogsDir, `${timestamp}-${safeProfileId}.log`);
    return this.activeLogFile;
  }

  getRecent(limit = this.maxEntries): RuntimeLogEntry[] {
    return this.entries.slice(-limit);
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  add(stream: RuntimeLogEntry["stream"], message: string): RuntimeLogEntry {
    const entry: RuntimeLogEntry = {
      id: this.nextId,
      timestamp: new Date().toISOString(),
      stream,
      message
    };
    this.nextId += 1;

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    for (const listener of this.listeners) {
      listener(entry);
    }

    void this.writeEntry(entry);
    return entry;
  }

  private async writeEntry(entry: RuntimeLogEntry): Promise<void> {
    if (!this.activeLogFile) {
      return;
    }

    const line = `${entry.timestamp} [${entry.stream}] ${entry.message}\n`;
    await appendFile(this.activeLogFile, line, "utf8");
  }
}
