import type { FastifyInstance } from "fastify";
import { isBuildEligibleForManagedInference, isConfiguredModelEligibleForManagedRuntime, type DiscoveryWarning, type ReadinessCheck, type ReadinessResponse } from "@obsidianlm/shared";
import { getStorageWarnings, loadProfilesReadOnly, loadSettingsReadOnly } from "../config/storage.js";
import { isArtifactEligibleAsBaseModel, loadPhase15Domain } from "../config/phase15-domain.js";
import { synchronizeDiscoveryCatalog } from "../discovery/catalog-sync.js";
import { discoverToolInputs } from "../discovery/tool-inputs.js";
import { getGpuMonitoringStatus, type GpuMonitorOptions } from "../monitoring/gpu-monitor.js";
import { classifyPortStatus, detectPort } from "../process/port-detector.js";
import type { RuntimeManager } from "../runtime/manager.js";

function warningMessage(warning: DiscoveryWarning): string {
  return `${warning.code}: Discovery warning reported for a configured folder. Review discovery settings locally for details.`;
}

function runtimeMessage(status: ReadinessResponse["runtime"]["status"], active: boolean): string | null {
  if (active) {
    return `Runtime state is ${status}.`;
  }
  if (status === "failed") {
    return "Runtime failed; check local runtime logs for details.";
  }
  if (status === "unknown_previous_runtime") {
    return "Previous runtime state is unknown; ObsidianLM did not adopt or stop any process.";
  }
  return null;
}

function check(id: string, label: string, status: ReadinessCheck["status"], message: string, count?: number): ReadinessCheck {
  return { id, label, status, message, ...(count === undefined ? {} : { count }) };
}

function nextActionsFor(checks: ReadinessCheck[]): string[] {
  return checks
    .filter((item) => item.status === "block" || item.status === "warning" || item.status === "unavailable")
    .slice(0, 6)
    .map((item) => item.message);
}

