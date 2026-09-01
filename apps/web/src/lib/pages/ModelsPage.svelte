<script lang="ts">
  import { onMount } from "svelte";
  import type { ModelArtifactListItem, ModelArtifactListResponse } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import { API_ENDPOINTS, fetchJson } from "../api";

  type ArtifactAuthority = ModelArtifactListItem & { vision: { capability: "yes" | "no" | "unknown"; module: "installed" | "not_found" | "not_required" | "unknown" }; role: "base" | "projector" | "conflict" | "unassigned"; selectionStatus: "available" | "invalid" };
  let artifacts: ArtifactAuthority[] = [], selected = "", query = "", message = "";
  const supportName = (artifact: ArtifactAuthority) => /(?:mmproj|projector|adapter|lora|imatrix)/i.test(artifact.resource.locator);
  const primary = (artifact: ArtifactAuthority) => artifact.role !== "conflict" && (artifact.kind === "model" || (artifact.kind === "unknown" && !supportName(artifact)));
  const name = (artifact: ArtifactAuthority) => (artifact.metadata?.displayName ?? artifact.resource.locator.split(/[\\/]/).pop() ?? artifact.id).replace(/\.gguf$/i, "");
  const visionCapable = (artifact: ArtifactAuthority) => ({ yes: "Yes", no: "No", unknown: "Unknown" }[artifact.vision.capability]);
  const visionModule = (artifact: ArtifactAuthority) => ({ installed: "Installed", not_found: "Not found", not_required: "Not required", unknown: "Unknown" }[artifact.vision.module]);
  $: rows = artifacts.filter(primary).filter((artifact) => `${name(artifact)} ${artifact.resource.locator}`.toLowerCase().includes(query.toLowerCase()));
  $: current = rows.find((artifact) => artifact.id === selected) ?? null;
  async function load() {
    try {
      const artifactResponse = await fetchJson<ModelArtifactListResponse>(API_ENDPOINTS.modelArtifacts.list);
      artifacts = artifactResponse.artifacts as ArtifactAuthority[];
      message = "";
    } catch (error) { message = error instanceof Error ? error.message : "Could not load model library."; }
  }
  onMount(() => void load());
</script>

<main class="page-surface models-page" aria-label="Models">
  <PageHeader title="Models" subtitle="Auto-synced primary GGUF models." />
  <div class="actions"><label>Search <input bind:value={query} placeholder="Name or path" /></label><button class="btn" type="button" on:click={() => void load()}>Refresh</button><span role="status">{message}</span></div>
   <div class="layout"><section class="panel list" aria-label="Primary models"><div class="table" role="table"><div class="head" role="row"><span>Name</span><span>Vision capable</span><span>Vision module</span></div>{#each rows as artifact}<button class:active={selected === artifact.id} class="row" type="button" role="row" on:click={() => selected = artifact.id}><strong>{name(artifact)}</strong><span>{visionCapable(artifact)}</span><span>{visionModule(artifact)}</span></button>{:else}<p class="empty-state">No primary models match this search.</p>{/each}</div></section><aside class="panel inspector">{#if current}<h2 class="section-title">{name(current)}</h2><dl><dt>Availability</dt><dd>{current.referenceStatus}</dd><dt>Type</dt><dd>{visionCapable(current) === "Yes" ? "Vision" : visionCapable(current) === "No" ? "Text" : "Unknown"}</dd><dt>Vision capable</dt><dd>{visionCapable(current)}</dd><dt>Vision module</dt><dd>{visionModule(current)}</dd></dl>{#if current.metadata}<section><h3>Metadata</h3><p>{current.metadata.architecture ?? "Unknown architecture"} · {current.metadata.status}</p>{#each current.metadata.warnings as warning}<p class="warning">{warning}</p>{/each}</section>{/if}<a class="btn primary" href={`#/profiles?artifact=${current.id}`}>Configure model</a>{:else}<p class="empty-state">Select a model to inspect.</p>{/if}</aside></div>
</main>

<style>.actions{display:flex;flex-wrap:wrap;gap:.5rem;align-items:end;margin-bottom:.75rem}.actions label{display:grid;gap:.2rem;font-size:.82rem}.actions span{color:var(--color-muted)}.layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(17rem,27rem);gap:1rem}.list{overflow:auto}.table{min-width:34rem}.head,.row{display:grid;grid-template-columns:1.6fr .8fr 1fr;gap:.6rem;align-items:center;padding:.65rem .75rem}.head{font-size:.75rem;color:var(--color-muted);border-bottom:1px solid var(--color-line)}.row{width:100%;text-align:left;color:inherit;background:transparent;border:0;border-bottom:1px solid var(--color-line)}.row:hover,.row.active{background:var(--color-panel-strong)}.inspector{padding:1rem}.inspector section{border-top:1px solid var(--color-line);margin-top:.75rem;padding-top:.5rem}.inspector .btn{margin-top:.75rem}dl{display:grid;grid-template-columns:6rem minmax(0,1fr);gap:.4rem .6rem}dt{color:var(--color-muted)}dd{margin:0;overflow-wrap:anywhere}.warning{color:var(--color-warning)}@media(max-width:760px){.layout{grid-template-columns:1fr}.models-page{min-width:0;overflow-x:hidden}}</style>
