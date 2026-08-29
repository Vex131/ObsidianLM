<script lang="ts">
  import type { ConfiguredModelDetails, RouterRuntimeResponse } from "@obsidianlm/shared";
  import { API_ENDPOINTS, fetchJson, ApiRequestError } from "../api";

  export let model: ConfiguredModelDetails;
  export let runtime: RouterRuntimeResponse | null = null;
  export let onComplete: () => void = () => {};
  let busy = false;
  let error = "";

  $: router = runtime?.routerState;
  $: modelState = router?.configuredModelStates.find((entry) => entry.configuredModelId === model.id)?.state;
  $: sameBuild = router?.activeBuildId === model.buildId;
  $: unavailable = !runtime || !model.enabled || model.validation.status === "invalid" || router?.status === "failed";
  $: label = !router?.activeBuildId ? "Start build & load model" : modelState === "loaded" ? "Loaded" : sameBuild ? "Switch model" : "Switch build & restart router";

  async function run() {
    if (busy || unavailable || modelState === "loaded") return;
    if (router?.activeBuildId && !sameBuild && !window.confirm(`The active router stops briefly. ${model.displayName}'s target Build replaces it; no rollback is promised. Continue?`)) return;
    busy = true; error = "";
    try {
      if (!router?.activeBuildId) {
        await fetchJson(API_ENDPOINTS.runtime.start, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ buildId: model.buildId }) });
        try { await fetchJson(API_ENDPOINTS.runtime.switchModel, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configuredModelId: model.id }) }); }
        catch (cause) { error = `Router started, but model load failed: ${message(cause)}`; onComplete(); return; }
      } else await fetchJson(sameBuild ? API_ENDPOINTS.runtime.switchModel : API_ENDPOINTS.runtime.switchBuild, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ configuredModelId: model.id }) });
      onComplete();
    } catch (cause) {
      error = message(cause);
    } finally { busy = false; }
  }
  function message(cause: unknown): string { const code=cause instanceof ApiRequestError ? (cause.data as {error?:string})?.error : undefined; if(code === "runtime_preset_restart_required") return "The prepared router preset does not exactly contain this model; restart or regenerate it first. Open Runtime."; if(code === "model_not_available") return "The model is unavailable to the router."; if(code === "model_load_timeout") return "The router timed out loading this model."; if(code === "model_load_failed") return "The router could not load this model."; return cause instanceof Error ? cause.message : "Runtime endpoint unavailable."; }
</script>

<div class="runtime-action">
  <button class="btn primary" type="button" disabled={busy || unavailable || modelState === "loaded"} on:click={run}>{busy ? "Working…" : label}</button>
  {#if unavailable}<small class="warning">Runtime endpoint unavailable or this enabled model is not valid.</small>{/if}
  {#if error}<small class="error">{error}</small>{/if}
</div>

<style>
  .runtime-action { display:grid; gap:.35rem; }.runtime-action small { overflow-wrap:anywhere; }
</style>
