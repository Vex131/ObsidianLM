import type { FastifyInstance } from "fastify";
import type { DiscoverySettingsUpdate } from "@obsidianlm/shared";
import { loadSettings, saveSettings } from "../config/storage.js";
import { normalizeFolderList } from "../discovery/helpers.js";
import { sanitizeSettingsForApi } from "./sanitize.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => ({ settings: sanitizeSettingsForApi(await loadSettings()) }));

  app.patch<{ Body: DiscoverySettingsUpdate }>("/api/settings/discovery-folders", async (request, reply) => {
    if (!isRecord(request.body) || !Array.isArray(request.body.modelFolders) || !Array.isArray(request.body.llamaCppFolders) || (request.body.toolInputFolders !== undefined && !Array.isArray(request.body.toolInputFolders))) {
      return reply.status(400).send({
        error: "invalid_settings_update",
        message: "modelFolders and llamaCppFolders must be arrays. toolInputFolders must be an array when provided."
      });
    }

    const settings = await loadSettings();
    const nextSettings = {
      ...settings,
      modelFolders: normalizeFolderList(request.body.modelFolders),
      llamaCppFolders: normalizeFolderList(request.body.llamaCppFolders),
      toolInputFolders: request.body.toolInputFolders === undefined ? settings.toolInputFolders : normalizeFolderList(request.body.toolInputFolders)
    };

    await saveSettings(nextSettings);
    return { settings: sanitizeSettingsForApi(nextSettings) };
  });
}
