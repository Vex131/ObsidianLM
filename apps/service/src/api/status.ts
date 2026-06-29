import type { FastifyInstance } from "fastify";
import type { StatusResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";

export async function registerStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/status", async (): Promise<StatusResponse> => {
    const settings = await loadSettings();

    return {
      service: "running",
      app: "ObsidianLM",
      version: "0.1.0",
      uiPort: settings.uiPort,
      managedLlamaPort: settings.managedLlamaPort,
      activeRuntime: null,
      warnings: []
    };
  });
}
