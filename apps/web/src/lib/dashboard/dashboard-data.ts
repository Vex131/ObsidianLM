import type { CommandSpec, ConfiguredModelDetails, LlamaCppBuildDetails, ProcessListResponse, RouterRuntimeResponse } from "@obsidianlm/shared";
import { API_ENDPOINTS, fetchJson, type GpuMonitoringStatus, type ReadinessResponse, type RuntimeHealthResponse, type RuntimeLogsResponse } from "../api";

export type DashboardData = {
  runtime: RouterRuntimeResponse | null;
  runtimeCommand: CommandSpec | null;
  configuredModels: ConfiguredModelDetails[];
  builds: LlamaCppBuildDetails[];
  runtimeLogs: RuntimeLogsResponse["logs"];
  gpuStatus: GpuMonitoringStatus | null;
  readiness: ReadinessResponse | null;
  runtimeHealth: RuntimeHealthResponse | null;
  processes: ProcessListResponse | null;
  loadedAt: string | null;
};

export const emptyDashboardData: DashboardData = {
  runtime: null, runtimeCommand: null, configuredModels: [], builds: [], runtimeLogs: [], gpuStatus: null,
  readiness: null, runtimeHealth: null, processes: null, loadedAt: null
};

async function optionalFetch<T>(url: string): Promise<T | null> {
  try { return await fetchJson<T>(url); } catch { return null; }
}

/** Router, configured models, and builds are the required runtime authority. */
export async function fetchDashboardData(): Promise<DashboardData> {
  const [runtime, configured, builds] = await Promise.all([
    optionalFetch<RouterRuntimeResponse>(API_ENDPOINTS.runtime.state),
    optionalFetch<{ configuredModels: ConfiguredModelDetails[] }>(API_ENDPOINTS.configuredModels.list),
    optionalFetch<{ builds: LlamaCppBuildDetails[] }>(API_ENDPOINTS.builds.list)
  ]);
  const catalog = runtime?.routerState.status === "running"
    ? await optionalFetch<{ routerState: RouterRuntimeResponse["routerState"] }>(API_ENDPOINTS.runtime.catalog)
    : null;
  const running = runtime?.routerState.status === "running";
  const [command, logs, gpuStatus, readiness, runtimeHealth, processes] = await Promise.all([
    running ? optionalFetch<{ command: CommandSpec }>(API_ENDPOINTS.runtime.command) : null,
    optionalFetch<RuntimeLogsResponse>(API_ENDPOINTS.runtime.logs(24)),
    optionalFetch<GpuMonitoringStatus>(API_ENDPOINTS.monitoring.gpu),
    optionalFetch<ReadinessResponse>(API_ENDPOINTS.readiness),
    running ? optionalFetch<RuntimeHealthResponse>(API_ENDPOINTS.runtime.health) : null,
    optionalFetch<ProcessListResponse>(API_ENDPOINTS.processes.llama)
  ]);
  return {
    runtime: runtime && catalog ? { ...runtime, routerState: catalog.routerState } : runtime,
    runtimeCommand: command?.command ?? null, configuredModels: configured?.configuredModels ?? [], builds: builds?.builds ?? [],
    runtimeLogs: logs?.logs ?? [], gpuStatus, readiness, runtimeHealth, processes, loadedAt: new Date().toISOString()
  };
}
