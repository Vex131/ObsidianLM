import type { FastifyInstance } from "fastify";
import { detectLlamaServerProcesses } from "../process/process-detector.js";
import { sanitizeProcessForApi } from "./sanitize.js";

export async function registerProcessRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/processes/llama", async () => {
    const response = await detectLlamaServerProcesses();
    return {
      ...response,
      processes: response.processes.map(sanitizeProcessForApi)
    };
  });
}
