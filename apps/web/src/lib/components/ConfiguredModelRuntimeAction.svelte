<script lang="ts">
  import type { ConfiguredModelDetails, RouterRuntimeResponse } from "@obsidianlm/shared";
  import { configuredModelActionLabel, configuredModelActionMessage, runConfiguredModelAction } from "./configured-model-runtime-action";
  export let model: ConfiguredModelDetails;
  export let runtime: RouterRuntimeResponse | null = null;
  export let onComplete: () => void = () => {};
  let busy = false; let error = "";
  $: router = runtime?.routerState;
  $: modelState = router?.configuredModelStates.find((entry) => entry.configuredModelId === model.id)?.state;
  $: unavailable = !runtime || !model.enabled || model.validation.status === "invalid" || router?.status === "failed" || router?.status === "unknown_previous_runtime";
  $: label = configuredModelActionLabel(model, runtime);
  async function run() { if (busy || unavailable || modelState === "loaded") return; busy = true; error = ""; try { if (await runConfiguredModelAction(model, runtime)) onComplete(); } catch (cause) { error = configuredModelActionMessage(cause); } finally { busy = false; } }
</script>
<div class="runtime-action"><button class="btn primary" type="button" disabled={busy || unavailable || modelState === "loaded"} on:click={run}>{busy ? "Working…" : label}</button>{#if unavailable}<small class="warning">Router unavailable, uncertain, or this model is disabled or invalid.</small>{/if}{#if error}<small class="error">{error}</small>{/if}</div>
<style>.runtime-action { display:grid; gap:.35rem; }.runtime-action small { overflow-wrap:anywhere; }</style>
