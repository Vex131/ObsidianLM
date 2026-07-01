import type { FastifyInstance } from "fastify";
import type { StatusResponse } from "@obsidianlm/shared";
import { loadSettings } from "../config/storage.js";
import { getAppPaths } from "../config/paths.js";
import { getGpuMonitoringStatus, type GpuMonitorOptions } from "../monitoring/gpu-monitor.js";
import type { RuntimeManager } from "../runtime/manager.js";
import { getProfile, isLlamaCppServerProfile } from "../runtime/profiles.js";
import { sanitizeDetectionForApi } from "./sanitize.js";

export async function registerStatusRoutes(app: FastifyInstance, runtimeManager: RuntimeManager, gpuMonitorOptions: GpuMonitorOptions = {}): Promise<void> {
  app.get("/api/status", async (): Promise<StatusResponse> => {
    const settings = await loadSettings();
    const paths = getAppPaths();
    const detection = sanitizeDetectionForApi(await runtimeManager.refreshDetection({ reconcileStaleState: false }));
    const state = runtimeManager.getState();
    const gpuStatus = await getGpuMonitoringStatus(state.pid, gpuMonitorOptions);
    const activeProfile = runtimeManager.getActiveProfile() ?? (state.activeProfileId ? await getProfile(state.activeProfileId) : null);
    const hasActiveRuntime = state.status !== "stopped" && state.status !== "unknown_previous_runtime";

    return {
      service: "running",
      app: "ObsidianLM",
      version: "0.1.0",
      serviceMode: paths.serviceMode,
      runningMode: paths.serviceMode ? "windowsService" : process.env.NODE_ENV === "production" ? "production" : "development",
      dataDirMode: paths.dataDirMode,
      logDirMode: paths.logDirMode,
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
      },
      gpu: {
        available: gpuStatus.available,
        gpuCount: gpuStatus.summary.gpuCount,
        totalMemoryMiB: gpuStatus.summary.totalMemoryMiB,
        usedMemoryMiB: gpuStatus.summary.usedMemoryMiB,
        currentManagedRuntimeGpuMemoryMiB: gpuStatus.summary.currentManagedRuntimeGpuMemoryMiB,
        unknownGpuProcessCount: gpuStatus.summary.unknownGpuProcessCount,
        warningsCount: gpuStatus.summary.warningsCount,
        checkedAt: gpuStatus.checkedAt
      }
    };
  });
}
