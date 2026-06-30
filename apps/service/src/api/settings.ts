import type { FastifyInstance } from "fastify";
import type { DiscoverySettingsUpdate } from "@obsidianlm/shared";
import { loadSettings, saveSettings } from "../config/storage.js";
import { normalizeFolderList } from "../discovery/helpers.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => ({ settings: await loadSettings() }));

  app.patch<{ Body: DiscoverySettingsUpdate }>("/api/settings/discovery-folders", async (request, reply) => {
    if (!isRecord(request.body) || !Array.isArray(request.body.modelFolders) || !Array.isArray(request.body.llamaCppFolders)) {
      return reply.status(400).send({
        error: "invalid_settings_update",
        message: "modelFolders and llamaCppFolders must both be arrays."
      });
    }

    const settings = await loadSettings();
    const nextSettings = {
      ...settings,
      modelFolders: normalizeFolderList(request.body.modelFolders),
      llamaCppFolders: normalizeFolderList(request.body.llamaCppFolders)
    };

    await saveSettings(nextSettings);
    return { settings: nextSettings };
  });
}
