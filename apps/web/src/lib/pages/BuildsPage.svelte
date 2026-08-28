<script lang="ts">
  import { onMount } from "svelte";
  import type { DiscoveredLlamaCppBuild, RuntimeProfile } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import BuildInspector from "../components/BuildInspector.svelte";
  import { matchesBuild, originLabel, routerLabel, sortBuilds, versionLabel, type BuildSort } from "../build-library";
  import { API_ENDPOINTS, fetchJson, type LlamaBuildCapabilitiesManifest, type LlamaBuildDiscoveryResponse, type LlamaBuildUsageResponse, type ProfileListResponse, type RuntimeState } from "../api";

  type RuntimeStateResponse = { state: RuntimeState; warnings: string[] };
  let builds: DiscoveredLlamaCppBuild[] = [];
  let profiles: RuntimeProfile[] = [];
  let usage = new Map<string, string[]>();
  let missingProfileIds: string[] = [];
  let manifests = new Map<string, LlamaBuildCapabilitiesManifest>();
  let loadingIds = new Set<string>();
  let inspectionErrors = new Map<string, string>();
  let warnings: string[] = [];
  let scannedFolders: string[] = [];
  let activeProfileId: string | null = null;
  let selectedId: string | null = null;
  let query = "";
  let origin: "all" | "official" | "custom" | "unknown" = "all";
  let router: "all" | "candidate" | "unsupported" | "partial" | "unknown" = "all";
  let backend = "all";
  let usageFilter: "all" | "used" | "unused" = "all";
  let sort: BuildSort = "name";
  let loading = true;
  let message = "";
  let request = 0;

  $: filtered = sortBuilds(builds.filter((build) => {
    const manifest = manifests.get(build.id);
    return matchesBuild(build, manifest, query)
      && (origin === "all" || (manifest?.origin.classification ?? "unknown") === origin)
      && (router === "all" || (manifest?.router.status ?? "unknown") === router)
      && (backend === "all" || manifest?.backendHints.includes(backend))
      && (usageFilter === "all" || (usageFilter === "used") === Boolean(usage.get(build.id)?.length));
  }), manifests, usage, sort);
  $: selected = builds.find((build) => build.id === selectedId) ?? null;
  $: backends = [...new Set([...manifests.values()].flatMap((manifest) => manifest.backendHints))].sort();

  async function load(rescan = false) {
    loading = true;
    const current = ++request;
    try {
      if (rescan) { await fetchJson(API_ENDPOINTS.discovery.rescanLlamaBuilds, { method: "POST" }); manifests = new Map(); inspectionErrors = new Map(); }
      const [discovery, profileResponse, usageResponse, runtimeResponse] = await Promise.all([
        fetchJson<LlamaBuildDiscoveryResponse>(API_ENDPOINTS.discovery.llamaBuilds), fetchJson<ProfileListResponse>(API_ENDPOINTS.profiles.list),
        fetchJson<LlamaBuildUsageResponse>(API_ENDPOINTS.discovery.llamaBuildUsage), fetchJson<RuntimeStateResponse>(API_ENDPOINTS.runtime.state)
      ]);
      if (current !== request) return;
      builds = discovery.builds; profiles = profileResponse.profiles; warnings = discovery.warnings.map((warning) => warning.message); scannedFolders = discovery.scannedFolders;
      usage = new Map(usageResponse.usage.map((entry) => [entry.buildId, entry.profileIds])); missingProfileIds = usageResponse.missingProfileIds; activeProfileId = runtimeResponse.state.activeProfileId;
      if (selectedId && !builds.some((build) => build.id === selectedId)) selectedId = null;
      message = rescan ? "Build discovery rescanned." : "";
    } catch (error) { if (current === request) message = error instanceof Error ? error.message : "Could not load the build library"; }
    finally { if (current === request) loading = false; }
  }

  async function inspectBuild(build: DiscoveredLlamaCppBuild) {
    selectedId = build.id;
    if (manifests.has(build.id) || loadingIds.has(build.id)) return;
    loadingIds = new Set(loadingIds).add(build.id); inspectionErrors = new Map(inspectionErrors); inspectionErrors.delete(build.id);
    try {
      const manifest = await fetchJson<LlamaBuildCapabilitiesManifest>(API_ENDPOINTS.discovery.llamaBuildCapabilities(build.id));
      if (builds.some((item) => item.id === build.id)) manifests = new Map(manifests).set(build.id, manifest);
    } catch (error) { inspectionErrors = new Map(inspectionErrors).set(build.id, error instanceof Error ? error.message : "Build inspection failed. Rescan if the executable moved."); }
    finally { loadingIds = new Set(loadingIds); loadingIds.delete(build.id); loadingIds = new Set(loadingIds); }
  }

  function clearFilters() { query = ""; origin = router = "all"; backend = "all"; usageFilter = "all"; }
  async function copyPath(value: string) { try { await navigator.clipboard.writeText(value); message = "Path copied."; } catch { message = "Select and copy the path manually."; } }
  function toolsLabel(build: DiscoveredLlamaCppBuild): string { return ["server", "cli", "bench", "perplexity"].map((kind) => `${kind === "perplexity" ? "PPL" : kind[0].toUpperCase() + kind.slice(1)} ${build.tools.some((tool) => tool.kind === kind) ? "✓" : "—"}`).join(" · "); }
  onMount(() => { void load(); });
