<script lang="ts">
  import { onMount } from "svelte";
  import { defaultProfileEditorDefaults, type LlamaBuildCapabilitiesManifest, type LlamaBuildFlagCapability, type LlamaCppArgs, type LlamaCppProfile, type ProfileDraftPreviewResponse, type ProfileDraftValidationResponse, type ProfileValidationResponse, type RuntimeState } from "@obsidianlm/shared";
  import PageHeader from "../components/PageHeader.svelte";
  import CommandPreview from "../components/CommandPreview.svelte";
  import { API_ENDPOINTS, fetchJson, type AppSettings, type LlamaBuildDiscoveryResponse, type ModelDiscoveryResponse, type ProfileListResponse, type ProfileMutationResponse } from "../api";
  import { capabilityFor, curatedFields, draftChangeSummary, genericFlags, profileFields, suggestedName, unknownOverrides, unsupportedArgs, type CuratedSection } from "../profiles/registry";

  type Draft = LlamaCppProfile;
  type RuntimeStateResponse = { state: RuntimeState; warnings: string[] };
  const sections: CuratedSection[] = ["PROFILE", "CONTEXT & CACHE", "COMPUTE", "PERFORMANCE", "SERVER"];
  let managedPort = defaultProfileEditorDefaults.port;
  const blankDraft = (): Draft => ({ id: "", name: "", buildPath: "", modelPath: "", ...structuredClone(defaultProfileEditorDefaults), port: managedPort });
  const numericArgs = new Set<keyof LlamaCppArgs>(["ctxSize", "batchSize", "ubatchSize", "parallel", "threads", "threadsBatch"]);
  let profiles: Draft[] = [];
  let models: ModelDiscoveryResponse["models"] = [];
  let builds: LlamaBuildDiscoveryResponse["builds"] = [];
  let modelWarnings: string[] = [];
  let buildWarnings: string[] = [];
  let scannedFolders: string[] = [];
  let activeProfileId: string | null = null;
  let draft = blankDraft();
  let savedDraft: Draft | null = null;
  let selectedId: string | null = null;
  let search = "";
  let manifest: LlamaBuildCapabilitiesManifest | null = null;
  let capabilityState: "idle" | "resolving" | "ready" | "partial" | "failed" = "idle";
  let message = "";
  let validation: ProfileValidationResponse | null = null;
  let preview: ProfileDraftPreviewResponse | null = null;
  let rawExtra = "";
  let fileInput: HTMLInputElement;
  let previewTimer: number | undefined;
  let scheduledPreview = "";
  let probeRequest = 0;
  let inspectionRequest = 0;

  $: selectedBuild = builds.find((build) => build.serverPath === draft.buildPath);
  $: selectedModel = models.find((model) => model.path === draft.modelPath);
  $: completeSelection = Boolean(draft.buildPath && draft.modelPath);
  $: activeFlags = manifest?.flags ?? [];
  $: selectableDevices = (manifest?.devices ?? []).filter((device) => !/^cpu$/i.test(device.id) && !/^cpu$/i.test(device.label ?? ""));
  $: filteredProfiles = profiles.filter((profile) => `${profile.name} ${profile.modelPath} ${profile.buildPath}`.toLowerCase().includes(search.toLowerCase().trim()));
  $: legacyOverrides = unknownOverrides(draft.flagOverrides ?? [], activeFlags);
  $: unsupportedLegacyArgs = unsupportedArgs(draft, activeFlags);
  $: changeSummary = draftChangeSummary(savedDraft, serializableDraft());
  $: previewSignature = completeSelection ? JSON.stringify(serializableDraft()) : "";
  $: if (previewSignature && previewSignature !== scheduledPreview) schedulePreview(previewSignature);

  async function load() {
    try {
      const [profileResponse, modelResponse, buildResponse, runtimeResponse, settings] = await Promise.all([
        fetchJson<ProfileListResponse>(API_ENDPOINTS.profiles.list), fetchJson<ModelDiscoveryResponse>(API_ENDPOINTS.discovery.models),
        fetchJson<LlamaBuildDiscoveryResponse>(API_ENDPOINTS.discovery.llamaBuilds), fetchJson<RuntimeStateResponse>(API_ENDPOINTS.runtime.state), fetchJson<AppSettings>(API_ENDPOINTS.settings.get)
      ]);
      profiles = profileResponse.profiles;
      models = modelResponse.models;
      builds = buildResponse.builds;
      modelWarnings = modelResponse.warnings.map((warning) => warning.message);
      buildWarnings = buildResponse.warnings.map((warning) => warning.message);
      scannedFolders = [...modelResponse.scannedFolders, ...buildResponse.scannedFolders];
      activeProfileId = runtimeResponse.state.activeProfileId;
      managedPort = settings.managedLlamaPort;
      if (!selectedId && !draft.modelPath && !draft.buildPath) draft = blankDraft();
      if (profiles[0]) void selectProfile(profiles[0]);
    } catch (error) { message = error instanceof Error ? error.message : "Could not load profile library"; }
  }

  function newProfile() { probeRequest += 1; inspectionRequest += 1; selectedId = null; draft = blankDraft(); savedDraft = null; rawExtra = ""; manifest = null; capabilityState = "idle"; validation = null; preview = null; scheduledPreview = ""; message = "Select a model and build. Rescan discovery if either is missing."; }
  async function selectProfile(profile: Draft) { probeRequest += 1; inspectionRequest += 1; selectedId = profile.id; draft = structuredClone(profile); savedDraft = structuredClone(profile); rawExtra = draft.extraArgs?.join("\n") ?? ""; manifest = null; validation = null; preview = null; await probe(); }
  function updateDraft(patch: Partial<Draft>) { draft = { ...draft, ...patch }; }
  function updateArg(key: keyof LlamaCppArgs, value: string | boolean | undefined) {
    const normalized = value === "" || value === undefined ? undefined : numericArgs.has(key) ? Number(value) : key === "gpuLayers" && value !== "all" ? Number(value) : value;
    draft = { ...draft, llamaArgs: { ...draft.llamaArgs, [key]: normalized } };
  }
  function toggleDevice(id: string, checked: boolean) {
    const devices = new Set(draft.llamaArgs?.devices ?? []); checked ? devices.add(id) : devices.delete(id);
    draft = { ...draft, llamaArgs: { ...draft.llamaArgs, devices: devices.size ? [...devices] : undefined } };
  }
  function flagValue(flag: LlamaBuildFlagCapability): string {
    const override = draft.flagOverrides?.find((item) => item.flag === flag.canonicalName);
    return override ? override.values?.join(" ") ?? "true" : "";
  }
  function setOverride(flag: LlamaBuildFlagCapability, value: string) {
    const rest = (draft.flagOverrides ?? []).filter((item) => item.flag !== flag.canonicalName);
    updateDraft({ flagOverrides: value === "" ? rest : [...rest, { flag: flag.canonicalName, ...(flag.valuePlaceholder ? { values: [value] } : {}) }] });
  }
  async function probe(buildPath = draft.buildPath, modelPath = draft.modelPath) {
    const build = builds.find((item) => item.serverPath === buildPath);
    if (!build || !modelPath) return;
    const request = ++probeRequest;
    capabilityState = "resolving"; manifest = null;
    try { const next = await fetchJson<LlamaBuildCapabilitiesManifest>(API_ENDPOINTS.discovery.llamaBuildCapabilities(build.id)); if (request === probeRequest && draft.buildPath === buildPath && draft.modelPath === modelPath) { manifest = next; capabilityState = next.status; } }
    catch { if (request === probeRequest) { capabilityState = "failed"; message = "Capability probe failed. Existing compatibility settings remain preserved."; } }
  }
  async function selectModel(path: string) { updateDraft({ modelPath: path, name: selectedId ? draft.name : suggestedName(path) }); await probe(draft.buildPath, path); }
  async function selectBuild(path: string) { updateDraft({ buildPath: path }); await probe(path, draft.modelPath); }
  function schedulePreview(signature: string) { scheduledPreview = signature; window.clearTimeout(previewTimer); previewTimer = window.setTimeout(() => void inspectDraft(), 350); }
  async function inspectDraft() {
    if (!completeSelection) return;
    const payload = serializableDraft();
    const signature = JSON.stringify(payload);
    const request = ++inspectionRequest;
    try {
      const [validated, nextPreview] = await Promise.all([
        fetchJson<ProfileDraftValidationResponse>(API_ENDPOINTS.profiles.validateDraft, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
        fetchJson<ProfileDraftPreviewResponse>(API_ENDPOINTS.profiles.previewCommand, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      ]);
      if (request === inspectionRequest && JSON.stringify(serializableDraft()) === signature) { validation = validated.validation; preview = nextPreview; }
    } catch (error) { if (request === inspectionRequest) { validation = null; preview = null; message = error instanceof Error ? error.message : "Draft inspection failed"; } }
  }
  function serializableDraft(): Draft { return { ...draft, extraArgs: rawExtra.split(/\r?\n/).map((line) => line.trim()).filter(Boolean), flagOverrides: draft.flagOverrides?.filter((item) => item.flag) }; }
  async function save() {
    const payload = serializableDraft(); const { id: _id, ...createPayload } = payload;
    try {
      const response = selectedId ? await fetchJson<ProfileMutationResponse>(API_ENDPOINTS.profiles.update(selectedId), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }) : await fetchJson<ProfileMutationResponse>(API_ENDPOINTS.profiles.create, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createPayload) });
      profiles = selectedId ? profiles.map((item) => item.id === response.profile.id ? response.profile : item) : [...profiles, response.profile]; await selectProfile(response.profile); message = "Profile saved.";
    } catch (error) { message = error instanceof Error ? error.message : "Could not save profile"; }
  }
  async function action(kind: "duplicate" | "delete" | "start") {
    if (!selectedId || (kind === "delete" && !window.confirm(`Delete ${draft.name}? This cannot be undone.`))) return;
    try {
      if (kind === "delete") { await fetchJson(API_ENDPOINTS.profiles.delete(selectedId), { method: "DELETE" }); profiles = profiles.filter((item) => item.id !== selectedId); newProfile(); }
      else if (kind === "start") { await fetchJson(API_ENDPOINTS.profiles.start(selectedId), { method: "POST" }); message = "Profile start requested."; }
      else { const result = await fetchJson<ProfileMutationResponse>(API_ENDPOINTS.profiles.duplicate(selectedId), { method: "POST" }); profiles = [...profiles, result.profile]; await selectProfile(result.profile); }
    } catch (error) { message = error instanceof Error ? error.message : `Could not ${kind} profile`; }
  }
  async function rescan() { try { await Promise.all([fetchJson(API_ENDPOINTS.discovery.rescanModels, { method: "POST" }), fetchJson(API_ENDPOINTS.discovery.rescanLlamaBuilds, { method: "POST" })]); await load(); message = "Discovery rescanned."; } catch { message = "Discovery rescan failed."; } }
  async function exportProfiles() { const data = await fetchJson<{ profiles: Draft[] }>(API_ENDPOINTS.profiles.export); const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); link.download = "obsidianlm-profiles.json"; link.click(); URL.revokeObjectURL(link.href); }
  async function importProfiles(event: Event) { const file = (event.currentTarget as HTMLInputElement).files?.[0]; if (!file) return; try { await fetchJson(API_ENDPOINTS.profiles.import, { method: "POST", headers: { "Content-Type": "application/json" }, body: await file.text() }); await load(); message = "Profiles imported."; } catch { message = "Import failed: choose an ObsidianLM profile export."; } }
  function fieldVisible(key: keyof LlamaCppArgs): boolean { return (key !== "devices" || selectableDevices.length > 0) && (key !== "tensorSplit" || (draft.llamaArgs?.devices?.length ?? 0) >= 2 && Boolean(draft.llamaArgs?.splitMode)); }
  function sectionVisible(section: CuratedSection): boolean { return curatedFields.some((field) => field.section === section && capabilityFor(field, activeFlags) && fieldVisible(field.key)); }
  onMount(() => { void load(); return () => window.clearTimeout(previewTimer); });
