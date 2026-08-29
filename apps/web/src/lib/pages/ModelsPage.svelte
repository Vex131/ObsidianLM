<script lang="ts">
  import { onMount } from "svelte";
  import type { ConfiguredModelDetails, ConfiguredModelListResponse, ModelArtifactListItem, ModelArtifactListResponse, ModelDiscoveryResponse, RouterRuntimeResponse } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import ConfiguredModelRuntimeAction from "../components/ConfiguredModelRuntimeAction.svelte";
  import { API_ENDPOINTS, fetchJson } from "../api";

  type ArtifactRow = ModelArtifactListItem | { id: string; discoveryId: string; resource: { owner: { scope: "local" }; locator: string }; kind: string; referenceStatus: string; configuredModelIds: string[]; metadata?: undefined };
  let mode: "configured" | "artifacts" = "configured";
  let configured: ConfiguredModelDetails[] = [], artifacts: ModelArtifactListItem[] = [], discovery: ModelDiscoveryResponse["models"] = [], runtime: RouterRuntimeResponse | null = null;
  let selected: string | null = null, message = "", query = "", availability = "all", enabled = "all";
  $: currentConfigured = configured.find((model) => model.id === selected) ?? null;
  $: merged = [...artifacts, ...discovery.filter((found) => !artifacts.some((artifact) => artifact.discoveryId === found.id)).map((found) => ({ id: `discovery:${found.id}`, discoveryId: found.id, resource: { owner: { scope: "local" as const }, locator: found.path }, kind: found.artifactKindGuess ?? "unknown", referenceStatus: "available", configuredModelIds: [] }))] as ArtifactRow[];
  $: currentArtifact = merged.find((artifact) => artifact.id === selected) ?? null;
  $: configuredRows = configured.filter((model) => `${model.displayName} ${model.routerAlias}`.toLowerCase().includes(query.toLowerCase()) && (availability === "all" || model.validation.references.artifact === availability || model.validation.references.build === availability) && (enabled === "all" || String(model.enabled) === enabled));
  $: artifactRows = merged.filter((artifact) => `${artifact.metadata?.displayName ?? ""} ${artifact.resource.locator} ${artifact.kind}`.toLowerCase().includes(query.toLowerCase()) && (availability === "all" || artifact.referenceStatus === availability));
  $: discoveryEvidence = currentArtifact?.discoveryId ? discovery.find((entry) => entry.id === currentArtifact?.discoveryId) : undefined;
  $: artifactRegistered = !!currentArtifact && !currentArtifact.id.startsWith("discovery:");
  $: artifactConfigurable = artifactRegistered && (currentArtifact?.kind === "model" || currentArtifact?.kind === "unknown");

  async function load() {
    message = "";
    try {
      const [models, registered] = await Promise.all([fetchJson<ConfiguredModelListResponse>(API_ENDPOINTS.configuredModels.list), fetchJson<ModelArtifactListResponse>(API_ENDPOINTS.modelArtifacts.list)]);
      configured = models.configuredModels; artifacts = registered.artifacts;
      const [found, router] = await Promise.allSettled([fetchJson<ModelDiscoveryResponse>(API_ENDPOINTS.discovery.models), fetchJson<RouterRuntimeResponse>(API_ENDPOINTS.runtime.state)]);
      discovery = found.status === "fulfilled" ? found.value.models : [];
      runtime = router.status === "fulfilled" ? router.value : null;
      if (found.status === "rejected" || router.status === "rejected") message = "Discovery or runtime status is unavailable; registered records remain available.";
    } catch (error) { message = error instanceof Error ? error.message : "Could not load configured models."; }
  }
  async function action(path: string, method = "POST", body?: unknown, success = "Completed.") {
    try { await fetchJson(path, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); message = success; await load(); }
    catch (error) { message = error instanceof Error ? error.message : "Action failed."; }
  }
  function routerState(model: ConfiguredModelDetails, currentRuntime: RouterRuntimeResponse | null) { if (!currentRuntime) return "unavailable"; if (currentRuntime.routerState.activeBuildId !== model.buildId) return "Other Build"; return currentRuntime.routerState.configuredModelStates.find((entry) => entry.configuredModelId === model.id)?.state ?? "unknown"; }
  function buildLabel(model: ConfiguredModelDetails) { return model.build?.displayName ?? "Other Build"; }
  onMount(() => { void load(); });
</script>