</script>

<main class="page-surface builds-page" aria-label="Builds">
  <PageHeader title="Builds" subtitle="Browse and inspect llama.cpp toolchains discovered on this machine." />
  <div class="build-actions"><button class="btn primary" type="button" on:click={() => load(true)} disabled={loading}>Rescan builds</button><span role="status" aria-live="polite">{message}</span></div>
  {#if warnings.length}<details class="discovery-warning"><summary>{warnings.length} discovery warning{warnings.length === 1 ? "" : "s"}</summary>{#each warnings as warning}<p>{warning}</p>{/each}</details>{/if}
  {#if missingProfileIds.length}<p class="warning missing">{missingProfileIds.length} profile{missingProfileIds.length === 1 ? " references a" : "s reference"} build{missingProfileIds.length === 1 ? "" : "s"} that {missingProfileIds.length === 1 ? "is" : "are"} currently missing. Profiles were not changed.</p>{/if}
  <div class="builds-layout">
    <section class="panel build-library" aria-label="llama.cpp build library">
      <div class="panel-head"><h2 class="section-title">Toolchain library</h2><span class="mini-pill">{filtered.length} of {builds.length}</span></div>
      <div class="filters"><label>Search<input bind:value={query} placeholder="Name, path, version, tool, device" /></label><div class="filter-selects"><label>Origin<select bind:value={origin}><option value="all">All origins</option><option value="official">Official hint</option><option value="custom">Custom hint</option><option value="unknown">Unknown</option></select></label><label>Router<select bind:value={router}><option value="all">All router states</option><option value="candidate">Candidate</option><option value="unsupported">Legacy candidate</option><option value="partial">Partial</option><option value="unknown">Unknown</option></select></label><label>Backend<select bind:value={backend}><option value="all">All backends</option>{#each backends as value}<option>{value}</option>{/each}</select></label><label>Usage<select bind:value={usageFilter}><option value="all">Used and unused</option><option value="used">Used by profiles</option><option value="unused">Unused</option></select></label><label>Sort<select bind:value={sort}><option value="name">Name</option><option value="version">Version / build</option><option value="inspected">Last inspected</option><option value="usage">Profile usage</option></select></label></div></div>
      {#if loading}<p class="empty-state" role="status">Loading discovered builds…</p>{:else if !scannedFolders.length}<p class="empty-state">No llama.cpp folders are configured. <a href="#settings">Open Settings</a> to add one, then rescan.</p>{:else if !builds.length}<p class="empty-state">No llama-server executables were found within the bounded configured roots.</p>{:else if !filtered.length}<p class="empty-state">No builds match these filters. <button class="link-button" type="button" on:click={clearFilters}>Clear filters</button>.</p>{:else}<div class="build-table"><div class="build-head" aria-hidden="true"><span>Name</span><span>Origin</span><span>Version</span><span>Backends / devices</span><span>Tools</span><span>Profiles</span><span>Router</span><span>Inspected</span></div>{#each filtered as build}{@const manifest = manifests.get(build.id)}<button class:active={build.id === selectedId} class="build-row" type="button" aria-label={`Inspect ${build.name}`} on:click={() => inspectBuild(build)}><strong>{build.name}{#if activeProfileId && (usage.get(build.id) ?? []).includes(activeProfileId)}<b>Active</b>{/if}</strong><span>{originLabel(manifest)}</span><span>{versionLabel(manifest)}</span><span>{manifest?.backendHints.join(", ") || (manifest ? `${manifest.devices.length} device${manifest.devices.length === 1 ? "" : "s"}` : "—")}</span><span title={toolsLabel(build)}>{toolsLabel(build)}</span><span>{usage.get(build.id)?.length ?? 0}</span><span>{routerLabel(manifest)}</span><span>{manifest ? new Date(manifest.inspectedAt).toLocaleDateString() : "No"}</span></button>{/each}</div>{/if}
    </section>
    <BuildInspector build={selected} manifest={selected ? manifests.get(selected.id) : undefined} loading={selected ? loadingIds.has(selected.id) : false} error={selected ? inspectionErrors.get(selected.id) ?? "" : ""} profileIds={selected ? usage.get(selected.id) ?? [] : []} {profiles} {activeProfileId} inspect={inspectBuild} {copyPath} />
  </div>
</main>

<style>
  .builds-page { --accent:var(--color-purple); }.build-actions { display:flex; align-items:center; gap:.75rem; min-height:2.25rem; margin-bottom:.75rem; }.build-actions span { color:var(--color-muted); font-size:.82rem; }.discovery-warning,.missing { margin-bottom:.75rem; }.discovery-warning p { margin:.4rem 0; }.builds-layout { display:grid; grid-template-columns:minmax(0,1fr) 27rem; gap:1rem; align-items:start; }.filters { display:grid; gap:.65rem; padding:1rem; }.filters label { display:grid; gap:.25rem; color:var(--color-muted); font-size:.76rem; }.filters input,.filters select { min-width:0; width:100%; }.filter-selects { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:.45rem; }.build-table { min-width:0; padding:0 1rem 1rem; }.build-head,.build-row { display:grid; grid-template-columns:minmax(9rem,1.45fr) .8fr .75fr 1fr 1.35fr .5fr .85fr .7fr; gap:.5rem; align-items:center; }.build-head { padding:.25rem; color:var(--color-muted); font-size:.67rem; text-transform:uppercase; }.build-row { width:100%; padding:.65rem .25rem; border:0; border-top:1px solid var(--color-line); background:transparent; color:inherit; text-align:left; font:inherit; }.build-row:hover,.build-row.active { background:var(--color-panel-strong); }.build-row:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }.build-row strong,.build-row span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.build-row strong { font-size:.83rem; }.build-row strong b { margin-left:.35rem; color:var(--color-green); font-size:.65rem; text-transform:uppercase; }.build-row span { color:var(--color-muted); font-size:.72rem; }
  @media (max-width:1180px) { .builds-layout { grid-template-columns:1fr; }.filter-selects { grid-template-columns:repeat(3,minmax(0,1fr)); } }
  @media (max-width:760px) { .filter-selects { grid-template-columns:repeat(2,minmax(0,1fr)); }.build-head { display:none; }.build-row { grid-template-columns:1fr 1fr; gap:.35rem .6rem; padding:.75rem .35rem; }.build-row strong { grid-column:1/-1; font-size:.9rem; }.build-row span { overflow-wrap:anywhere; white-space:normal; }.build-row span:nth-of-type(4),.build-row span:nth-of-type(5) { display:none; } }
  @media (max-width:390px) { .builds-layout { gap:.65rem; }.filter-selects { grid-template-columns:1fr; }.filters,.build-table { padding-left:.75rem; padding-right:.75rem; }.build-actions { align-items:flex-start; flex-direction:column; }.build-row { grid-template-columns:1fr; }.build-row strong { grid-column:auto; } }
</style>
