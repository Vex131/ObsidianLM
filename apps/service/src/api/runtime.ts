import type { FastifyInstance } from "fastify";
import type { RuntimeLogEntry } from "@obsidianlm/shared";
import type { RuntimeManager } from "../runtime/manager.js";
import { sanitizeDetectionForApi } from "./sanitize.js";

export async function registerRuntimeRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/runtime", async () => ({
    state: runtimeManager.getState(),
    warnings: runtimeManager.getWarnings()
  }));

  app.get("/api/runtime/detection", async () => sanitizeDetectionForApi(await runtimeManager.refreshDetection({ reconcileStaleState: false })));

  app.get("/api/runtime/command", async (request, reply) => {
    const command = runtimeManager.getActiveCommand();
    if (!command) {
      return reply.status(404).send({ error: "not_found", message: "No active profile command is available." });
    }

    return { command };
  });

  app.post("/api/runtime/stop", async (request, reply) => {
    const result = await runtimeManager.stop();
    return reply.status(result.ok ? 200 : 400).send(result);
  });

  app.post("/api/runtime/restart", async (request, reply) => {
    const result = await runtimeManager.restart();
    return reply.status(result.ok ? 200 : 400).send(result);
  });

  app.get<{ Querystring: { limit?: string } }>("/api/runtime/logs", async (request) => {
    const limit = Number.parseInt(request.query.limit ?? "200", 10);
    return { logs: runtimeManager.logs.getRecent(Number.isFinite(limit) ? limit : 200) };
  });

  app.get("/api/runtime/logs/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    const send = (entry: RuntimeLogEntry): void => {
      reply.raw.write(`event: log\ndata: ${JSON.stringify(entry)}\n\n`);
    };

    for (const entry of runtimeManager.logs.getRecent(50)) {
      send(entry);
    }

    const unsubscribe = runtimeManager.logs.subscribe(send);
    request.raw.on("close", () => {
      unsubscribe();
    });
  });
}
