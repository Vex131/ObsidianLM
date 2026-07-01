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
    const limit = Number.parseInt(request.query.limit ?? "300", 10);
    return { logs: await runtimeManager.logs.getRecent(limit) };
  });

  app.get<{ Querystring: { limit?: string } }>("/api/runtime/logs/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });

    let closed = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let unsubscribe = (): void => {};

    const cleanup = (): void => {
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      unsubscribe();
      unsubscribe = (): void => {};
    };

    request.raw.on("close", cleanup);

    const sendEvent = (event: string, data: unknown): void => {
      if (closed || reply.raw.destroyed) {
        return;
      }

      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const send = (entry: RuntimeLogEntry): void => {
      sendEvent("log", entry);
      if (entry.source === "system" && entry.message.startsWith("Runtime process exited")) {
        sendEvent("stopped", { timestamp: entry.timestamp, message: entry.message });
      }
    };

    sendEvent("connection", { ok: true, state: runtimeManager.getState() });

    const limit = Number.parseInt(request.query.limit ?? "300", 10);
    for (const entry of await runtimeManager.logs.getRecent(limit)) {
      if (closed || reply.raw.destroyed) {
        return;
      }
      send(entry);
    }

    if (closed || reply.raw.destroyed) {
      return;
    }

    const state = runtimeManager.getState();
    if (["stopped", "exited", "failed", "unknown_previous_runtime"].includes(state.status)) {
      sendEvent("stopped", { state });
    }

    heartbeat = setInterval(() => {
      sendEvent("heartbeat", { timestamp: new Date().toISOString() });
    }, 15000);

    unsubscribe = runtimeManager.logs.subscribe(send);
  });
}
