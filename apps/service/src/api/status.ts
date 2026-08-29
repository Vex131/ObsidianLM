import type { FastifyInstance } from "fastify";
import type { StatusResponse } from "@obsidianlm/shared";
import { getStorageWarnings, loadSettings } from "../config/storage.js";
import { getAppPaths } from "../config/paths.js";
import type { RuntimeManager } from "../runtime/manager.js";
import { getProfile } from "../runtime/profiles.js";
import { sanitizeDetectionForApi } from "./sanitize.js";

export async function registerStatusRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/status", async (): Promise<StatusResponse> => {
    const settings = await loadSettings();
    const paths = getAppPaths();
    const detection = sanitizeDetectionForApi(runtimeManager.getDetectionSummary() ?? {
      categories: [], warnings: [], actions: [], processes: [], ports: [], previousState: null, checkedAt: new Date(0).toISOString()
    });
    const routerState = runtimeManager.getRouterState();
    const gpuStatus = runtimeManager.getGpuStatusSnapshot();
    const activeProfile = routerState.compatibilityProfileId ? await getProfile(routerState.compatibilityProfileId) : null;
    const hasActiveRuntime = ["starting", "running", "stopping"].includes(routerState.status);

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
            runtimeId: routerState.activeRuntimeId,
            buildId: routerState.activeBuildId,
            type: activeProfile?.runtimeType ?? "llama.cpp",
            status: routerState.status,
            pid: routerState.pid,
            profileId: routerState.compatibilityProfileId ?? null,
            profileName: activeProfile?.name ?? null,
            apiUrl: routerState.port === null ? null : `http://localhost:${routerState.port}/v1`
          }
        : null,
      warnings: [...runtimeManager.getWarnings(), ...getStorageWarnings()],
      detection: {
        categories: detection.categories,
        warnings: detection.warnings,
        ports: detection.ports,
        checkedAt: detection.checkedAt
      },
      gpu: {
        available: gpuStatus?.available ?? false,
        gpuCount: gpuStatus?.summary.gpuCount ?? 0,
        totalMemoryMiB: gpuStatus?.summary.totalMemoryMiB ?? null,
        usedMemoryMiB: gpuStatus?.summary.usedMemoryMiB ?? null,
        currentManagedRuntimeGpuMemoryMiB: gpuStatus?.summary.currentManagedRuntimeGpuMemoryMiB ?? null,
        unknownGpuProcessCount: gpuStatus?.summary.unknownGpuProcessCount ?? 0,
        warningsCount: gpuStatus?.summary.warningsCount ?? 0,
        checkedAt: gpuStatus?.checkedAt ?? detection.checkedAt
      }
    };
  });
}
