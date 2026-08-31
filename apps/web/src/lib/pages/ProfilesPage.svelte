<script lang="ts">
  import { onMount } from "svelte";
  import type {
    ConfiguredModelDetails,
    ConfiguredModelListResponse,
    LlamaBuildCapabilitiesManifest,
    LlamaBuildFlagCapability,
    LlamaCppBuildDetails,
    LlamaCppBuildListResponse,
    LlamaCppFlagOverride,
    ModelArtifactListItem,
    ModelArtifactListResponse,
    RouterLaunchPreview,
    RouterPresetPreview,
    RouterRuntimeResponse
  } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import ConfiguredModelRuntimeAction from "../components/ConfiguredModelRuntimeAction.svelte";
  import { API_ENDPOINTS, fetchJson } from "../api";
  import { capabilityFor, curatedFields, genericFlags, type CuratedField } from "../profiles/registry";

  type ArgValue = string | number | boolean | string[] | undefined;
  type Draft = {
    displayName: string;
    routerAlias: string;
    artifactId: string;
    buildId: string;
    enabled: boolean;
    projectorId: string;
    extraArgs: string;
    llamaArgs: Record<string, ArgValue>;
    flagOverrides: LlamaCppFlagOverride[];
  };
  type Change = { label: string; before: string; after: string };
  type DraftPreview = { preset: RouterPresetPreview; launch: RouterLaunchPreview };

  const blank = (): Draft => ({ displayName: "", routerAlias: "", artifactId: "", buildId: "", enabled: true, projectorId: "", extraArgs: "", llamaArgs: {}, flagOverrides: [] });
  const groups: Array<{ title: string; description: string; keys: string[] }> = [
    { title: "Context & generation", description: "Context window and attention behavior.", keys: ["ctxSize", "flashAttention"] },
    { title: "Batching & parallelism", description: "Prompt batching and concurrent slots.", keys: ["batchSize", "ubatchSize", "parallel", "contBatching"] },
    { title: "GPU & offload", description: "Layer placement and device distribution.", keys: ["gpuLayers", "devices", "splitMode", "tensorSplit"] },
    { title: "KV cache", description: "Key and value cache precision.", keys: ["cacheTypeK", "cacheTypeV"] },
    { title: "System & performance", description: "CPU execution controls.", keys: ["threads", "threadsBatch"] }
  ];

  let models: ConfiguredModelDetails[] = [];
  let artifacts: ModelArtifactListItem[] = [];
  let builds: LlamaCppBuildDetails[] = [];
  let runtime: RouterRuntimeResponse | null = null;
  let selected: ConfiguredModelDetails | null = null;
  let draft = blank();
  let manifest: LlamaBuildCapabilitiesManifest | null = null;
  let preview: DraftPreview | null = null;
  let previewError = "";
  let previewBusy = false;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let capabilityRequest = 0;
  let previewRequest = 0;
  let search = "";
  let flagSearch = "";
  let message = "";
  let missingLink = "";
  let loading = true;
  let mounted = false;
  let previewView: "preset" | "launch" = "preset";
  let copyLabel = "Copy";
  let legacyImport: HTMLInputElement;
  let dirty = false;
  let changes: Change[] = [];
  let previewSignature = "";
  let impact: Array<[string, string]> = [];

  const supportArtifact = (artifact: ModelArtifactListItem) => /(?:mmproj|projector|adapter|lora|imatrix)/i.test(artifact.resource.locator);
  const buildName = (build: LlamaCppBuildDetails) => build.displayName;
  const buildLabel = (build: LlamaCppBuildDetails) => builds.filter((item) => buildName(item) === buildName(build)).length > 1 ? `${buildName(build)} · ${build.resource.locator.replace(/[\\/]+$/, "").split(/[\\/]/).slice(-2, -1)[0] ?? build.resource.locator}` : buildName(build);
  const artifactName = (artifact: ModelArtifactListItem) => artifact.metadata?.displayName ?? artifact.resource.locator.split(/[\\/]/).pop()?.replace(/\.gguf$/i, "") ?? artifact.id;
  $: primaryArtifacts = artifacts.filter((artifact) => artifact.referenceStatus === "available" && (artifact.kind === "model" || (artifact.kind === "unknown" && !supportArtifact(artifact))));
  $: projectors = artifacts.filter((artifact) => artifact.referenceStatus === "available" && artifact.kind === "mmproj");
  $: availableBuilds = builds.filter((build) => build.tools.some((tool) => tool.kind === "server" && tool.exists));
  $: selectedArtifact = artifacts.find((artifact) => artifact.id === draft.artifactId);
  $: selectedBuild = builds.find((build) => build.id === draft.buildId);
  $: selectedProjector = artifacts.find((artifact) => artifact.id === draft.projectorId);
  $: filteredModels = models.filter((model) => `${model.displayName} ${model.routerAlias} ${model.artifact?.resource.locator ?? ""} ${model.build?.displayName ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  $: capabilityFlags = manifest?.flags ?? [];
  $: supportedCurated = curatedFields.filter((field) => field.section !== "SERVER" && !!capabilityFor(field, capabilityFlags));
  $: buildSpecificFlags = genericFlags(capabilityFlags).filter((flag) => !/^--(?:host|port)$/u.test(flag.canonicalName));
  $: visibleBuildFlags = buildSpecificFlags.filter((flag) => `${flag.canonicalName} ${flag.description ?? ""}`.toLowerCase().includes(flagSearch.toLowerCase()));
  $: unsupportedSavedArgs = curatedFields.filter((field) => field.section !== "SERVER" && draft.llamaArgs[field.key] !== undefined && !capabilityFor(field, capabilityFlags));
  $: unknownSavedOverrides = draft.flagOverrides.filter((override) => !capabilityFlags.some((flag) => [flag.canonicalName, ...flag.aliases].includes(override.flag)));
  $: selectedRouterState = selected ? runtime?.routerState.configuredModelStates.find((entry) => entry.configuredModelId === selected?.id)?.state : undefined;
  $: sameRunningBuild = Boolean(runtime?.routerState.activeBuildId && runtime.routerState.activeBuildId === draft.buildId);
  $: presetReconciliationPending = Boolean(sameRunningBuild && (previewBusy || !runtime?.routerState.generatedArtifact?.sourceRevision || !preview?.preset.artifact.sourceRevision));
  $: presetRestartRequired = Boolean(sameRunningBuild && !presetReconciliationPending && runtime?.routerState.generatedArtifact?.sourceRevision !== preview?.preset.artifact.sourceRevision);
  $: {
    void draft;
    dirty = selected ? JSON.stringify(payload()) !== JSON.stringify(savedPayload(selected)) : Boolean(draft.displayName || draft.artifactId || draft.buildId || Object.values(draft.llamaArgs).some((value) => value !== undefined));
  }
  $: {
    void draft; void selected; void artifacts; void builds;
    changes = changeSummary();
  }
  $: editorReady = Boolean(draft.artifactId && draft.buildId && manifest);
  $: {
    void draft;
    previewSignature = JSON.stringify({ draft: payload(), existingId: selected?.id });
  }
  $: {
    void draft; void runtime; void selectedRouterState; void builds; void selectedBuild; void presetReconciliationPending; void presetRestartRequired;
    impact = launchImpact();
  }
  $: if (mounted && editorReady) schedulePreview(previewSignature);

  function alias(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "model";
  }

  function payload() {
    return {
      displayName: draft.displayName,
      routerAlias: draft.routerAlias || alias(draft.displayName),
      artifactId: draft.artifactId,
      buildId: draft.buildId,
      enabled: draft.enabled,
      llamaArgs: Object.fromEntries(Object.entries(draft.llamaArgs).filter(([, value]) => value !== undefined && value !== "")),
      flagOverrides: draft.flagOverrides,
      extraArgs: draft.extraArgs.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      ...(draft.projectorId ? { projector: { artifactId: draft.projectorId, selection: "explicit" as const, validationStatus: "not_validated" as const } } : selected ? { projector: null } : {}),
      projectorCandidates: selected?.projectorCandidates ?? []
    };
  }

  function savedPayload(model: ConfiguredModelDetails) {
    return {
      displayName: model.displayName,
      routerAlias: model.routerAlias,
      artifactId: model.artifactId,
      buildId: model.buildId,
      enabled: model.enabled,
      llamaArgs: model.llamaArgs ?? {},
      flagOverrides: model.flagOverrides ?? [],
      extraArgs: model.extraArgs ?? [],
      projector: model.projectorAssociation ?? null,
      projectorCandidates: model.projectorCandidates ?? []
    };
  }

  async function load() {
    loading = true;
    try {
      const [modelResponse, artifactResponse, buildResponse] = await Promise.all([
        fetchJson<ConfiguredModelListResponse>(API_ENDPOINTS.configuredModels.list),
        fetchJson<ModelArtifactListResponse>(API_ENDPOINTS.modelArtifacts.list),
        fetchJson<LlamaCppBuildListResponse>(API_ENDPOINTS.builds.list)
      ]);
      models = modelResponse.configuredModels;
      artifacts = artifactResponse.artifacts;
      builds = buildResponse.builds;
      runtime = await fetchJson<RouterRuntimeResponse>(API_ENDPOINTS.runtime.state).catch(() => null);
      resolveLink();
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not load configured models.";
    } finally {
      loading = false;
    }
  }

  function resolveLink() {
    const parameters = new URLSearchParams(location.hash.split("?")[1] ?? "");
    const id = parameters.get("configuredModel") ?? parameters.get("profile");
    const artifact = parameters.get("artifact") ?? parameters.get("model");
    const build = parameters.get("build");
    const found = models.find((model) => model.id === id || model.compatibilityProfileIds?.includes(id ?? ""));
    missingLink = "";
    if (found) void select(found);
    else if (artifact || build) {
      newModel();
      draft.artifactId = artifacts.find((entry) => entry.id === artifact || entry.discoveryId === artifact)?.id ?? "";
      draft.buildId = builds.find((entry) => entry.id === build || entry.discoveryId === build)?.id ?? "";
      if (draft.artifactId) deriveName();
      if (draft.buildId) void capabilities(draft.buildId);
      if ((artifact && !draft.artifactId) || (build && !draft.buildId)) missingLink = "Requested legacy selection is missing; choose an available discovered replacement.";
    } else if (id) missingLink = "Requested configured model is missing.";
    else if (models[0]) void select(models[0]);
  }

  async function select(model: ConfiguredModelDetails) {
    selected = model;
    draft = {
      displayName: model.displayName,
      routerAlias: model.routerAlias,
      artifactId: model.artifactId,
      buildId: model.buildId,
      enabled: model.enabled,
      projectorId: model.projectorAssociation?.artifactId ?? "",
      extraArgs: (model.extraArgs ?? []).join("\n"),
      llamaArgs: { ...(model.llamaArgs ?? {}) },
      flagOverrides: structuredClone(model.flagOverrides ?? [])
    };
    preview = null;
    previewError = "";
    await capabilities(model.buildId);
  }

  async function capabilities(id: string) {
    const request = ++capabilityRequest;
    manifest = null;
    preview = null;
    previewError = "";
    if (!id) return;
    try {
      const next = await fetchJson<LlamaBuildCapabilitiesManifest>(API_ENDPOINTS.builds.capabilities(id));
      if (request === capabilityRequest && draft.buildId === id) manifest = next;
    } catch {
      if (request === capabilityRequest && draft.buildId === id) message = "Build capability inspection unavailable; preserved settings remain unchanged.";
    }
  }

  function newModel() {
    selected = null;
    draft = blank();
    manifest = null;
    preview = null;
    previewError = "";
    message = "";
  }

  function deriveName() {
    if (selected || draft.displayName) return;
    const artifact = artifacts.find((entry) => entry.id === draft.artifactId);
    const locator = artifact?.metadata?.displayName ?? artifact?.resource.locator.split(/[\\/]/).pop()?.replace(/\.gguf$/i, "") ?? "";
    draft.displayName = locator;
    draft.routerAlias = alias(locator);
  }

  async function save() {
    try {
      const response = selected
        ? await fetchJson<{ model: ConfiguredModelDetails }>(API_ENDPOINTS.configuredModels.update(selected.id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) })
        : await fetchJson<{ model: ConfiguredModelDetails }>(API_ENDPOINTS.configuredModels.create, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      await load();
      await select(models.find((model) => model.id === response.model.id) ?? response.model);
      message = "Configured model saved.";
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not save configured model.";
    }
  }

  async function act(kind: "duplicate" | "delete") {
    if (!selected || (kind === "delete" && !confirm(`Delete ${selected.displayName}?`))) return;
    try {
      if (kind === "delete") {
        await fetchJson(API_ENDPOINTS.configuredModels.delete(selected.id), { method: "DELETE" });
        newModel();
      } else {
        const result = await fetchJson<{ model: ConfiguredModelDetails }>(API_ENDPOINTS.configuredModels.duplicate(selected.id), { method: "POST" });
        await select(result.model);
      }
      await load();
    } catch (error) {
      message = error instanceof Error ? error.message : `Could not ${kind} configured model.`;
    }
  }

  async function importLegacy(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      await fetchJson(API_ENDPOINTS.profiles.import, { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() });
      message = "Legacy profiles imported; review the resulting compatibility bindings.";
      await load();
    } catch (error) {
      message = error instanceof Error ? error.message : "Legacy profile import failed.";
    }
  }

  function schedulePreview(_signature: string) {
    clearTimeout(previewTimer);
    preview = null;
    previewBusy = true;
    previewTimer = setTimeout(() => void runValidation(), 250);
  }

  async function runValidation() {
    if (!draft.artifactId || !draft.buildId) return;
    const request = ++previewRequest;
    previewBusy = true;
    previewError = "";
    try {
      const result = await fetchJson<DraftPreview>(API_ENDPOINTS.configuredModels.preview, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: payload(), ...(selected ? { existingId: selected.id } : {}) })
      });
      if (request === previewRequest) preview = result;
    } catch (error) {
      if (request === previewRequest) {
        preview = null;
        previewError = error instanceof Error ? error.message : "Draft preview unavailable.";
      }
    } finally {
      if (request === previewRequest) previewBusy = false;
    }
  }

  function updateArg(field: CuratedField, raw: string) {
    let value: ArgValue = raw;
    if (!raw) value = undefined;
    else if (field.kind === "boolean") value = raw === "true";
    else if (field.key === "devices") value = raw.split(",").map((item) => item.trim()).filter(Boolean);
    else if (["ctxSize", "gpuLayers", "batchSize", "ubatchSize", "parallel", "threads", "threadsBatch"].includes(field.key)) value = raw === "all" ? raw : Number(raw);
    draft.llamaArgs = { ...draft.llamaArgs, [field.key]: value };
  }

  function fieldValue(field: CuratedField): string {
    const value = draft.llamaArgs[field.key];
    return Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value);
  }

  function flagValue(flag: LlamaBuildFlagCapability): string {
    const value = draft.flagOverrides.find((item) => item.flag === flag.canonicalName);
    return value?.values?.join(" ") ?? (value ? "true" : "");
  }

  function setFlag(flag: LlamaBuildFlagCapability, value: string) {
    draft.flagOverrides = [...draft.flagOverrides.filter((item) => item.flag !== flag.canonicalName), ...(value ? [{ flag: flag.canonicalName, ...(flag.valuePlaceholder ? { values: [value] } : {}) }] : [])];
  }

  function modelState(model: ConfiguredModelDetails): string {
    if (!model.enabled) return "Disabled";
    if (model.validation.status === "invalid") return "Invalid";
    if (model.validation.references.artifact !== "available") return "Missing model";
    if (model.validation.references.build !== "available") return "Missing Build";
    const state = runtime?.routerState.configuredModelStates.find((entry) => entry.configuredModelId === model.id)?.state;
    return state ? state[0]!.toUpperCase() + state.slice(1) : "Available";
  }

  function formatContext(value: unknown): string {
    if (typeof value !== "number") return "Inherited context";
    return value >= 1024 && value % 1024 === 0 ? `${value / 1024}K context` : `${value.toLocaleString()} context`;
  }

  function displayValue(value: unknown, empty = "Inherited"): string {
    if (value === undefined || value === null || value === "") return empty;
    if (Array.isArray(value)) return value.length ? value.join(" ") : empty;
    if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
    return String(value);
  }

  function changeSummary(): Change[] {
    if (!selected) return dirty ? [{ label: "Profile", before: "Not saved", after: "New draft" }] : [];
    const result: Change[] = [];
    const compare = (label: string, before: unknown, after: unknown, empty = "Inherited") => { if (JSON.stringify(before) !== JSON.stringify(after)) result.push({ label, before: displayValue(before, empty), after: displayValue(after, empty) }); };
    compare("Display name", selected.displayName, draft.displayName);
    compare("Router alias", selected.routerAlias, draft.routerAlias);
    compare("Model", selected.artifact?.metadata?.displayName ?? selected.artifactId, selectedArtifact?.metadata?.displayName ?? draft.artifactId, "None");
    compare("Build", selected.build?.displayName ?? selected.buildId, selectedBuild?.displayName ?? draft.buildId, "None");
    compare("Projector", selected.projector?.metadata?.displayName ?? selected.projectorAssociation?.artifactId, selectedProjector?.metadata?.displayName ?? draft.projectorId, "None");
    compare("Enabled", selected.enabled, draft.enabled);
    for (const field of curatedFields.filter((entry) => entry.section !== "SERVER")) compare(field.label, selected.llamaArgs?.[field.key], draft.llamaArgs[field.key]);
    compare("Build-specific flags", selected.flagOverrides ?? [], draft.flagOverrides);
    compare("Raw arguments", selected.extraArgs ?? [], payload().extraArgs);
    return result;
  }

  function launchImpact(): Array<[string, string]> {
    const router = runtime?.routerState;
    if (!router?.activeBuildId) return [["Router start", "Required"], ["Target Build", selectedBuild?.displayName ?? "Select Build"], ["Model", draft.routerAlias || "Not set"]];
    if (router.activeBuildId !== draft.buildId) return [["Build switch", "Required"], ["Router restart", "Required for Build replacement"], ["Current Build", builds.find((build) => build.id === router.activeBuildId)?.displayName ?? router.activeBuildId], ["Target Build", selectedBuild?.displayName ?? draft.buildId]];
    if (presetReconciliationPending) return [["Build switch", "No"], ["Preset reconciliation", "Pending validation"], ["Router restart", "Not yet determined"], ["Current state", selectedRouterState ?? "Unloaded"]];
    if (presetRestartRequired) return [["Build switch", "No"], ["Preset reconciliation", "Required"], ["Router restart", "Required to apply preset changes"], ["Current state", selectedRouterState ?? "Unloaded"]];
    if (selectedRouterState === "loaded") return [["Model state", "Loaded"], ["Build switch", "No"], ["Router restart", "No"]];
    return [["Build switch", "No"], ["Router restart", "No"], ["Model action", "Same-Build load"], ["Current state", selectedRouterState ?? "Unloaded"]];
  }

  async function copyPreview() {
    const text = previewView === "preset" ? preview?.preset.content : preview?.launch.command.displayCommand;
    if (!text) return;
    await navigator.clipboard.writeText(text);
    copyLabel = "Copied";
    setTimeout(() => copyLabel = "Copy", 1200);
  }

  onMount(() => {
    mounted = true;
    void load();
    return () => clearTimeout(previewTimer);
  });
</script>

<main class="page-surface profiles-page" aria-label="Configured Models">
  <PageHeader title="Profiles" subtitle="Configure model identity, build requirements, and llama.cpp preset parameters." />
  {#if missingLink}<p class="page-warning">{missingLink}</p>{/if}
  {#if message}<p class="profiles-message" role="status">{message}</p>{/if}

  <div class="profiles-workspace">
    <aside class="panel soft profile-library" aria-label="Profile library">
      <div class="library-top">
        <div class="library-heading"><h2 class="section-title">Profiles</h2><span class="mini-pill">{models.length}</span></div>
        <div class="library-actions">
          <input class="search-control" aria-label="Search profiles" bind:value={search} placeholder="Search profiles..." />
          <button class="btn small primary" type="button" on:click={newModel}>+ New profile</button>
        </div>
      </div>
      <div class="profile-cards">
        {#each filteredModels as model}
          <button class:active={selected?.id === model.id} class="profile-card" type="button" on:click={() => select(model)}>
            <span class="profile-card-top"><span class="profile-name"><i></i><strong>{model.displayName}</strong></span><span class="status-badge">{modelState(model)}</span></span>
            <span class="profile-meta">{model.projector ? "vision" : "text"} · {formatContext(model.llamaArgs?.ctxSize)}</span>
            <span class="profile-meta">{model.build?.displayName ?? "Missing Build"}</span>
          </button>
        {:else}
          <p class="empty-state">{loading ? "Loading..." : "No profiles match this search."}</p>
        {/each}
      </div>
      <div class="library-footer">
        <button class="btn ghost" type="button" on:click={() => legacyImport.click()}>Import legacy Profiles</button>
        <input class="sr-only" bind:this={legacyImport} type="file" accept="application/json" on:change={importLegacy} />
        <small>Compatibility import remains available while Configured Models stay authoritative.</small>
      </div>
    </aside>

    <section class="panel profile-editor" aria-label="Profile editor">
      <header class="editor-toolbar">
        <div class="editor-title">
          <strong>{selected ? `Editing: ${selected.displayName}` : "New profile"}</strong>
          <div class="editor-meta">
            <span>{selected ? modelState(selected) : "Unsaved"}</span>
            {#if dirty}<span>Unsaved changes</span>{/if}
            {#if draft.buildId && runtime?.routerState.activeBuildId}<span>{runtime.routerState.activeBuildId === draft.buildId ? "Same active Build" : "Requires build switch"}</span>{/if}
          </div>
        </div>
        <div class="toolbar-actions">
          <button class="btn small ghost" type="button" disabled={!selected} on:click={() => act("duplicate")}>Duplicate</button>
          <span class="danger-separator"><button class="btn small danger" type="button" disabled={!selected} on:click={() => act("delete")}>Delete</button></span>
          <button class="btn small primary" type="button" disabled={!draft.displayName || !draft.artifactId || !draft.buildId || !dirty} on:click={save}>Save profile</button>
        </div>
      </header>

      <div class="editor-sections">
        {#if !editorReady}
          <section class="config-section progressive-section">
            <div class="config-section-head"><div><h2>New profile</h2><p>Select a Model + Build before configuration controls are resolved.</p></div><span class="badge amber">Awaiting selection</span></div>
            <div class="config-body choice-grid">
              <label class="field">Model<select bind:value={draft.artifactId} on:change={deriveName}><option value="">Select model</option>{#each primaryArtifacts as artifact}<option value={artifact.id}>{artifactName(artifact)}</option>{/each}</select></label>
              <label class="field">llama.cpp Build<select bind:value={draft.buildId} on:change={() => capabilities(draft.buildId)}><option value="">Select Build</option>{#each availableBuilds as build}<option value={build.id}>{buildLabel(build)}</option>{/each}</select></label>
              <p class="capability-note">Configuration controls depend on the selected Build capability manifest. Values begin as Inherited and remain absent from persisted overrides until changed.</p>
            </div>
          </section>
        {:else}
          <section class="config-section">
            <div class="config-section-head"><div><h2>Identity</h2><p>Client-facing name and stable router identity.</p></div></div>
            <div class="config-body field-grid identity-grid">
              <label class="field">Display name<input aria-label="Display name" bind:value={draft.displayName} on:input={() => { if (!selected) draft.routerAlias = alias(draft.displayName); }} /></label>
              <label class="field">Router alias<input aria-label="Router alias" bind:value={draft.routerAlias} /><small>Stable model alias used by clients and router configuration.</small></label>
              <label class="toggle-field"><input type="checkbox" bind:checked={draft.enabled} /><span><strong>Enabled</strong><small>Include this model in generated router presets.</small></span></label>
            </div>
          </section>

          <section class="config-section">
            <div class="config-section-head"><div><h2>Model, vision & build</h2><p>Auto-synced resources owned by Models and Builds.</p></div></div>
            <div class="config-body resource-grid">
              <label class="field">Model<select bind:value={draft.artifactId}><option value="">Select model</option>{#each primaryArtifacts as artifact}<option value={artifact.id}>{artifactName(artifact)}</option>{/each}</select><small>{selectedArtifact ? artifactName(selectedArtifact) : "No model selected"}</small></label>
              <label class="field">llama.cpp Build<select bind:value={draft.buildId} on:change={() => capabilities(draft.buildId)}><option value="">Select Build</option>{#each availableBuilds as build}<option value={build.id}>{buildLabel(build)}</option>{/each}</select><small>{selectedBuild ? buildLabel(selectedBuild) : "No Build selected"}</small></label>
              <label class="field">Projector / MMProj<select bind:value={draft.projectorId}><option value="">None · text only</option>{#each projectors as artifact}<option value={artifact.id}>{artifactName(artifact)}</option>{/each}</select><small>{selectedProjector ? `Explicit projector · ${selectedProjector.referenceStatus}` : "Text-only configuration"}</small></label>
              <div class="resource-links"><a href="#models">Open Models</a><a href="#builds">Open Builds</a></div>
            </div>
          </section>

          {#each groups as group}
            {@const fields = supportedCurated.filter((field) => group.keys.includes(field.key))}
            {#if fields.length}
              <section class="config-section">
                <div class="config-section-head"><div><h2>{group.title}</h2><p>{group.description}</p></div><span class="badge dim">{fields.filter((field) => draft.llamaArgs[field.key] !== undefined).length} override{fields.filter((field) => draft.llamaArgs[field.key] !== undefined).length === 1 ? "" : "s"}</span></div>
                <div class="config-body field-grid">
                  {#each fields as field}
                    <label class="field">{field.label}<em>{draft.llamaArgs[field.key] === undefined ? "Inherited" : "Override"}</em>
                      {#if field.kind === "boolean"}
                        <select aria-label={field.label} value={fieldValue(field)} on:change={(event) => updateArg(field, event.currentTarget.value)}><option value="">Inherited</option><option value="true">Enabled</option></select>
                      {:else}
                        <input aria-label={field.label} type={["ctxSize", "batchSize", "ubatchSize", "parallel", "threads", "threadsBatch"].includes(field.key) ? "number" : "text"} value={fieldValue(field)} placeholder="Inherited" on:input={(event) => updateArg(field, event.currentTarget.value)} />
                      {/if}
                    </label>
                  {/each}
                </div>
              </section>
            {/if}
          {/each}

          {#if buildSpecificFlags.length}
            <section class="config-section">
              <div class="config-section-head"><div><h2>Build-specific</h2><p>Options reported by this Build outside the curated editor.</p></div><span class="badge purple">{buildSpecificFlags.length} supported</span></div>
              <div class="config-body build-flag-grid">
                {#each visibleBuildFlags as flag}
                  <label class="field"><code>{flag.canonicalName}</code><em>{flagValue(flag) ? "Override" : "Inherited"}</em>
                    {#if flag.valuePlaceholder}
                      {#if flag.choices?.length}<select value={flagValue(flag)} on:change={(event) => setFlag(flag, event.currentTarget.value)}><option value="">Inherited</option>{#each flag.choices as choice}<option value={choice}>{choice}</option>{/each}</select>{:else}<input value={flagValue(flag)} placeholder={`Inherited · ${flag.valuePlaceholder}`} on:input={(event) => setFlag(flag, event.currentTarget.value)} />{/if}
                    {:else}<select value={flagValue(flag)} on:change={(event) => setFlag(flag, event.currentTarget.value)}><option value="">Inherited</option><option value="true">Enabled</option></select>{/if}
                    {#if flag.description}<small>{flag.description}</small>{/if}
                  </label>
                {/each}
              </div>
            </section>
          {/if}

          <section class="config-section">
            <div class="config-section-head"><div><h2>Advanced flags</h2><p>Preserved compatibility values and raw escape-hatch arguments.</p></div><span class="badge {unsupportedSavedArgs.length || unknownSavedOverrides.length ? 'amber' : 'dim'}">{unsupportedSavedArgs.length + unknownSavedOverrides.length} preserved</span></div>
            <div class="config-body advanced-body">
              {#if buildSpecificFlags.length >= 6}<input class="flag-search" aria-label="Filter Build flags" bind:value={flagSearch} placeholder="Filter Build flags..." />{/if}
              {#if unsupportedSavedArgs.length || unknownSavedOverrides.length}
                <div class="preserved-list">
                  {#each unsupportedSavedArgs as field}<div><code>{field.aliases[0]}</code><span>{displayValue(draft.llamaArgs[field.key])}</span><strong>Unsupported by selected Build · preserved</strong></div>{/each}
                  {#each unknownSavedOverrides as override}<div><code>{override.flag}</code><span>{override.values?.join(" ") ?? "enabled"}</span><strong>Unknown older-Build override · preserved</strong></div>{/each}
                </div>
              {:else if !draft.extraArgs.trim()}
                <p class="flag-empty">No additional flags are set for this profile.</p>
              {/if}
              <label class="field raw-args">Raw extra arguments<textarea bind:value={draft.extraArgs} placeholder="One argument per line"></textarea><small>Escape hatch only. Unsafe, router-owned, or unsupported flags make the derived preset ineligible.</small></label>
            </div>
          </section>
        {/if}
      </div>
    </section>

    <aside class="profiles-inspector" aria-label="Profile inspector">
      <section class="panel inspector-card validation-panel">
        <div class="inspector-head"><h2 class="section-title">Validation</h2><span class="badge {preview ? 'green' : previewError ? 'red' : 'amber'}">{previewBusy ? "Checking" : preview ? "Valid" : previewError ? "Review" : "Pending"}</span></div>
        <div class="validation-list">
          <div><span>Model</span><strong class:ok={selectedArtifact?.referenceStatus === "available"}>{selectedArtifact?.referenceStatus === "available" ? "OK" : selectedArtifact?.referenceStatus ?? "Required"}</strong></div>
          <div><span>Build</span><strong class:ok={selectedBuild?.managedInferenceEligibility === "eligible"}>{selectedBuild?.managedInferenceEligibility ?? "Required"}</strong></div>
          <div><span>Projector</span><strong class:ok={!draft.projectorId || selectedProjector?.referenceStatus === "available"}>{draft.projectorId ? selectedProjector?.referenceStatus ?? "Missing" : "None"}</strong></div>
          <div><span>Capabilities</span><strong class:ok={!!manifest}>{manifest ? "Loaded" : draft.buildId ? "Unavailable" : "Required"}</strong></div>
          <div><span>Preset</span><strong class:ok={!!preview}>{preview ? "Valid" : previewError ? "Review" : "Pending"}</strong></div>
        </div>
        {#if previewError}<p class="validation-error">{previewError}</p>{/if}
        {#each selected?.warnings ?? [] as warning}<p class="validation-warning">{warning}</p>{/each}
        <button class="btn small ghost panel-action" type="button" disabled={!editorReady || previewBusy} on:click={runValidation}>{previewBusy ? "Validating..." : "Run validation"}</button>
      </section>

      <section class="panel inspector-card command-panel">
        <div class="inspector-head"><h2 class="section-title">Command Preview</h2><button class="btn small ghost" type="button" disabled={!preview} on:click={copyPreview}>{copyLabel}</button></div>
        <div class="preview-tabs" aria-label="Preview type"><button class:active={previewView === "preset"} aria-pressed={previewView === "preset"} type="button" on:click={() => previewView = "preset"}>Preset INI</button><button class:active={previewView === "launch"} aria-pressed={previewView === "launch"} type="button" on:click={() => previewView = "launch"}>Router launch</button></div>
        <div class="command-surface">
          <div class="command-label">{previewView === "preset" ? "Derived model-preset artifact" : "Managed router launch command"}</div>
          <pre>{previewView === "preset" ? ((preview?.preset.content ?? previewError) || "Select Model + Build to preview.") : ((preview?.launch.command.displayCommand ?? previewError) || "Select Model + Build to preview.")}</pre>
        </div>
        <p class="inspector-note">The generated INI is derived from this configuration and is not authoritative editable data.</p>
      </section>

      <section class="panel inspector-card change-panel">
        <div class="inspector-head"><h2 class="section-title">Change Summary</h2>{#if dirty}<span class="badge amber">Unsaved</span>{/if}</div>
        <div class="change-list">
          {#each changes as change}<div><span>{change.label}</span><strong><s>{change.before}</s><b>→</b>{change.after}</strong></div>{:else}<p class="inspector-empty">No unsaved changes</p>{/each}
        </div>
      </section>

      <section class="panel inspector-card impact-panel">
        <div class="inspector-head"><h2 class="section-title">Launch Impact</h2><span class="badge purple">Draft</span></div>
        <div class="impact-grid">{#each impact as item}<div><span>{item[0]}</span><strong>{item[1]}</strong></div>{/each}</div>
        {#if selected && !dirty && !presetRestartRequired && !presetReconciliationPending}<div class="runtime-action-wrap"><ConfiguredModelRuntimeAction model={selected} {runtime} onComplete={load} /></div>{:else if presetReconciliationPending}<p class="inspector-note">Validate the current draft before deciding whether the running router preset needs reconciliation.</p>{:else if presetRestartRequired}<p class="inspector-note">Regenerate and restart the router to reconcile this changed derived preset before loading the model.</p>{:else if selected}<p class="inspector-note">Save this draft before using its runtime action.</p>{/if}
      </section>
    </aside>
  </div>
</main>

<style>
  .profiles-page { height: calc(100vh - var(--topbar-height)); overflow-y: auto; }
  .profiles-workspace { display: grid; grid-template-columns: minmax(280px, 300px) minmax(0, 1fr) minmax(320px, 348px); gap: 12px; align-items: start; margin-top: 16px; padding-bottom: 28px; }
  .profile-library, .profile-editor, .profiles-inspector { min-width: 0; }
  .profile-library { min-height: calc(100vh - var(--topbar-height) - 118px); display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
  .library-top { display: grid; gap: 13px; padding: 15px 14px 0; }
  .library-heading, .inspector-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .library-actions { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
  .search-control, .flag-search, .field input, .field select, .field textarea { width: 100%; min-width: 0; border: 1px solid rgba(132,153,188,.18); border-radius: var(--radius-sm); outline: 0; color: var(--color-text); background: rgba(5,12,22,.68); box-shadow: inset 0 1px 12px rgba(0,0,0,.22); }
  .search-control, .flag-search, .field input, .field select { min-height: 36px; padding: 0 10px; }
  .search-control, .flag-search { font-size: 12px; }
  .profile-cards { display: grid; align-content: start; padding: 14px 10px; }
  .profile-card { position: relative; display: grid; gap: 7px; width: 100%; min-width: 0; min-height: 88px; padding: 13px 14px; border: 1px solid transparent; border-radius: 10px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
  .profile-card:not(.active) + .profile-card:not(.active)::before { content: ""; position: absolute; top: -3px; left: 14px; right: 14px; height: 1px; background: var(--color-line); }
  .profile-card.active { border-color: rgba(157,111,255,.46); background: radial-gradient(circle at 18% 18%, rgba(192,149,255,.25), transparent 42%), linear-gradient(135deg, rgba(106,63,210,.78), rgba(58,37,132,.62)); box-shadow: 0 14px 32px rgba(74,45,161,.24), inset 0 1px 0 rgba(255,255,255,.11); }
  .profile-card-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .profile-name { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .profile-name i { width: 16px; height: 16px; flex: 0 0 auto; border-radius: 999px; background: linear-gradient(135deg, #b893ff, #734de9); box-shadow: 0 0 17px rgba(158,105,255,.42); }
  .profile-name strong { overflow: hidden; color: #edf2fb; font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
  .profile-meta { margin-left: 25px; overflow: hidden; color: #9eacc0; font-size: 11px; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
  .profile-card.active .profile-meta { color: rgba(239,235,255,.86); }
  .status-badge, .badge { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border: 1px solid rgba(132,153,188,.18); border-radius: 999px; color: #b9c5d7; background: rgba(7,14,26,.5); font-size: 10px; font-weight: 850; white-space: nowrap; }
  .badge.green { color: #8df0a4; border-color: rgba(89,220,122,.24); background: rgba(89,220,122,.09); }.badge.amber { color: #ffd18a; border-color: rgba(244,185,95,.28); background: rgba(244,185,95,.09); }.badge.red { color: #ff9aa7; border-color: rgba(255,107,122,.28); background: rgba(255,107,122,.08); }.badge.purple { color: #d4c7ff; border-color: rgba(143,92,255,.32); background: rgba(143,92,255,.12); }.badge.dim { color: #8190a6; }
  .library-footer { display: grid; gap: 8px; padding: 12px 14px 14px; border-top: 1px solid var(--color-line); background: rgba(5,10,18,.25); }
  .library-footer small, .field small, .inspector-note { color: var(--color-dim); font-size: 10px; line-height: 1.45; }
  .profile-editor { overflow: visible; }
  .editor-toolbar { position: sticky; top: -16px; z-index: 7; min-height: 62px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--color-line); border-radius: var(--radius-md) var(--radius-md) 0 0; background: linear-gradient(180deg, rgba(16,27,45,.99), rgba(11,19,33,.98)); }
  .editor-title { display: grid; gap: 5px; min-width: 0; }.editor-title > strong { overflow: hidden; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
  .editor-meta { display: flex; flex-wrap: wrap; gap: 7px 13px; color: #8d9ab0; font-size: 11px; }.editor-meta span + span { position: relative; }.editor-meta span + span::before { content: ""; position: absolute; left: -8px; top: 6px; width: 3px; height: 3px; border-radius: 50%; background: #66758b; }
  .toolbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; }.danger-separator { margin-left: 4px; padding-left: 11px; border-left: 1px solid var(--color-line); }
  .editor-sections { display: grid; gap: 10px; padding: 10px; }
  .config-section { border: 1px solid rgba(132,153,188,.13); border-radius: var(--radius-sm); background: linear-gradient(180deg, rgba(12,23,39,.75), rgba(7,14,26,.72)); overflow: hidden; }
  .config-section-head { min-height: 43px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 13px; border-bottom: 1px solid rgba(132,153,188,.1); }.config-section-head > div { min-width: 0; display: flex; align-items: baseline; gap: 10px; }.config-section-head h2 { flex: 0 0 auto; color: #d8e1ee; font-size: 10px; font-weight: 900; letter-spacing: .095em; text-transform: uppercase; }.config-section-head p { overflow: hidden; color: #77859b; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
  .config-body { padding: 13px; }.field-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }.identity-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 180px; }.choice-grid, .resource-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }.resource-grid .field:nth-child(3) { grid-column: 1 / -1; }
  .field { position: relative; display: grid; gap: 6px; min-width: 0; color: #98a6ba; font-size: 11px; font-weight: 780; }.field em { position: absolute; top: 0; right: 0; color: #66758c; font-size: 9px; font-style: normal; letter-spacing: .04em; text-transform: uppercase; }.field textarea { min-height: 74px; resize: vertical; padding: 9px 10px; font-family: var(--font-mono); font-size: 11px; line-height: 1.5; }.field code { color: #d8e4f2; font-family: var(--font-mono); font-size: 11px; }
  .toggle-field { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 8px 10px; border: 1px solid rgba(132,153,188,.13); border-radius: var(--radius-sm); background: rgba(5,12,22,.34); }.toggle-field input { flex: 0 0 auto; }.toggle-field span { display: grid; gap: 2px; min-width: 0; }.toggle-field strong { color: #d8e1ee; font-size: 11px; }.toggle-field small { color: var(--color-dim); font-size: 9px; line-height: 1.3; }
  .capability-note { grid-column: 1 / -1; padding: 10px 11px; border: 1px solid var(--color-line); border-radius: var(--radius-sm); color: var(--color-muted); background: rgba(5,12,22,.34); font-size: 11px; line-height: 1.5; }.resource-links { grid-column: 1 / -1; display: flex; gap: 12px; }.resource-links a { color: #bca8ff; font-size: 11px; font-weight: 800; text-decoration: none; }
  .build-flag-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 11px; }.advanced-body { display: grid; gap: 11px; }.preserved-list { display: grid; border: 1px solid rgba(244,185,95,.2); border-radius: var(--radius-sm); overflow: hidden; }.preserved-list > div { display: grid; grid-template-columns: minmax(100px, .7fr) minmax(70px, .5fr) minmax(180px, 1fr); gap: 9px; padding: 8px 10px; border-bottom: 1px solid rgba(244,185,95,.1); color: #aeb9ca; font-size: 10px; }.preserved-list > div:last-child { border-bottom: 0; }.preserved-list code { color: #ffd18a; overflow-wrap: anywhere; }.preserved-list strong { color: #d3a95f; font-size: 9px; text-align: right; text-transform: uppercase; }.flag-empty { min-height: 68px; display: grid; place-items: center; padding: 14px; border: 1px solid var(--color-line); border-radius: var(--radius-sm); color: #7f8da3; background: rgba(3,8,16,.32); font-size: 11px; text-align: center; }
  .profiles-inspector { display: grid; gap: 10px; align-content: start; }.inspector-card { padding: 14px; }.validation-list, .change-list { display: grid; gap: 7px; margin-top: 12px; }.validation-list > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 8px 9px; border: 1px solid rgba(132,153,188,.11); border-radius: var(--radius-sm); color: #aebacd; background: rgba(8,16,29,.44); font-size: 11px; }.validation-list strong { color: var(--color-amber); font-size: 10px; text-transform: uppercase; }.validation-list strong.ok { color: var(--color-green); }.validation-error, .validation-warning { margin-top: 10px; color: var(--color-red); font-size: 10px; line-height: 1.45; overflow-wrap: anywhere; }.validation-warning { color: var(--color-amber); }.panel-action { width: 100%; margin-top: 11px; }
  .preview-tabs { display: grid; grid-template-columns: 1fr 1fr; margin-top: 12px; border: 1px solid var(--color-line); border-radius: var(--radius-sm); overflow: hidden; }.preview-tabs button { min-height: 32px; border: 0; border-right: 1px solid var(--color-line); color: #8492a8; background: rgba(5,12,22,.56); font-size: 10px; font-weight: 850; }.preview-tabs button:last-child { border-right: 0; }.preview-tabs button.active { color: #eee9ff; background: rgba(143,92,255,.16); }
  .command-surface { margin-top: 8px; border: 1px solid rgba(132,153,188,.13); border-radius: var(--radius-sm); background: rgba(4,7,12,.68); box-shadow: inset 0 1px 22px rgba(0,0,0,.32); overflow: hidden; }.command-label { padding: 8px 10px; border-bottom: 1px solid var(--color-line); color: #8998ab; background: rgba(12,22,38,.52); font-size: 10px; font-weight: 800; }.command-surface pre { min-height: 170px; max-height: 330px; margin: 0; padding: 11px 12px; overflow: auto; color: #d7e2f1; font-family: var(--font-mono); font-size: 10px; line-height: 1.55; overflow-wrap: anywhere; white-space: pre-wrap; }.command-panel .inspector-note { margin-top: 9px; }
  .change-list > div { display: grid; grid-template-columns: minmax(0, .7fr) minmax(0, 1fr); gap: 9px; padding-bottom: 7px; border-bottom: 1px solid rgba(132,153,188,.08); color: #9facbf; font-size: 10px; }.change-list strong { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 5px; min-width: 0; color: #e0e9f5; font-family: var(--font-mono); text-align: right; overflow-wrap: anywhere; }.change-list s { color: #748196; }.change-list b { color: var(--color-purple); }.inspector-empty { color: var(--color-muted); font-size: 11px; }
  .impact-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 12px; }.impact-grid > div { min-height: 61px; display: grid; align-content: center; gap: 5px; padding: 9px; border: 1px solid rgba(132,153,188,.11); border-radius: var(--radius-sm); background: rgba(5,12,22,.44); }.impact-grid span { color: #77869c; font-size: 9px; font-weight: 900; letter-spacing: .07em; text-transform: uppercase; }.impact-grid strong { color: #e4edf8; font-family: var(--font-mono); font-size: 10px; overflow-wrap: anywhere; }.runtime-action-wrap { margin-top: 11px; }.impact-panel > .inspector-note { display: block; margin-top: 10px; }
  .profiles-message, .page-warning { margin-top: 9px; color: var(--color-muted); font-size: 11px; }.page-warning { color: var(--color-amber); }.empty-state { padding: 14px; color: var(--color-muted); font-size: 11px; line-height: 1.5; }.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
  :global(.btn.small) { min-height: 32px; padding: 0 10px; font-size: 11px; }

  @media (max-width: 1500px) {
    .profiles-workspace { grid-template-columns: 290px minmax(0, 1fr); }
    .profiles-inspector { grid-column: 1 / -1; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 1050px) {
    .profiles-workspace { grid-template-columns: minmax(230px, 280px) minmax(0, 1fr); }
    .identity-grid, .field-grid, .build-flag-grid { grid-template-columns: minmax(0, 1fr); }
    .profiles-inspector { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 760px) {
    .profiles-page { height: auto; overflow: visible; }
    .profiles-workspace { grid-template-columns: minmax(0, 1fr); }
    .profile-library { min-height: auto; }
    .profile-cards { max-height: 340px; overflow: auto; }
    .editor-toolbar { position: static; grid-template-columns: minmax(0, 1fr); }
    .toolbar-actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }.danger-separator { margin: 0; padding: 0; border: 0; }.danger-separator .btn { width: 100%; }
    .choice-grid, .resource-grid { grid-template-columns: minmax(0, 1fr); }.resource-grid .field:nth-child(3), .capability-note, .resource-links { grid-column: auto; }
  }
  @media (max-width: 390px) {
    .profiles-workspace { gap: 9px; }
    .library-actions { grid-template-columns: minmax(0, 1fr); }
    .toolbar-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }.toolbar-actions > :last-child { grid-column: 1 / -1; }
    .config-section-head { align-items: flex-start; }.config-section-head > div { display: grid; gap: 4px; }.config-section-head p { white-space: normal; }
    .preserved-list > div, .impact-grid { grid-template-columns: minmax(0, 1fr); }.preserved-list strong { text-align: left; }
  }
</style>
