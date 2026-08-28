<script lang="ts">
  import type { DiscoveredLlamaCppBuild, LlamaBuildCapabilitiesManifest, RuntimeProfile } from "@obsidianlm/shared";
  import { capabilityFamilies, originLabel, routerLabel, versionLabel } from "../build-library";

  export let build: DiscoveredLlamaCppBuild | null = null;
  export let manifest: LlamaBuildCapabilitiesManifest | undefined;
  export let loading = false;
  export let error = "";
  export let profileIds: string[] = [];
  export let profiles: RuntimeProfile[] = [];
  export let activeProfileId: string | null = null;
  export let inspect: (build: DiscoveredLlamaCppBuild) => void;
  export let copyPath: (value: string) => void;
  let flagQuery = "";

  $: usedProfiles = profileIds.map((id) => profiles.find((profile) => profile.id === id)).filter((profile): profile is RuntimeProfile => Boolean(profile));
  $: visibleFlags = (manifest?.flags ?? []).filter((flag) => `${flag.canonicalName} ${flag.aliases.join(" ")} ${flag.description ?? ""} ${flag.environmentAlias ?? ""}`.toLowerCase().includes(flagQuery.toLowerCase().trim()));
  $: families = manifest ? capabilityFamilies(manifest) : [];
  $: evidence = manifest?.router.evidence;
  const toolKinds = ["server", "cli", "bench", "perplexity"] as const;
  const toolLabel = { server: "llama-server", cli: "llama-cli", bench: "llama-bench", perplexity: "llama-perplexity" };
  function evidenceMark(value: boolean | undefined): string { return value === undefined ? "?" : value ? "Detected" : "Missing"; }
</script>

