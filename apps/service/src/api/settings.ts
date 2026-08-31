import type { FastifyInstance } from "fastify";
import type { DiscoverySettingsUpdate, RuntimeSettingsResponse, RuntimeSettingsUpdate } from "@obsidianlm/shared";
import { loadSettings, saveSettings } from "../config/storage.js";
import { normalizeFolderList } from "../discovery/helpers.js";
import { sanitizeSettingsForApi } from "./sanitize.js";
import { RuntimeManager } from "../runtime/manager.js";
import { synchronizeDiscoveryCatalog } from "../discovery/catalog-sync.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function registerSettingsRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
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
    await synchronizeDiscoveryCatalog();
    return { settings: sanitizeSettingsForApi(nextSettings) };
  });

  app.patch<{ Body: RuntimeSettingsUpdate }>("/api/settings/runtime", async (request, reply): Promise<RuntimeSettingsResponse | void> => {
    const port = isRecord(request.body) ? request.body.managedLlamaPort : undefined;
    if (!Number.isInteger(port) || typeof port !== "number" || port < 1 || port > 65535) {
      reply.status(400).send({ error: "invalid_runtime_settings_update", message: "managedLlamaPort must be an integer from 1 to 65535." });
      return;
    }
    const settings = await loadSettings();
    const state = runtimeManager.getState();
    if (settings.managedLlamaPort !== port && ["starting", "running", "stopping"].includes(state.status)) {
      reply.status(409).send({ error: "runtime_port_active", message: "Stop the managed runtime before changing its managed port." });
      return;
    }
    const nextSettings = { ...settings, managedLlamaPort: port };
    await saveSettings(nextSettings);
    return { settings: sanitizeSettingsForApi(nextSettings) };
  });
}
