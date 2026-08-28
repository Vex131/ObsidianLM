<script lang="ts">
  import { onMount } from "svelte";
  import type { DiscoveredModel } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import { API_ENDPOINTS, fetchJson, type GgufMetadataInspection, type ModelArtifactUsageResponse, type ModelDiscoveryResponse, type ProfileListResponse, type RuntimeState } from "../api";
  import { artifactSignature, effectiveKind, formatBytes, formatDate, isPrimaryModel, matchesModel, relatedArtifactCandidates, sortModels, typeLabel, type ModelSort, type ModelTab } from "../model-library";

  type RuntimeStateResponse = { state: RuntimeState; warnings: string[] };
  let models: DiscoveredModel[] = [];
  let warnings: string[] = [];
  let scannedFolders: string[] = [];
  let profiles: ProfileListResponse["profiles"] = [];
  let activeProfileId: string | null = null;
  let usage = new Map<string, string[]>();
  let missingProfileIds: string[] = [];
  let inspections = new Map<string, GgufMetadataInspection>();
  let signatures = new Map<string, string>();
  let loadingIds = new Set<string>();
  let request = 0;
  let selectedId: string | null = null;
  let query = "";
  let tab: ModelTab = "models";
  let family = "all";
  let quant = "all";
  let folder = "all";
  let usageFilter: "all" | "used" | "unused" = "all";
  let sort: ModelSort = "name";
  let message = "";
  let loading = true;

  $: usedIds = new Set([...usage.entries()].filter(([, profileIds]) => profileIds.length).map(([id]) => id));
  $: filtered = sortModels(models.filter((model) => matchesModel(model, inspections.get(model.id), query, tab, family, quant, usageFilter, folder, usedIds)), sort);
  $: selected = models.find((model) => model.id === selectedId) ?? null;
  $: selectedInspection = selected ? inspections.get(selected.id) : undefined;
  $: selectedProfiles = selected ? (usage.get(selected.id) ?? []).map((id) => profiles.find((profile) => profile.id === id)).filter(Boolean) : [];
  $: families = [...new Set(models.flatMap((model) => [model.familyGuess, inspections.get(model.id)?.architecture]).filter((value): value is string => Boolean(value)))].sort();
  $: quants = [...new Set(models.map((model) => model.quantizationGuess ?? "Unknown"))].sort();
  $: folders = [...new Set(models.map((model) => model.folder))].sort();
  $: tabCounts = {
    models: models.filter((model) => { const kind = effectiveKind(model, inspections.get(model.id)); return kind === "model" || kind === "unknown"; }).length,
    projectors: models.filter((model) => effectiveKind(model, inspections.get(model.id)) === "mmproj").length,
    other: models.filter((model) => ["adapter", "imatrix", "other"].includes(effectiveKind(model, inspections.get(model.id)))).length,
    all: models.length
  };

  async function load(rescan = false) {
    loading = true;
    const current = ++request;
    try {
      if (rescan) await fetchJson(API_ENDPOINTS.discovery.rescanModels, { method: "POST" });
      const [discovery, profileResponse, usageResponse, runtimeResponse] = await Promise.all([
        fetchJson<ModelDiscoveryResponse>(API_ENDPOINTS.discovery.models), fetchJson<ProfileListResponse>(API_ENDPOINTS.profiles.list),
        fetchJson<ModelArtifactUsageResponse>(API_ENDPOINTS.discovery.modelUsage), fetchJson<RuntimeStateResponse>(API_ENDPOINTS.runtime.state)
      ]);
      if (current !== request) return;
      const nextSignatures = new Map(discovery.models.map((model) => [model.id, artifactSignature(model)]));
      inspections = new Map([...inspections].filter(([id]) => signatures.get(id) === nextSignatures.get(id)));
      signatures = nextSignatures;
      models = discovery.models;
      warnings = discovery.warnings.map((warning) => warning.message);
      scannedFolders = discovery.scannedFolders;
      profiles = profileResponse.profiles;
      usage = new Map(usageResponse.usage.map((entry) => [entry.artifactId, entry.profileIds]));
      missingProfileIds = usageResponse.missingProfileIds;
      activeProfileId = runtimeResponse.state.activeProfileId;
      if (selectedId && !discovery.models.some((model) => model.id === selectedId)) selectedId = null;
      message = rescan ? "Model discovery rescanned." : "";
    } catch (error) { if (current === request) message = error instanceof Error ? error.message : "Could not load model library"; }
    finally { if (current === request) loading = false; }
  }

  async function selectModel(model: DiscoveredModel) {
    selectedId = model.id;
    if (inspections.has(model.id) || loadingIds.has(model.id)) return;
    const current = ++request;
    loadingIds = new Set(loadingIds).add(model.id);
    try {
      const inspection = await fetchJson<GgufMetadataInspection>(API_ENDPOINTS.discovery.modelMetadata(model.id));
      if (current === request && selectedId === model.id) inspections = new Map(inspections).set(model.id, inspection);
    } catch (error) { if (current === request) message = error instanceof Error ? error.message : "Could not inspect this GGUF artifact"; }
    finally { loadingIds = new Set(loadingIds); loadingIds.delete(model.id); loadingIds = new Set(loadingIds); }
  }

  async function copyPath(path: string) { try { await navigator.clipboard.writeText(path); message = "Path copied."; } catch { message = "Copy the selected path manually."; } }
  function clearFilters() { query = ""; tab = "models"; family = quant = folder = "all"; usageFilter = "all"; }
  function profileHref(id: string) { return `#profiles?profile=${encodeURIComponent(id)}`; }
  function configureHref(id: string) { return `#profiles?model=${encodeURIComponent(id)}`; }
  onMount(() => { void load(); });