<aside class="panel build-inspector" aria-label="Build inspector" aria-live="polite">
  <div class="panel-head"><h2 class="section-title">Selected build</h2><span class="mini-pill">{build ? loading ? "Inspecting" : manifest?.status ?? "Uninspected" : "Select build"}</span></div>
  {#if build}
    <div class="inspector-body">
      <section><h3>Identity</h3><strong class="build-title">{build.name}</strong><dl><dt>Build ID</dt><dd><code>{build.id}</code></dd><dt>Discovery root</dt><dd>{build.discoveryRoot ?? "Unknown"}</dd><dt>Build root hint</dt><dd>{build.buildRootHint ?? build.folder}</dd><dt>Relative server</dt><dd>{build.relativeServerPath ?? "Unknown"}</dd></dl><label>Server path<input readonly value={build.serverPath} aria-label="Server executable path" /></label><button class="btn" type="button" on:click={() => copyPath(build!.serverPath)}>Copy server path</button></section>

      <section><h3>Version &amp; origin</h3>{#if manifest}<dl><dt>Version</dt><dd>{versionLabel(manifest)}</dd><dt>Build / revision</dt><dd>{manifest.versionInfo?.buildNumber ?? "Unknown"}</dd><dt>Commit</dt><dd>{manifest.versionInfo?.commit ?? "Unknown"}</dd><dt>Compiler</dt><dd>{manifest.versionInfo?.compiler ?? "Unknown"}</dd><dt>Target</dt><dd>{manifest.versionInfo?.target ?? "Unknown"}</dd><dt>Origin hint</dt><dd>{originLabel(manifest)}</dd><dt>Evidence source</dt><dd>{manifest.origin.source.replace("_", " ")}</dd><dt>Last inspected</dt><dd>{new Date(manifest.inspectedAt).toLocaleString()}</dd></dl>{#each manifest.origin.evidence as item}<p>{item}</p>{/each}<details><summary>Version output</summary><pre>{manifest.versionInfo?.raw ?? manifest.versionText ?? "No version output captured."}</pre></details>{:else}<p>Version and provenance have not been inspected.</p>{/if}</section>

      <section><h3>Router readiness</h3>{#if manifest}<p class:ok={manifest.router.status === "candidate"} class:warning={manifest.router.status !== "candidate"}><strong>{routerLabel(manifest)}</strong></p><ul class="evidence"><li><span>{evidenceMark(evidence?.modelsPreset)}</span><code>--models-preset</code></li><li><span>{evidenceMark(evidence?.modelsMax)}</span><code>--models-max</code></li><li><span>{evidenceMark(evidence?.modelsAutoload)}</span><code>--models-autoload / --no-models-autoload</code></li></ul>{#each manifest.router.compatibilityHints as hint}<p>{hint}</p>{/each}<p><strong>Functional router test:</strong> Not run. Phase 15 work.</p>{:else}<p>Unknown until capability inspection.</p>{/if}</section>

      <section><h3>Devices &amp; backends</h3>{#if manifest?.backendHints.length}<div class="pill-row">{#each manifest.backendHints as backend}<span class="mini-pill">{backend}</span>{/each}</div>{/if}{#each manifest?.devices ?? [] as device}<p><code>{device.id}</code> {device.label ?? "No label reported"}</p>{:else}<p>{manifest ? "No devices were reported by this executable." : "Not inspected."}</p>{/each}</section>

      <section><h3>Tools</h3>{#each toolKinds as kind}{@const tool = build.tools.find((item) => item.kind === kind)}<div class="tool-row"><strong>{toolLabel[kind]}</strong><span>{tool ? "Detected" : "Missing"}</span>{#if tool}<code>{tool.path}</code><button type="button" class="copy-link" on:click={() => copyPath(tool!.path)}>Copy path</button>{/if}</div>{/each}</section>

      <section><h3>Profile dependencies</h3>{#if usedProfiles.length}<p>Used by {usedProfiles.length} profile{usedProfiles.length === 1 ? "" : "s"}.</p>{#each usedProfiles as profile}<p><a href={`#profiles?profile=${encodeURIComponent(profile.id)}`}>{profile.name}</a>{#if profile.id === activeProfileId} <span class="active-runtime">Active runtime build</span>{/if}</p>{/each}{:else}<p>No saved profile references this build.</p>{/if}</section>

      <section><h3>Capability summary</h3>{#if manifest}<p>{manifest.flags.length} flags · {manifest.flags.filter((flag) => flag.deprecated).length} deprecated · {manifest.devices.length} devices</p>{#if families.length}<div class="pill-row">{#each families as family}<span class="mini-pill">{family}</span>{/each}</div>{:else}<p>No known capability family was positively detected.</p>{/if}<details><summary>Detected flags ({manifest.flags.length})</summary><label>Search flags<input bind:value={flagQuery} placeholder="Flag or description" /></label><div class="flag-list">{#each visibleFlags as flag}<article><code>{flag.canonicalName}</code>{#if flag.aliases.length}<small>Aliases: {flag.aliases.join(", ")}</small>{/if}{#if flag.valuePlaceholder}<small>Value: {flag.valuePlaceholder}</small>{/if}{#if flag.defaultText}<small>Default: {flag.defaultText}</small>{/if}{#if flag.environmentAlias}<small>Environment: {flag.environmentAlias}</small>{/if}{#if flag.deprecated}<small class="warning">Deprecated</small>{/if}{#if flag.description}<p>{flag.description}</p>{/if}</article>{/each}</div></details>{:else}<p>Inspect this build to summarize detected flags.</p>{/if}</section>

      {#if error}<p class="warning">{error}</p>{/if}
      {#if manifest?.warnings.length}<section><h3>Warnings</h3>{#each manifest.warnings as warning}<p class="warning">{warning.message}</p>{/each}</section>{/if}
      {#if !manifest}<button class="btn primary" disabled={loading} type="button" on:click={() => inspect(build!)}>{loading ? "Inspecting build…" : "Inspect build"}</button>{/if}
      <a class="btn primary" href={`#profiles?build=${encodeURIComponent(build.id)}`}>Use in Profiles</a>
    </div>
  {:else}<p class="empty-state">Select a discovered toolchain to inspect it.</p>{/if}
</aside>

<style>
  .build-inspector { min-width:0; }.inspector-body { padding:0 1rem 1rem; }.inspector-body section { display:grid; gap:.55rem; padding-top:.85rem; border-top:1px solid var(--color-line); }.inspector-body section:first-child { border-top:0; }.build-title { font-size:1rem; }.inspector-body dl { display:grid; grid-template-columns:max-content minmax(0,1fr); gap:.25rem .65rem; margin:0; font-size:.82rem; }.inspector-body dt { color:var(--color-muted); }.inspector-body dd { margin:0; overflow-wrap:anywhere; }.inspector-body label { display:grid; gap:.3rem; color:var(--color-muted); font-size:.78rem; }.inspector-body input { min-width:0; width:100%; }.inspector-body pre { max-height:12rem; margin:.5rem 0 0; padding:.65rem; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; background:rgba(3,8,16,.65); }.pill-row { display:flex; flex-wrap:wrap; gap:.35rem; }.evidence { display:grid; gap:.35rem; padding:0; margin:0; list-style:none; }.evidence li { display:grid; grid-template-columns:4.5rem minmax(0,1fr); gap:.5rem; }.evidence span { color:var(--color-muted); }.tool-row { display:grid; grid-template-columns:7.5rem 4rem minmax(0,1fr) auto; gap:.5rem; align-items:center; font-size:.8rem; }.tool-row code { overflow-wrap:anywhere; }.copy-link { border:0; padding:.2rem; background:transparent; color:var(--color-purple); cursor:pointer; }.active-runtime { color:var(--color-green); font-size:.72rem; text-transform:uppercase; }.flag-list { display:grid; gap:.4rem; margin-top:.5rem; }.flag-list article { display:grid; gap:.2rem; padding:.55rem; background:rgba(4,10,19,.5); }.flag-list small { color:var(--color-muted); }.flag-list p { overflow-wrap:anywhere; }.btn { justify-content:center; text-align:center; }.copy-link:focus-visible,summary:focus-visible { outline:2px solid var(--color-purple); outline-offset:2px; }
  @media (max-width:480px) { .tool-row { grid-template-columns:1fr auto; }.tool-row code { grid-column:1/-1; }.inspector-body dl { grid-template-columns:1fr; }.inspector-body dt { margin-top:.25rem; } }
</style>
