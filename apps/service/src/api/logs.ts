import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { ServiceLogFile, ServiceLogsResponse } from "@obsidianlm/shared";
import { getServiceLogsDir } from "../config/paths.js";

const maxFiles = 10;
const maxBytesPerFile = 256 * 1024;
const maxTotalLines = 1000;

function clampLimit(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(maxTotalLines, parsed)) : maxTotalLines;
}

export async function registerServiceLogRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/logs/service", async (request): Promise<ServiceLogsResponse> => {
    const warnings: string[] = [];
    let files: string[] = [];
    try {
      const entries = await readdir(getServiceLogsDir(), { withFileTypes: true });
      files = entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink()).map((entry) => path.basename(entry.name)).sort().slice(0, maxFiles);
    } catch {
      return { logs: [], warnings: ["Service logs are currently unavailable."] };
    }

    const limit = clampLimit(request.query.limit);
    let remaining = limit;
    const logs: ServiceLogFile[] = [];
    for (const name of files) {
      if (!remaining) break;
      try {
        const filePath = path.join(getServiceLogsDir(), name);
        const handle = await open(filePath, "r");
        try {
          const [stat, currentStat] = await Promise.all([handle.stat(), lstat(filePath)]);
          if (!stat.isFile() || !currentStat.isFile() || currentStat.isSymbolicLink() || stat.dev !== currentStat.dev || stat.ino !== currentStat.ino) {
            warnings.push("A service log file changed while it was being read.");
            continue;
          }
          const offset = Math.max(0, stat.size - maxBytesPerFile);
          const buffer = Buffer.alloc(Math.min(stat.size, maxBytesPerFile));
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
          const parts = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/u);
          if (offset) parts.shift();
          const lines = parts.filter(Boolean).slice(-remaining);
          remaining -= lines.length;
          logs.push({ name, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString(), lines });
          if (stat.size > maxBytesPerFile) warnings.push("A service log file was truncated to the read limit.");
        } finally { await handle.close(); }
      } catch {
        warnings.push("A service log file could not be read.");
      }
    }
    return { logs, warnings: [...new Set(warnings)] };
  });
}