export async function registerReadinessRoutes(app: FastifyInstance, runtimeManager: RuntimeManager, gpuMonitorOptions: GpuMonitorOptions = {}): Promise<void> {
  app.get("/api/readiness", async (): Promise<ReadinessResponse> => {
    const checkedAt = new Date().toISOString();
    const settings = await loadSettingsReadOnly();
    const [catalog, toolInputs, profiles] = await Promise.all([synchronizeDiscoveryCatalog(), discoverToolInputs(settings), loadProfilesReadOnly()]);
    const models = { models: catalog.models, warnings: [] }; const builds = { builds: catalog.builds, warnings: [] };
    const domain = await loadPhase15Domain();
    const routerState = runtimeManager.getRouterState();
    const port = await detectPort(settings.managedLlamaPort, "127.0.0.1");
    const portStatus = classifyPortStatus(port, routerState.pid);
    const awareness = await runtimeManager.refreshProcessAwareness();
    const gpuStatus = await getGpuMonitoringStatus(awareness.available === false ? null : awareness.processes, gpuMonitorOptions);
    const runtimeActive = ["starting", "running", "stopping"].includes(routerState.status);
    const activeProfile = routerState.compatibilityProfileId ? profiles.find((profile) => profile.id === routerState.compatibilityProfileId) ?? null : null;
    const eligibleBuilds = domain.builds.filter(isBuildEligibleForManagedInference);
    const eligibleConfiguredModels = domain.configuredModels.filter(isConfiguredModelEligibleForManagedRuntime);
    const baseModelCount = domain.artifacts.filter((artifact) => isArtifactEligibleAsBaseModel(domain, artifact)).length;
    const serverBuildCount = domain.builds.filter((build) => build.tools.some((tool) => tool.kind === "server" && tool.exists)).length;
    const benchCount = builds.builds.reduce((count, build) => count + build.tools.filter((tool) => tool.kind === "bench" && tool.exists).length, 0);
    const perplexityCount = builds.builds.reduce((count, build) => count + build.tools.filter((tool) => tool.kind === "perplexity" && tool.exists).length, 0);
    const storageWarnings = getStorageWarnings();
    const discoveryWarnings = [...models.warnings, ...builds.warnings, ...toolInputs.warnings].map(warningMessage);

    const checks = [
      check("model-folders", "Model folders", settings.modelFolders.length > 0 ? "pass" : "block", settings.modelFolders.length > 0 ? "At least one model folder is configured." : "Configure modelFolders before real validation."),
       check("gguf-models", "Base Models discovered", baseModelCount > 0 ? "pass" : "block", baseModelCount > 0 ? `${baseModelCount} base Model(s) discovered.` : "Rescan after adding at least one base GGUF Model to a configured model folder.", baseModelCount),
      check("llama-folders", "llama.cpp folders", settings.llamaCppFolders.length > 0 ? "pass" : "block", settings.llamaCppFolders.length > 0 ? "At least one llama.cpp folder is configured." : "Configure llamaCppFolders before real validation."),
        check("server-builds", "Usable llama-server Builds", serverBuildCount > 0 ? "pass" : "block", serverBuildCount > 0 ? `${serverBuildCount} usable llama-server Build(s) discovered.` : "Rescan after adding a llama.cpp Build with an available llama-server executable.", serverBuildCount),
      check("llama-bench", "llama-bench tools", benchCount > 0 ? "pass" : "warning", benchCount > 0 ? `${benchCount} llama-bench tool(s) discovered.` : "Add or build llama-bench before running benchmark validation.", benchCount),
      check("llama-perplexity", "llama-perplexity tools", perplexityCount > 0 ? "pass" : "warning", perplexityCount > 0 ? `${perplexityCount} llama-perplexity tool(s) discovered.` : "Add or build llama-perplexity before running perplexity validation.", perplexityCount),
      check("tool-input-folders", "Tool input folders", settings.toolInputFolders.length > 0 ? "pass" : "warning", settings.toolInputFolders.length > 0 ? "At least one tool input folder is configured." : "Configure toolInputFolders before llama-perplexity validation."),
      check("tool-inputs", "Tool inputs", toolInputs.files.length > 0 ? "pass" : "warning", toolInputs.files.length > 0 ? `${toolInputs.files.length} tool input file(s) discovered.` : "Add a small local .txt, .raw, .jsonl, or .md input and rescan before llama-perplexity validation.", toolInputs.files.length),
       check("configured-models", "Configured Models", eligibleConfiguredModels.length > 0 ? "pass" : "block", eligibleConfiguredModels.length > 0 ? `${eligibleConfiguredModels.length} eligible configured model(s).` : "Enable at least one valid Configured Model with available model and Build references before starting runtime validation.", eligibleConfiguredModels.length),
       check("discovered-builds", "Builds discovered", domain.builds.length > 0 ? "pass" : "block", domain.builds.length > 0 ? `${domain.builds.length} Build(s) discovered.` : "Add a llama.cpp Build to a configured discovery root.", domain.builds.length),
       check("eligible-builds", "Router-capable/eligible Builds", eligibleBuilds.length > 0 ? "pass" : "block", eligibleBuilds.length > 0 ? `${eligibleBuilds.length} Build(s) are eligible for managed router inference.` : "Validate a discovered Build for managed router inference.", eligibleBuilds.length),
      check("managed-port", "Managed port", portStatus.conflict ? "block" : "pass", portStatus.conflict ? portStatus.conflictMessage ?? "Managed llama.cpp port is already in use by another process." : `Managed llama.cpp port ${settings.managedLlamaPort} is available or owned by the current managed runtime.`),
      check("gpu-monitor", "GPU monitor", gpuStatus.available ? "pass" : "unavailable", gpuStatus.available ? `${gpuStatus.summary.gpuCount} NVIDIA GPU(s) visible.` : "GPU monitoring is unavailable or no NVIDIA GPU was detected; CPU-only validation can still proceed."),
      check("runtime", "Managed router", runtimeActive ? "pass" : "warning", runtimeActive ? `Managed router state is ${routerState.status}.` : "No active managed router is running; start an eligible Build for router health validation."),
      check("storage", "Storage", storageWarnings.length === 0 ? "pass" : "warning", storageWarnings.length === 0 ? "No storage warnings reported." : "Storage warnings were reported; review local data JSON backups.", storageWarnings.length)
    ];

    const blockingChecks = checks.filter((item) => item.status === "block");

    return {
      ok: blockingChecks.length === 0,
      checkedAt,
      configured: {
        modelFolders: settings.modelFolders.length > 0,
        llamaCppFolders: settings.llamaCppFolders.length > 0,
        toolInputFolders: settings.toolInputFolders.length > 0
      },
      counts: {
         discoveredArtifacts: domain.artifacts.length,
        configuredModels: domain.configuredModels.length,
         discoveredBuilds: domain.builds.length,
        eligibleBuilds: eligibleBuilds.length,
        ggufModels: baseModelCount,
         serverBuilds: serverBuildCount,
        llamaBenchTools: benchCount,
        llamaPerplexityTools: perplexityCount,
        toolInputs: toolInputs.files.length,
        profiles: profiles.length
      },
      managedPort: {
        port: settings.managedLlamaPort,
        inUse: port.inUse,
        conflict: portStatus.conflict,
        ownerKnown: port.ownerPid !== null,
        message: portStatus.conflictMessage
      },
      gpu: {
        available: gpuStatus.available,
        gpuCount: gpuStatus.summary.gpuCount,
        warningsCount: gpuStatus.summary.warningsCount,
        message: gpuStatus.available ? "GPU monitoring is available." : "GPU monitoring is unavailable or no NVIDIA GPU was detected."
      },
      runtime: {
        runtimeId: routerState.activeRuntimeId,
        buildId: routerState.activeBuildId,
        loadedConfiguredModelIds: routerState.configuredModelStates.filter((model) => model.state === "loaded").map((model) => model.configuredModelId),
        status: routerState.status,
        active: runtimeActive,
        profileId: routerState.compatibilityProfileId ?? null,
        profileName: activeProfile?.name ?? null,
        port: routerState.port,
        health: runtimeActive ? "active" : "inactive",
        routerHealth: routerState.health.state,
        message: runtimeMessage(routerState.status, runtimeActive)
      },
      checks,
      blockingChecks,
      warnings: [...new Set([...runtimeManager.getWarnings(), ...discoveryWarnings, ...gpuStatus.warnings.map((warning) => `${warning.code}: GPU monitoring warning reported.`)])],
      storageWarnings,
      nextActions: nextActionsFor(checks)
    };
  });
}
