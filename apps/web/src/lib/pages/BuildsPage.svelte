<script lang="ts">
  import { onMount } from "svelte";
  import type { LlamaCppBuildDetails, LlamaCppBuildListResponse, RouterRuntimeResponse } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import { API_ENDPOINTS, fetchJson } from "../api";

  let builds: LlamaCppBuildDetails[] = [], runtime: RouterRuntimeResponse | null = null, selected = "", query = "", message = "";
  const folderName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
  const ready = (build: LlamaCppBuildDetails) => build.tools.some((tool) => tool.kind === "server" && tool.exists);
  $: rows = builds.filter((build) => `${folderName(build.resource.locator)} ${build.resource.locator} ${build.versionInfo?.raw ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  $: build = builds.find((entry) => entry.id === selected) ?? null;
  async function load() { try { const [response, state] = await Promise.allSettled([fetchJson<LlamaCppBuildListResponse>(API_ENDPOINTS.builds.list), fetchJson<RouterRuntimeResponse>(API_ENDPOINTS.runtime.state)]); if (response.status === "fulfilled") builds = response.value.builds; else throw response.reason; runtime = state.status === "fulfilled" ? state.value : null; message = ""; } catch (error) { message = error instanceof Error ? error.message : "Could not load builds."; } }
  onMount(() => void load());
</script>

<main class="page-surface builds-page" aria-label="Builds"><PageHeader title="Builds" subtitle="Auto-synced llama.cpp builds." />
  <div class="actions"><label>Search <input bind:value={query} placeholder="Folder, path, or version" /></label><button class="btn" type="button" on:click={() => void load()}>Refresh</button><span role="status">{message}</span></div>
  <div class="layout"><section class="panel list" aria-label="Build library"><div class="table" role="table"><div class="head" role="row"><span>Folder</span><span>Status</span><span>Version</span><span>Active</span></div>{#each rows as item}<button class:active={selected === item.id} class:missing={!ready(item)} class="row" type="button" role="row" on:click={() => selected = item.id}><strong>{folderName(item.resource.locator)}</strong><span>{ready(item) ? "Ready" : "llama-server.exe not found (possibly broken build)"}</span><span>{item.versionInfo?.raw ?? "Unknown"}</span><span>{runtime?.routerState.activeBuildId === item.id ? "Yes" : "No"}</span></button>{:else}<p class="empty-state">No builds match this search.</p>{/each}</div></section><aside class="panel inspector">{#if build}<h2 class:missing-text={!ready(build)} class="section-title">{folderName(build.resource.locator)}</h2><dl><dt>Status</dt><dd class:missing-text={!ready(build)}>{ready(build) ? "Ready" : "llama-server.exe not found (possibly broken build)"}</dd><dt>Eligibility</dt><dd>{build.managedInferenceEligibility}</dd><dt>Models</dt><dd>{build.configuredModelIds.length}</dd></dl>{#if !ready(build)}<p class="missing-text">The configured Build resource is missing. Existing profiles were retained.</p>{/if}{:else}<p class="empty-state">Select a Build to inspect.</p>{/if}</aside></div>
</main>

<style>.actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:end;margin-bottom:.75rem}.actions label{display:grid;gap:.2rem;font-size:.82rem}.actions span{color:var(--color-muted)}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(17rem,27rem);gap:1rem}.list{overflow:auto}.table{min-width:40rem}.head,.row{display:grid;grid-template-columns:1.4fr 1fr 1.4fr .5fr;gap:.6rem;align-items:center;padding:.65rem .75rem}.head{font-size:.75rem;color:var(--color-muted);border-bottom:1px solid var(--color-line)}.row{width:100%;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--color-line)}.row:hover,.row.active{background:var(--color-panel-strong)}.missing,.missing-text{color:var(--color-red)}.inspector{padding:1rem}dl{display:grid;grid-template-columns:6rem minmax(0,1fr);gap:.4rem .6rem}dt{color:var(--color-muted)}dd{margin:0;overflow-wrap:anywhere}@media(max-width:760px){.layout{grid-template-columns:1fr}.builds-page{min-width:0;overflow-x:hidden}}</style>
