import type { FastifyInstance } from "fastify";
import type { RuntimeManager } from "../runtime/manager.js";
import { sanitizeProcessForApi } from "./sanitize.js";

export async function registerProcessRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/processes/llama", async () => {
    const response = await runtimeManager.refreshProcessAwareness();
    return {
      ...response,
      processes: response.processes.map(sanitizeProcessForApi)
    };
  });
}
