import type { ConfiguredModelDetails, RouterRuntimeResponse } from "@obsidianlm/shared";
import { API_ENDPOINTS, ApiRequestError, fetchJson } from "../api";

export function configuredModelActionLabel(model: ConfiguredModelDetails, runtime: RouterRuntimeResponse | null): string {
  const router = runtime?.routerState;
  if (!router?.activeBuildId) return "Start build & load model";
  if (router.configuredModelStates.find((item) => item.configuredModelId === model.id)?.state === "loaded") return "Loaded";
  return router.activeBuildId === model.buildId ? "Switch model" : "Switch build & restart router";
}

export function configuredModelActionMessage(cause: unknown): string {
  const code = cause instanceof ApiRequestError ? (cause.data as { error?: string })?.error : undefined;
  const messages: Record<string, string> = {
    runtime_preset_restart_required: "The generated router artifact does not contain this model. Regenerate or restart the router first.",
    model_not_available: "The router catalog does not make this model available.",
    model_load_timeout: "The router timed out while loading this model.",
    model_load_failed: "The router could not load this model.",
    residency_policy_violation: "The router reported more than one resident model; policy permits one.",
    build_switch_required: "This model requires a different Build. Restart the router with that Build.",
    same_build_switch_required: "This model belongs to the active Build and must use a model switch.",
    cross_build_target_preflight_failed: "The target Build failed preflight before the current router was stopped.",
    cross_build_target_revalidation_failed: "The target Build changed and failed revalidation.",
    cross_build_target_start_failed: "The current router stopped, but the target Build failed to start. No rollback was attempted.",
    cross_build_target_model_failed: "The target Build started, but its configured model failed to load. No rollback was attempted.",
    port_conflict: "The managed router port is owned by another process.",
    stop_timeout: "The router did not stop before the timeout; ownership may be uncertain.",
    unknown_previous_runtime: "A previous router runtime is uncertain. Resolve it before starting a new router."
  };
  return (code && messages[code]) || (cause instanceof Error ? cause.message : "Runtime endpoint unavailable.");
}

export async function runConfiguredModelAction(model: ConfiguredModelDetails, runtime: RouterRuntimeResponse | null): Promise<boolean> {
  const router = runtime?.routerState;
  const sameBuild = router?.activeBuildId === model.buildId;
  if (router?.activeBuildId && !sameBuild && !window.confirm(`The current router will stop and the endpoint will be briefly unavailable. ${model.displayName}'s Build will replace it, and no automatic rollback is guaranteed. Continue?`)) return false;
  const options = { method: "POST", headers: { "Content-Type": "application/json" } };
  if (!router?.activeBuildId) {
    await fetchJson(API_ENDPOINTS.runtime.start, { ...options, body: JSON.stringify({ buildId: model.buildId }) });
    try {
      await fetchJson(API_ENDPOINTS.runtime.switchModel, { ...options, body: JSON.stringify({ configuredModelId: model.id }) });
    } catch (cause) {
      throw new Error(`Router started, but model load failed. ${configuredModelActionMessage(cause)}`);
    }
  } else {
    await fetchJson(sameBuild ? API_ENDPOINTS.runtime.switchModel : API_ENDPOINTS.runtime.switchBuild, { ...options, body: JSON.stringify({ configuredModelId: model.id }) });
  }
  return true;
}
