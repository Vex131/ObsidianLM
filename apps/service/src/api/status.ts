import type { FastifyInstance } from "fastify";
import type { StatusResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import type { RuntimeManager } from "../runtime/manager.js";
import { getProfile, isLlamaCppServerProfile } from "../runtime/profiles.js";
import { sanitizeDetectionForApi } from "./sanitize.js";

export async function registerStatusRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/status", async (): Promise<StatusResponse> => {
    const settings = await loadSettings();
    const detection = sanitizeDetectionForApi(await runtimeManager.refreshDetection({ reconcileStaleState: false }));
    const state = runtimeManager.getState();
    const activeProfile = runtimeManager.getActiveProfile() ?? (state.activeProfileId ? await getProfile(state.activeProfileId) : null);
    const hasActiveRuntime = state.status !== "stopped" && state.status !== "unknown_previous_runtime";

    return {
      service: "running",
      app: "ObsidianLM",
      version: "0.1.0",
      uiPort: settings.uiPort,
      managedLlamaPort: settings.managedLlamaPort,
      activeRuntime: hasActiveRuntime
        ? {
            type: activeProfile?.runtimeType ?? "llama.cpp",
            status: state.status,
            pid: state.pid,
            profileId: state.activeProfileId,
            profileName: activeProfile?.name ?? null,
            apiUrl: activeProfile && isLlamaCppServerProfile(activeProfile) ? `http://localhost:${activeProfile.port}/v1` : null
          }
        : null,
      warnings: runtimeManager.getWarnings(),
      detection: {
        categories: detection.categories,
        warnings: detection.warnings,
        ports: detection.ports,
        checkedAt: detection.checkedAt
      }
    };
  });
}