<main class="page-surface models-page" aria-label="Models">
  <PageHeader title="Models" subtitle="Configured Models are authoritative. Artifacts remain persistent records even when discovery is unavailable." />
  <div class="actions" role="group" aria-label="Models views">
    <button class:primary={mode === "configured"} class="btn" type="button" aria-pressed={mode === "configured"} on:click={() => { mode = "configured"; selected = null; }}>Configured Models</button>
    <button class:primary={mode === "artifacts"} class="btn" type="button" aria-pressed={mode === "artifacts"} on:click={() => { mode = "artifacts"; selected = null; }}>Artifacts</button>
    <span role="status">{message}</span>
  </div>
  <div class="filters">
    <label>Search <input bind:value={query} placeholder="Name, alias, or artifact" /></label>
    <label>Availability <select bind:value={availability}><option value="all">All</option><option value="available">Available</option><option value="missing">Missing</option><option value="invalid">Invalid</option><option value="unknown">Unknown</option></select></label>
    {#if mode === "configured"}<label>Enabled <select bind:value={enabled}><option value="all">All</option><option value="true">Enabled</option><option value="false">Disabled</option></select></label>{/if}
    {#if mode === "artifacts"}<button class="btn" type="button" on:click={() => action(API_ENDPOINTS.discovery.rescanModels, "POST", undefined, "Discovery rescanned.")}>Rescan discovery</button>{/if}
  </div>
  <div class="layout">
    <section class="panel list" aria-label={mode === "configured" ? "Configured Models" : "Artifacts"}>
      {#if mode === "configured"}
        <div class="table configured-table" role="table" aria-label="Configured Models"><div class="head" role="row"><span>Name</span><span>Alias</span><span>Build</span><span>Mode</span><span>Availability</span><span>Router state</span><span>Enabled</span></div>
          {#each configuredRows as model}<button class:active={selected === model.id} class="row" type="button" role="row" on:click={() => selected = model.id}><strong>{model.displayName}</strong><span>{model.routerAlias}</span><span>{buildLabel(model)}</span><span>{model.projector ? "Vision" : "Text"}</span><span>{model.validation.references.artifact}/{model.validation.references.build}</span><span>{routerState(model, runtime)}</span><span>{model.enabled ? "Yes" : "No"}</span></button>{:else}<p class="empty-state">No configured models match these filters.</p>{/each}
        </div>
      {:else}
        <div class="table artifact-table" role="table" aria-label="Artifacts"><div class="head" role="row"><span>Name</span><span>State</span><span>Kind</span><span>Availability</span></div>
          {#each artifactRows as artifact}<button class:active={selected === artifact.id} class="row" type="button" role="row" on:click={() => selected = artifact.id}><strong>{artifact.metadata?.displayName ?? artifact.resource.locator.split(/[\\/]/).pop()}</strong><span>{artifact.id.startsWith("discovery:") ? "Discovered only" : "Registered Artifact"}</span><span>{artifact.kind}</span><span>{artifact.referenceStatus}</span></button>{:else}<p class="empty-state">No registered or discovered artifacts match these filters.</p>{/each}
        </div>
      {/if}
    </section>
    <aside class="panel inspector" aria-label="Model inspector"><div class="panel-head"><h2 class="section-title">Inspector</h2></div>
      {#if currentConfigured}
        <dl><dt>Identity</dt><dd>{currentConfigured.id}</dd><dt>Alias</dt><dd>{currentConfigured.routerAlias}</dd><dt>Artifact</dt><dd>{currentConfigured.artifact?.resource.locator ?? currentConfigured.artifactId}</dd><dt>Build</dt><dd>{buildLabel(currentConfigured)}</dd><dt>Enabled</dt><dd>{currentConfigured.enabled ? "Yes" : "No"}</dd><dt>References</dt><dd>{currentConfigured.validation.references.artifact} artifact / {currentConfigured.validation.references.build} build</dd><dt>Build eligibility</dt><dd>{currentConfigured.validation.managedInferenceEligibility ?? "unknown"}</dd><dt>Router state</dt><dd>{routerState(currentConfigured, runtime)}</dd></dl>
        <section><h3>Projector</h3>{#if currentConfigured.projector}<p>Explicit: {currentConfigured.projector.resource.locator} ({currentConfigured.projectorAssociation?.validationStatus ?? "unknown"})</p>{:else}<p>None selected.</p>{/if}{#each currentConfigured.projectorCandidates ?? [] as candidate}<p>Candidate only: {candidate.artifactId} ({candidate.basis}{candidate.confidence ? `, ${candidate.confidence}` : ""})</p>{/each}</section>
        {#if currentConfigured.warnings?.length}<section><h3>Warnings</h3>{#each currentConfigured.warnings as warning}<p class="warning">{warning}</p>{/each}</section>{/if}
        <p><a class="btn" href={`#/profiles?configuredModel=${currentConfigured.id}`}>Edit Profiles</a></p>
        <ConfiguredModelRuntimeAction model={currentConfigured} {runtime} onComplete={load} />
      {:else if currentArtifact}
        <dl><dt>Identity</dt><dd>{currentArtifact.id}</dd><dt>Resource</dt><dd>{currentArtifact.resource.locator}</dd><dt>Kind</dt><dd>{currentArtifact.kind}</dd><dt>Availability</dt><dd>{currentArtifact.referenceStatus}</dd><dt>Configured Models</dt><dd>{#if currentArtifact.configuredModelIds.length}{#each currentArtifact.configuredModelIds as id}<a href={`#/profiles?configuredModel=${id}`}>{id}</a>{/each}{:else}None{/if}</dd></dl>
        {#if discoveryEvidence}<section><h3>Discovery evidence</h3><p>{discoveryEvidence.path}</p><p>Detected {new Date(discoveryEvidence.detectedAt).toLocaleString()}</p></section>{/if}
        {#if currentArtifact.metadata}<section><h3>Metadata</h3><p>{currentArtifact.metadata.architecture ?? "Unknown architecture"} · {currentArtifact.metadata.status}</p>{#each currentArtifact.metadata.warnings as warning}<p class="warning">{warning}</p>{/each}</section>{/if}
        <div class="actions">{#if !artifactRegistered}<button class="btn primary" type="button" on:click={() => action(API_ENDPOINTS.modelArtifacts.register, "POST", { discoveryId: currentArtifact!.discoveryId }, "Artifact registered.")}>Register artifact</button>{:else}<button class="btn" type="button" on:click={() => action(API_ENDPOINTS.modelArtifacts.reconcile(currentArtifact!.id), "POST", undefined, "Artifact reconciled.")}>Reconcile</button>{#if artifactConfigurable}<a class="btn primary" href={`#/profiles?artifact=${currentArtifact.id}`}>New configuration</a>{:else}<small class="warning">New configuration requires a registered model or unknown artifact.</small>{/if}<button class="btn danger" type="button" on:click={() => confirm(`Delete registered artifact ${currentArtifact!.id}?`) && action(API_ENDPOINTS.modelArtifacts.delete(currentArtifact!.id), "DELETE", undefined, "Artifact deleted.")}>Delete</button>{/if}</div>
      {:else}<p class="empty-state">Select a record to inspect.</p>{/if}
    </aside>
  </div>
</main>

<style>
  .actions,.filters{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin-bottom:.75rem}.actions span{color:var(--color-muted)}.filters label{display:grid;gap:.2rem;font-size:.82rem}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(17rem,27rem);gap:1rem}.list{overflow:auto}.table{min-width:43rem}.head,.row{display:grid;grid-template-columns:1.4fr 1fr 1.2fr .8fr 1.1fr 1fr .65fr;gap:.6rem;align-items:center;padding:.65rem .75rem}.artifact-table .head,.artifact-table .row{grid-template-columns:1.5fr 1fr .7fr .8fr}.head{font-size:.75rem;color:var(--color-muted);border-bottom:1px solid var(--color-line)}.row{width:100%;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--color-line)}.row:hover,.row.active{background:var(--color-panel-strong)}.row span,.row strong,dd{overflow-wrap:anywhere}.inspector{padding:1rem;min-width:0}.inspector section{border-top:1px solid var(--color-line);padding-top:.65rem;margin-top:.65rem}.inspector h3{margin:.1rem 0 .45rem;font-size:.9rem}.inspector p{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:8rem minmax(0,1fr);gap:.4rem .6rem;margin:0}dt{color:var(--color-muted)}dd{margin:0}.warning{color:var(--color-warning)}@media(max-width:760px){.layout{grid-template-columns:1fr}.models-page{min-width:0;overflow-x:hidden}.list{max-width:100%}}@media(max-width:320px){.filters input,.filters select{max-width:100%}.inspector{min-width:0}}
</style>
