import type { FastifyInstance } from "fastify";
import type { DiscoveryWarning, ReadinessCheck, ReadinessResponse, RuntimeProfile } from "@obsidianlm/shared";
import { getStorageWarnings, loadProfilesReadOnly, loadSettingsReadOnly } from "../config/storage.js";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { discoverModels } from "../discovery/models.js";
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

function hasProfiles(profiles: RuntimeProfile[]): boolean {
  return profiles.length > 0;
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
    const [models, builds, toolInputs, profiles] = await Promise.all([discoverModels(settings), discoverLlamaBuilds(settings), discoverToolInputs(settings), loadProfilesReadOnly()]);
    const state = runtimeManager.getState();
    const port = await detectPort(settings.managedLlamaPort, "127.0.0.1");
    const portStatus = classifyPortStatus(port, state.pid);
    const gpuStatus = await getGpuMonitoringStatus(state.pid, gpuMonitorOptions);
    const runtimeActive = state.status !== "stopped" && state.status !== "unknown_previous_runtime";
    const activeProfile = runtimeManager.getActiveProfile() ?? profiles.find((profile) => profile.id === state.activeProfileId) ?? null;
    const benchCount = builds.builds.reduce((count, build) => count + build.tools.filter((tool) => tool.kind === "bench" && tool.exists).length, 0);
    const perplexityCount = builds.builds.reduce((count, build) => count + build.tools.filter((tool) => tool.kind === "perplexity" && tool.exists).length, 0);
    const storageWarnings = getStorageWarnings();
    const discoveryWarnings = [...models.warnings, ...builds.warnings, ...toolInputs.warnings].map(warningMessage);

    const checks = [
      check("admin-token", "Admin token", settings.adminTokenHash ? "pass" : "block", settings.adminTokenHash ? "Admin token is configured." : "Complete first-run admin token setup."),
      check("model-folders", "Model folders", settings.modelFolders.length > 0 ? "pass" : "block", settings.modelFolders.length > 0 ? "At least one model folder is configured." : "Configure modelFolders before real validation."),
      check("gguf-models", "GGUF models", models.models.length > 0 ? "pass" : "block", models.models.length > 0 ? `${models.models.length} GGUF model(s) discovered.` : "Rescan after adding at least one GGUF model to a configured model folder.", models.models.length),
      check("llama-folders", "llama.cpp folders", settings.llamaCppFolders.length > 0 ? "pass" : "block", settings.llamaCppFolders.length > 0 ? "At least one llama.cpp folder is configured." : "Configure llamaCppFolders before real validation."),
      check("server-builds", "llama-server builds", builds.builds.length > 0 ? "pass" : "block", builds.builds.length > 0 ? `${builds.builds.length} llama-server build(s) discovered.` : "Rescan after adding a llama.cpp build with llama-server.", builds.builds.length),
      check("llama-bench", "llama-bench tools", benchCount > 0 ? "pass" : "warning", benchCount > 0 ? `${benchCount} llama-bench tool(s) discovered.` : "Add or build llama-bench before running benchmark validation.", benchCount),
      check("llama-perplexity", "llama-perplexity tools", perplexityCount > 0 ? "pass" : "warning", perplexityCount > 0 ? `${perplexityCount} llama-perplexity tool(s) discovered.` : "Add or build llama-perplexity before running perplexity validation.", perplexityCount),
      check("tool-input-folders", "Tool input folders", settings.toolInputFolders.length > 0 ? "pass" : "warning", settings.toolInputFolders.length > 0 ? "At least one tool input folder is configured." : "Configure toolInputFolders before llama-perplexity validation."),
      check("tool-inputs", "Tool inputs", toolInputs.files.length > 0 ? "pass" : "warning", toolInputs.files.length > 0 ? `${toolInputs.files.length} tool input file(s) discovered.` : "Add a small local .txt, .raw, .jsonl, or .md input and rescan before llama-perplexity validation.", toolInputs.files.length),
      check("profiles", "Profiles", hasProfiles(profiles) ? "pass" : "block", hasProfiles(profiles) ? `${profiles.length} profile(s) configured.` : "Create or import a llama.cpp server profile before starting runtime validation.", profiles.length),
      check("managed-port", "Managed port", portStatus.conflict ? "block" : "pass", portStatus.conflict ? portStatus.conflictMessage ?? "Managed llama.cpp port is already in use by another process." : `Managed llama.cpp port ${settings.managedLlamaPort} is available or owned by the current managed runtime.`),
      check("gpu-monitor", "GPU monitor", gpuStatus.available ? "pass" : "unavailable", gpuStatus.available ? `${gpuStatus.summary.gpuCount} NVIDIA GPU(s) visible.` : "GPU monitoring is unavailable or no NVIDIA GPU was detected; CPU-only validation can still proceed."),
      check("runtime", "Runtime", runtimeActive ? "pass" : "warning", runtimeActive ? `Runtime state is ${state.status}.` : "No active managed runtime is running; start a profile for runtime health validation."),
      check("storage", "Storage", storageWarnings.length === 0 ? "pass" : "warning", storageWarnings.length === 0 ? "No storage warnings reported." : "Storage warnings were reported; review local data JSON backups.", storageWarnings.length)
    ];

    const blockingChecks = checks.filter((item) => item.status === "block");

    return {
      ok: blockingChecks.length === 0,
      checkedAt,
      configured: {
        adminToken: Boolean(settings.adminTokenHash),
        modelFolders: settings.modelFolders.length > 0,
        llamaCppFolders: settings.llamaCppFolders.length > 0,
        toolInputFolders: settings.toolInputFolders.length > 0
      },
      counts: {
        ggufModels: models.models.length,
        serverBuilds: builds.builds.length,
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
        status: state.status,
        active: runtimeActive,
        profileId: state.activeProfileId,
        profileName: activeProfile?.name ?? null,
        port: state.port,
        health: runtimeActive ? "active" : "inactive",
        message: runtimeMessage(state.status, runtimeActive)
      },
      checks,
      blockingChecks,
      warnings: [...new Set([...runtimeManager.getWarnings(), ...discoveryWarnings, ...gpuStatus.warnings.map((warning) => `${warning.code}: GPU monitoring warning reported.`)])],
      storageWarnings,
      nextActions: nextActionsFor(checks)
    };
  });
}