</script>

<main class="page-surface profiles-page" aria-label="Profiles">
  <PageHeader title="Profiles" subtitle="Compose a launch profile from discovered models and the exact capabilities of each llama.cpp build." />
  <div class="profiles-actions"><button class="btn primary" type="button" on:click={newProfile}>New profile</button><button class="btn" type="button" on:click={rescan}>Rescan discovery</button><button class="btn" type="button" on:click={exportProfiles}>Export</button><button class="btn" type="button" on:click={() => fileInput.click()}>Import</button><input bind:this={fileInput} class="sr-only" type="file" accept="application/json" on:change={importProfiles} /></div>
  {#if message}<p class="profiles-message" role="status">{message}</p>{/if}
  <div class="profiles-grid">
    <aside class="panel profiles-library" aria-label="Profile library"><div class="panel-head"><h2 class="section-title">Library</h2><span class="mini-pill">{profiles.length}</span></div><label class="library-search">Search profiles<input aria-label="Search profiles" bind:value={search} placeholder="Name, model, build" /></label><div class="profiles-list">{#each filteredProfiles as profile}<button class:active={profile.id === selectedId} class="profile-entry" type="button" on:click={() => selectProfile(profile)}><span><strong>{profile.name}</strong>{#if profile.id === activeProfileId}<b class="mini-pill">Active</b>{/if}</span><small>{profile.llamaArgs?.ctxSize ? `${profile.llamaArgs.ctxSize} ctx` : "Context default"}{#if profile.llamaArgs?.flashAttention === false} · <i title="Saved explicit off is preserved">!</i>{/if}</small><span>{profile.modelPath.split(/[\\/]/).pop()} · {profile.buildPath.split(/[\\/]/).pop()}</span></button>{:else}<p class="empty-state">No saved profiles match. {scannedFolders.length ? "Check configured folders or rescan discovery." : "Configure model and build folders, then rescan."}</p>{/each}</div></aside>
    <section class="panel profiles-editor" aria-label="Profile editor"><div class="panel-head"><h2 class="section-title">{selectedId ? "Edit profile" : "New local draft"}</h2>{#if completeSelection}<span class="mini-pill">{capabilityState}</span>{/if}</div><div class="profile-form">
      <label>Model<select aria-label="Model" value={draft.modelPath} on:change={(event) => selectModel(event.currentTarget.value)}><option value="">Select a discovered model</option>{#each models as model}<option value={model.path}>{model.name}</option>{/each}</select>{#if selectedModel}<small>{selectedModel.quantizationGuess ?? "Quantization unknown"} · {Math.round(selectedModel.sizeBytes / 1024 / 1024)} MiB</small>{/if}</label>
      <label>Build<select aria-label="Build" value={draft.buildPath} on:change={(event) => selectBuild(event.currentTarget.value)}><option value="">Select a llama.cpp build</option>{#each builds as build}<option value={build.serverPath}>{build.name}</option>{/each}</select>{#if selectedBuild}<small>{selectedBuild.serverPath}</small>{/if}</label>
      {#if !completeSelection}<p class="discovery-guide">Choose both sources before options appear. {modelWarnings.concat(buildWarnings).join(" ") || "Rescan discovery after moving a model or build."}</p>{:else if capabilityState === "resolving"}<p class="discovery-guide">Resolving build capabilities…</p>{:else}
        {#if capabilityState !== "failed"}<section class="profile-section"><h3>PROFILE</h3>{#each profileFields as field}<label>{field.label}<input aria-label="Profile name" bind:value={draft.name} /></label>{/each}</section>{:else if selectedId}<section class="profile-section"><h3>PROFILE</h3>{#each profileFields as field}<label>{field.label}<input aria-label="Profile name" bind:value={draft.name} /></label>{/each}</section>{:else}<p class="warning">Structured options are unavailable until this build can be probed.</p>{/if}
        {#if capabilityState !== "failed"}{#each sections.filter((section) => section !== "PROFILE" && section !== "SERVER" && sectionVisible(section)) as section}<section class="profile-section"><h3>{section}</h3><div class="field-grid">{#each curatedFields.filter((field) => field.section === section) as field}{#if capabilityFor(field, activeFlags) && fieldVisible(field.key)}<label>{field.label}{#if field.key === "devices"}<span class="device-list">{#each selectableDevices as device}<label><input type="checkbox" checked={draft.llamaArgs?.devices?.includes(device.id)} on:change={(event) => toggleDevice(device.id, event.currentTarget.checked)} />{device.label ?? device.id}</label>{/each}</span>{:else if field.kind === "boolean"}<select value={draft.llamaArgs?.[field.key] === true ? "true" : ""} on:change={(event) => updateArg(field.key, event.currentTarget.value === "" ? undefined : true)}><option value="">Inherited</option><option value="true">Enabled</option></select>{#if draft.llamaArgs?.[field.key] === false}<small class="warning">Saved explicit off is preserved; this build cannot safely edit it.</small>{/if}{:else}<input value={draft.llamaArgs?.[field.key] ?? ""} placeholder="Inherited" on:input={(event) => updateArg(field.key, event.currentTarget.value)} />{/if}{#if capabilityFor(field, activeFlags)?.description}<small>{capabilityFor(field, activeFlags)?.description}</small>{/if}{#if capabilityFor(field, activeFlags)?.defaultText}<small>Default: {capabilityFor(field, activeFlags)?.defaultText}</small>{/if}</label>{/if}{/each}</div></section>{/each}
          <section class="profile-section"><h3>SERVER</h3><div class="field-grid"><label>Host<input aria-label="Host" bind:value={draft.host} /><small>ObsidianLM-managed default: {defaultProfileEditorDefaults.host}</small></label><label>Port<input aria-label="Port" type="number" bind:value={draft.port} /><small>ObsidianLM-managed default: {managedPort}</small></label>{#each curatedFields.filter((field) => field.section === "SERVER") as field}{#if capabilityFor(field, activeFlags)}<label>{field.label}<select value={draft.llamaArgs?.[field.key] === true ? "true" : ""} on:change={(event) => updateArg(field.key, event.currentTarget.value === "" ? undefined : true)}><option value="">Inherited</option><option value="true">Enabled</option></select></label>{/if}{/each}</div></section>
          {#if genericFlags(activeFlags).length}<details><summary>Build-specific options</summary><div class="build-specific">{#each genericFlags(activeFlags) as flag}<label>{flag.canonicalName}{#if flag.choices?.length}<select value={flagValue(flag)} on:change={(event) => setOverride(flag, event.currentTarget.value)}><option value="">Inherited</option>{#each flag.choices as choice}<option value={choice}>{choice}</option>{/each}</select>{:else if !flag.valuePlaceholder}<select value={flagValue(flag)} on:change={(event) => setOverride(flag, event.currentTarget.value)}><option value="">Inherited</option><option value="true">Enabled</option></select>{:else}<input value={flagValue(flag)} placeholder={flag.valuePlaceholder} on:input={(event) => setOverride(flag, event.currentTarget.value)} />{/if}{#if flag.description}<small>{flag.description}</small>{/if}{#if flag.defaultText}<small>Default: {flag.defaultText}</small>{/if}</label>{/each}</div></details>{/if}{/if}
        <details open={capabilityState === "failed" || legacyOverrides.length > 0 || unsupportedLegacyArgs.length > 0}><summary>Compatibility &amp; advanced</summary>{#if legacyOverrides.length || unsupportedLegacyArgs.length || activeFlags.filter((flag) => flag.deprecated).length}<p class="warning">Unsupported and deprecated values are preserved exactly; changing builds does not remove them.</p>{/if}{#each legacyOverrides as override}<p class="compatibility-row"><code>{override.flag}</code><span>{override.values?.join(" ") ?? "(no value)"}</span></p>{/each}{#each unsupportedLegacyArgs as name}<p class="compatibility-row"><span>{name}</span><span>Saved value is unsupported by this build</span></p>{/each}{#each activeFlags.filter((flag) => flag.deprecated) as flag}<p class="compatibility-row"><code>{flag.canonicalName}</code><span>Deprecated {flagValue(flag) || flag.description || "build flag"}</span></p>{/each}<label>Raw extra arguments<textarea aria-label="Raw extra arguments" bind:value={rawExtra} placeholder="One complete argument per line"></textarea><small>One argument per line; spaces are preserved. These bypass capability mapping.</small></label></details>
        <div class="editor-actions"><button class="btn primary" type="button" on:click={save}>Save profile</button><button class="btn" type="button" on:click={inspectDraft}>Validate</button>{#if selectedId}<button class="btn" type="button" on:click={() => action("duplicate")}>Duplicate</button><button class="btn danger" type="button" on:click={() => action("delete")}>Delete</button><button class="btn" type="button" on:click={() => action("start")}>Start</button>{/if}</div>
      {/if}</div></section>
    <aside class="panel profiles-inspector" aria-label="Draft inspector"><div class="panel-head"><h2 class="section-title">Inspector</h2><span class="mini-pill">{validation?.valid ? "Valid" : completeSelection ? "Checking" : "Awaiting selection"}</span></div>{#if completeSelection}<div class="inspector-body"><h3>Draft changes</h3><p>{changeSummary.join(" · ")}</p>{#if manifest?.warnings?.length}<p class="warning">{manifest.warnings.map((warning) => warning.message).join(" ")}</p>{/if}<h3>Validation</h3>{#each validation?.errors ?? [] as error}<p class="error">{error}</p>{/each}{#each validation?.warnings ?? [] as warning}<p class="warning">{warning}</p>{/each}{#if validation?.valid}<p class="ok">Draft validation passed.</p>{/if}<h3>Command preview</h3><CommandPreview command={preview?.command?.displayCommand ?? ""} emptyLabel="Waiting for draft preview" /></div>{:else}<p class="empty-state">Select a model and build to validate this local draft and preview the generated command.</p>{/if}</aside>
  </div>
</main>
