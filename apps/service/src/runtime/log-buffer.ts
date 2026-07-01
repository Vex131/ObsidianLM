import { appendFile, mkdir, open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RuntimeLogEntry, RuntimeLogSource } from "@obsidianlm/shared";
import { getRuntimeLogsDir } from "../config/paths.js";

type LogListener = (entry: RuntimeLogEntry) => void;

const defaultRecentLimit = 300;
const maxRecentLimit = 2000;
const maxTailBytes = 1024 * 1024;

function normalizeLimit(limit: number | undefined, fallback = defaultRecentLimit): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return fallback;
  }

  return Math.max(1, Math.min(Math.trunc(limit), maxRecentLimit));
}

function parseStructuredLogLine(line: string): RuntimeLogEntry | null {
  try {
    const parsed = JSON.parse(line) as Partial<RuntimeLogEntry>;
    const source = parsed.source ?? parsed.stream;
    if (!parsed.timestamp || !source || !parsed.message || !["stdout", "stderr", "system"].includes(source)) {
      return null;
    }

    const sequence = typeof parsed.sequence === "number" ? parsed.sequence : typeof parsed.id === "number" ? parsed.id : 0;
    return {
      id: typeof parsed.id === "number" ? parsed.id : sequence,
      sequence,
      timestamp: parsed.timestamp,
      source,
      stream: source,
      message: String(parsed.message)
    };
  } catch {
    return null;
  }
}

function parseLegacyLogLine(line: string, index: number): RuntimeLogEntry | null {
  const match = /^(?<timestamp>\S+) \[(?<source>stdout|stderr|system)\] (?<message>.*)$/u.exec(line);
  if (!match?.groups) {
    return null;
  }

  const source = match.groups.source as RuntimeLogSource;
  return {
    id: index,
    sequence: index,
    timestamp: match.groups.timestamp,
    source,
    stream: source,
    message: match.groups.message
  };
}

export class RuntimeLogBuffer {
  private readonly entries: RuntimeLogEntry[] = [];
  private readonly listeners = new Set<LogListener>();
  private nextSequence = 1;
  private activeLogFile: string | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly maxEntries = maxRecentLimit) {}

  async startLogFile(profileId: string): Promise<string> {
    const runtimeLogsDir = getRuntimeLogsDir();
    await mkdir(runtimeLogsDir, { recursive: true });
    const safeProfileId = profileId.replace(/[^a-zA-Z0-9_.-]/gu, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    this.activeLogFile = path.join(runtimeLogsDir, `${timestamp}-${safeProfileId}.jsonl`);
    this.entries.splice(0, this.entries.length);
    this.nextSequence = 1;
    return this.activeLogFile;
  }

  async getRecent(limit = defaultRecentLimit): Promise<RuntimeLogEntry[]> {
    const normalizedLimit = normalizeLimit(limit);
    const diskEntries = await this.readRecentFromDisk(normalizedLimit);
    if (diskEntries.length === 0) {
      return this.entries.slice(-normalizedLimit);
    }

    const seen = new Set<string>();
    return [...diskEntries, ...this.entries]
      .filter((entry) => {
        const key = `${entry.timestamp}\0${entry.sequence}\0${entry.source}\0${entry.message}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      })
      .slice(-normalizedLimit);
  }

  getRecentFromMemory(limit = defaultRecentLimit): RuntimeLogEntry[] {
    return this.entries.slice(-normalizeLimit(limit));
  }

  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  add(source: RuntimeLogSource, message: string): RuntimeLogEntry {
    const entry: RuntimeLogEntry = {
      id: this.nextSequence,
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
      source,
      stream: source,
      message
    };
    this.nextSequence += 1;

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    for (const listener of this.listeners) {
      listener(entry);
    }

    this.writeChain = this.writeChain.then(() => this.writeEntry(entry)).catch(() => undefined);
    return entry;
  }

  private async readRecentFromDisk(limit: number): Promise<RuntimeLogEntry[]> {
    const logFile = this.activeLogFile ?? (await this.findLatestLogFile());
    if (!logFile) {
      return [];
    }

    try {
      const fileStats = await stat(logFile);
      const start = Math.max(0, fileStats.size - maxTailBytes);
      const length = fileStats.size - start;
      const handle = await open(logFile, "r");
      try {
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, start);
        const content = buffer.toString("utf8");
        const lines = content.split(/\r?\n/u).filter(Boolean);
        if (start > 0) {
          lines.shift();
        }

        return lines
          .slice(-limit)
          .map((line, index) => parseStructuredLogLine(line) ?? parseLegacyLogLine(line, index + 1))
          .filter((entry): entry is RuntimeLogEntry => entry !== null);
      } finally {
        await handle.close();
      }
    } catch {
      return [];
    }
  }

  private async findLatestLogFile(): Promise<string | null> {
    try {
      const runtimeLogsDir = getRuntimeLogsDir();
      const files = await readdir(runtimeLogsDir, { withFileTypes: true });
      const candidates = await Promise.all(
        files
          .filter((file) => file.isFile() && (file.name.endsWith(".jsonl") || file.name.endsWith(".log")))
          .map(async (file) => {
            const filePath = path.join(runtimeLogsDir, file.name);
            const fileStats = await stat(filePath);
            return { filePath, mtimeMs: fileStats.mtimeMs };
          })
      );

      candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
      return candidates[0]?.filePath ?? null;
    } catch {
      return null;
    }
  }

  private async writeEntry(entry: RuntimeLogEntry): Promise<void> {
    if (!this.activeLogFile) {
      return;
    }

    const line = `${JSON.stringify(entry)}\n`;
    await appendFile(this.activeLogFile, line, "utf8");
  }
}