</script>

<main class="page-surface models-page" aria-label="Models">
  <PageHeader title="Models" subtitle="Inspect discovered GGUF artifacts, see profile usage, and hand off primary models to Profiles." />
  <div class="models-actions"><button class="btn primary" type="button" on:click={() => load(true)}>Rescan models</button><span role="status" aria-live="polite">{message}</span></div>
  {#if warnings.length}<details class="discovery-warning"><summary>{warnings.length} discovery warning{warnings.length === 1 ? "" : "s"}</summary>{#each warnings as warning}<p>{warning}</p>{/each}</details>{/if}
  <div class="models-layout">
    <section class="panel model-library" aria-label="Model artifact library">
      <div class="panel-head"><h2 class="section-title">Artifact library</h2><span class="mini-pill">{filtered.length} of {models.length}</span></div>
      <div class="filters"><label>Search<input bind:value={query} placeholder="Name, path, architecture" /></label><div class="tabs" aria-label="Artifact type filters">{#each [["models", "Models"], ["projectors", "Projectors"], ["other", "Other GGUF"], ["all", "All"]] as [value, label]}<button class:active={tab === value} type="button" on:click={() => tab = value as ModelTab}>{label} ({tabCounts[value as ModelTab]})</button>{/each}</div><div class="filter-selects"><select aria-label="Family" bind:value={family}><option value="all">All families</option>{#each families as value}<option>{value}</option>{/each}</select><select aria-label="Quantization" bind:value={quant}><option value="all">All quants</option>{#each quants as value}<option>{value}</option>{/each}</select><select aria-label="Usage" bind:value={usageFilter}><option value="all">Used and unused</option><option value="used">Used by profiles</option><option value="unused">Unused</option></select><select aria-label="Folder" bind:value={folder}><option value="all">All folders</option>{#each folders as value}<option>{value}</option>{/each}</select><select aria-label="Sort" bind:value={sort}><option value="name">Name</option><option value="size">Size</option><option value="modified">Modified</option></select></div></div>
      {#if loading}<p class="empty-state" role="status">Loading discovered artifacts…</p>{:else if !scannedFolders.length}<p class="empty-state">No model folders are configured. <a href="#settings">Open Settings</a> to add one, then rescan.</p>{:else if !models.length}<p class="empty-state">No GGUF artifacts were found in configured folders. Check the folders or <button type="button" class="link-button" on:click={() => load(true)}>rescan models</button>.</p>{:else if !filtered.length}<p class="empty-state">No artifacts match these filters. <button type="button" class="link-button" on:click={clearFilters}>Clear filters</button>.</p>{:else}<div class="model-table"><div class="model-head" aria-hidden="true"><span>Name</span><span>Type</span><span>Architecture</span><span>Quant</span><span>Size</span><span>Context</span><span>Profiles</span><span>Modified</span></div>{#each filtered as model}<button class:active={model.id === selectedId} class="model-row" type="button" aria-label={`Inspect ${model.name}`} on:click={() => selectModel(model)}><strong>{model.name}{#if activeProfileId && (usage.get(model.id) ?? []).includes(activeProfileId)}<b class="active-badge">Active</b>{/if}</strong><span>{typeLabel(model, inspections.get(model.id))}</span><span>{inspections.get(model.id)?.architecture ?? "Uninspected"}</span><span>{model.quantizationGuess ?? "Unknown"}</span><span>{formatBytes(model.sizeBytes)}</span><span>{inspections.get(model.id)?.trainedContext?.toLocaleString() ?? "Uninspected"}</span><span>{(usage.get(model.id) ?? []).length}</span><span>{formatDate(model.modifiedAt)}</span></button>{/each}</div>{/if}
    </section>
    <aside class="panel model-inspector" aria-label="Artifact inspector">
      <div class="panel-head"><h2 class="section-title">Inspector</h2><span class="mini-pill">{selected ? loadingIds.has(selected.id) ? "Loading" : selectedInspection?.status ?? "Uninspected" : "Select artifact"}</span></div>
      {#if selected}<div class="inspector-body"><h3>Identity</h3><p><strong>{selectedInspection?.displayName ?? selected.name}</strong><br /><small>{typeLabel(selected, selectedInspection)} · {selectedInspection?.architecture ?? selected.familyGuess ?? "Architecture unknown"}</small></p><label>Path<input readonly value={selected.path} aria-label="Artifact path" /></label><button class="btn" type="button" on:click={() => copyPath(selected.path)}>Copy path</button>
        <h3>Model metadata</h3>{#if loadingIds.has(selected.id)}<p>Inspecting metadata without interrupting the library…</p>{:else if selectedInspection}<p>Status: {selectedInspection.status}</p><dl><dt>Name</dt><dd>{selectedInspection.displayName ?? "Unknown"}</dd><dt>Architecture</dt><dd>{selectedInspection.architecture ?? "Unknown"}</dd><dt>Size label</dt><dd>{selectedInspection.metadata["general.size_label"] ?? "Unknown"}</dd><dt>Quantization hint</dt><dd>{selected.quantizationGuess ?? "Unknown"}</dd><dt>Trained context</dt><dd>{selectedInspection.trainedContext?.toLocaleString() ?? "Unknown"}</dd><dt>Blocks / layers</dt><dd>{selectedInspection.blockCount ?? "Unknown"}</dd><dt>Embedding size</dt><dd>{selectedInspection.embeddingLength?.toLocaleString() ?? "Unknown"}</dd><dt>MoE</dt><dd>{selectedInspection.isMoE === undefined ? "Unknown" : selectedInspection.isMoE ? "Yes" : "No"}</dd><dt>Experts / active</dt><dd>{selectedInspection.expertCount ?? "Unknown"} / {selectedInspection.expertUsedCount ?? "Unknown"}</dd><dt>Finetune</dt><dd>{selectedInspection.metadata["general.finetune"] ?? "Unknown"}</dd><dt>License</dt><dd>{selectedInspection.metadata["general.license"] ?? "Unknown"}</dd><dt>Source</dt><dd>{selectedInspection.metadata["general.source.huggingface.repository"] ?? "Unknown"}</dd></dl><details><summary>Metadata details ({Object.keys(selectedInspection.metadata).length})</summary>{#each Object.entries(selectedInspection.metadata) as [key, value]}<p><code>{key}</code>: {String(value)}</p>{/each}</details>{:else}<p>Selecting an artifact loads its GGUF metadata.</p>{/if}
        <h3>File details</h3><dl><dt>Discovery root</dt><dd>{selected.folder}</dd><dt>Size</dt><dd>{formatBytes(selected.sizeBytes)}</dd><dt>Modified</dt><dd>{formatDate(selected.modifiedAt)}</dd><dt>GGUF version</dt><dd>{selectedInspection?.version ?? "Unknown"}</dd><dt>Tensor count</dt><dd>{selectedInspection?.tensorCount ?? "Unknown"}</dd><dt>Metadata count</dt><dd>{selectedInspection?.kvCount ?? "Unknown"}</dd></dl>
        <h3>Profile usage</h3>{#if selectedProfiles.length}{#each selectedProfiles as profile}{#if profile}<p><a href={profileHref(profile.id)}>{profile.name}</a>{#if profile.id === activeProfileId} — current managed runtime profile{/if}</p>{/if}{/each}{:else}<p>No saved profile references this artifact.</p>{/if}{#if missingProfileIds.length}<p class="warning">{missingProfileIds.length} referenced profile{missingProfileIds.length === 1 ? " is" : "s are"} missing.</p>{/if}
        <h3>Related artifacts</h3>{#each relatedArtifactCandidates(selected, models, inspections) as related}<button class="related" type="button" on:click={() => selectModel(related.model)}>{related.model.name}<small>{related.reason}</small></button>{:else}<p>No conservative same-folder candidates found.</p>{/each}
        <h3>Warnings</h3>{#each selectedInspection?.warnings ?? [] as warning}<p class="warning">{warning}</p>{:else}<p>None reported.</p>{/each}
        {#if isPrimaryModel(selected, selectedInspection)}<a class="btn primary configure" href={configureHref(selected.id)}>Configure in Profiles</a>{:else if selectedInspection?.status !== "invalid"}<p class="warning">{typeLabel(selected, selectedInspection)} artifacts are not directly configurable.</p>{/if}
      </div>{:else}<p class="empty-state">Select an artifact to inspect metadata and profile usage.</p>{/if}
    </aside>
  </div>
</main>

<style>
  .models-page { --text-muted:var(--color-muted); --surface-raised:var(--color-panel-strong); --text:var(--color-text); --border:var(--color-line); --accent:var(--color-purple); --warning:var(--color-amber); }
  .active-badge { margin-left:.45rem; color:var(--color-green); font-size:.68rem; text-transform:uppercase; letter-spacing:.06em; }
  .models-actions { display:flex; align-items:center; gap:.75rem; margin-bottom:.75rem; min-height:2.25rem; }.models-actions span { color:var(--text-muted); font-size:.85rem; }.discovery-warning { margin-bottom:.75rem; }.discovery-warning p { margin:.4rem 0; }.models-layout { display:grid; grid-template-columns:minmax(0,1fr) 25rem; gap:1rem; align-items:start; }.filters { display:grid; gap:.65rem; margin-bottom:.75rem; }.filters label { display:grid; gap:.25rem; }.tabs { display:flex; flex-wrap:wrap; gap:.25rem; }.tabs button { border:0; background:transparent; color:var(--text-muted); padding:.35rem .5rem; border-radius:.25rem; }.tabs button.active { background:var(--surface-raised); color:var(--text); }.filter-selects { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:.4rem; }.model-table { min-width:0; }.model-head,.model-row { display:grid; grid-template-columns:minmax(12rem,2fr) .8fr 1fr .7fr .75fr .8fr .55fr .85fr; gap:.55rem; align-items:center; }.model-head { color:var(--text-muted); font-size:.72rem; padding:.25rem; text-transform:uppercase; }.model-row { width:100%; text-align:left; border:0; border-top:1px solid var(--border); background:transparent; color:inherit; padding:.65rem .25rem; font:inherit; }.model-row:hover,.model-row.active { background:var(--surface-raised); }.model-row:focus-visible,.tabs button:focus-visible,.related:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }.model-row span { color:var(--text-muted); font-size:.82rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.inspector-body { display:grid; gap:.65rem; }.inspector-body h3 { margin:.5rem 0 0; }.inspector-body p { margin:0; }.inspector-body label { display:grid; gap:.25rem; }.inspector-body input { min-width:0; }.inspector-body dl { display:grid; grid-template-columns:max-content 1fr; gap:.2rem .6rem; margin:0; font-size:.85rem; }.inspector-body dt { color:var(--text-muted); }.inspector-body dd { margin:0; overflow-wrap:anywhere; }.related { display:grid; width:100%; text-align:left; border:0; background:var(--surface-raised); color:inherit; padding:.45rem; }.related small { color:var(--text-muted); }.configure { width:max-content; }.link-button { border:0; background:none; color:var(--accent); padding:0; text-decoration:underline; font:inherit; cursor:pointer; }@media (max-width:1000px){.models-layout{grid-template-columns:1fr}.model-inspector{order:2}}@media (max-width:720px){.filter-selects{grid-template-columns:repeat(2,minmax(0,1fr))}.model-head{display:none}.model-row{grid-template-columns:minmax(0,1fr) auto;gap:.25rem .5rem}.model-row span:nth-of-type(2),.model-row span:nth-of-type(4),.model-row span:nth-of-type(6),.model-row span:nth-of-type(7){display:none}.model-row span{white-space:normal}.models-page{min-width:0;overflow-x:hidden}}@media (max-width:320px){.filter-selects{grid-template-columns:1fr}.models-actions{align-items:flex-start;flex-direction:column}}
</style>
