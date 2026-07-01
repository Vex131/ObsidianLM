<script lang="ts">
  import type {
    CommandSpec,
    ExportProfilesResponse,
    ImportProfilesResponse,
    LlamaCppArgs,
    ProfileConfigSnippetResponse,
    ProfileMutationResponse,
    ProfileValidationResponse,
    RuntimeProfile,
    RuntimeState
  } from "@obsidianlm/shared";
  import Panel from "../Panel.svelte";
  import TerminalBlock from "../TerminalBlock.svelte";
  import ToolbarButton from "../ToolbarButton.svelte";

  interface FetchJson {
    <T>(url: string, init?: RequestInit): Promise<T>;
  }

  type EditorMode = "edit" | "create";

  let {
    profiles,
    selectedProfileId,
    runtime,
    pendingAction,
    fetchJson,
    runAction,
    onProfilesChanged,
    setSelectedProfileId,
    setCommand,
    setValidation,
    setActionMessage
  }: {
    profiles: RuntimeProfile[];
    selectedProfileId: string;
    runtime: RuntimeState | null;
    pendingAction: string | null;
    fetchJson: FetchJson;
    runAction: (label: string, action: () => Promise<void>) => Promise<void>;
    onProfilesChanged: () => Promise<void>;
    setSelectedProfileId: (id: string) => void;
    setCommand: (command: CommandSpec | null) => void;
    setValidation: (validation: ProfileValidationResponse | null) => void;
    setActionMessage: (message: string) => void;
  } = $props();

  const selectedProfile = $derived(profiles.find((profile) => profile.id === selectedProfileId) ?? null);
  const isSelectedRunning = $derived(Boolean(selectedProfile && runtime?.activeProfileId === selectedProfile.id && ["starting", "running", "stopping"].includes(runtime.status)));

  let mode = $state<EditorMode>("edit");
  let validation = $state<ProfileValidationResponse | null>(null);
  let snippets = $state<ProfileConfigSnippetResponse | null>(null);
  let exportText = $state("");
  let importText = $state("");
  let importResult = $state<ImportProfilesResponse | null>(null);
  let lastLoadedProfileId = $state<string | null>(null);
  let form = $state(makeBlankForm());

  function makeBlankForm() {
    return {
      id: "",
      name: "",
      buildPath: "",
      modelPath: "",
      host: "0.0.0.0",
      port: 8085,
      ctxSize: 8192,
      gpuLayers: "all",
      devicesText: "",
      splitMode: "",
      tensorSplit: "",
      cacheTypeK: "",
      cacheTypeV: "",
      flashAttention: true,
      batchSize: 512,
      ubatchSize: 128,
      parallel: 1,
      threads: 8,
      threadsBatch: 8,
      contBatching: true,
      metrics: true,
      webui: true,
      extraArgsText: ""
    };
  }

  function loadProfile(profile: RuntimeProfile | null): void {
    if (!profile) {
      form = makeBlankForm();
      mode = "create";
      lastLoadedProfileId = null;
      return;
    }

    const args = profile.llamaArgs ?? {};
    form = {
      id: profile.id,
      name: profile.name,
      buildPath: profile.buildPath,
      modelPath: profile.modelPath,
      host: profile.host,
      port: profile.port,
      ctxSize: args.ctxSize ?? 8192,
      gpuLayers: `${args.gpuLayers ?? "all"}`,
      devicesText: (args.devices ?? []).join("\n"),
      splitMode: args.splitMode ?? "",
      tensorSplit: args.tensorSplit ?? "",
      cacheTypeK: args.cacheTypeK ?? "",
      cacheTypeV: args.cacheTypeV ?? "",
      flashAttention: args.flashAttention ?? true,
      batchSize: args.batchSize ?? 512,
      ubatchSize: args.ubatchSize ?? 128,
      parallel: args.parallel ?? 1,
      threads: args.threads ?? 8,
      threadsBatch: args.threadsBatch ?? 8,
      contBatching: args.contBatching ?? true,
      metrics: args.metrics ?? true,
      webui: args.webui ?? true,
      extraArgsText: (profile.extraArgs ?? []).join("\n")
    };
    mode = "edit";
    validation = null;
    snippets = null;
    lastLoadedProfileId = profile.id;
  }

  function lines(value: string): string[] {
    return value.split(/[\r\n,]+/gu).map((line) => line.trim()).filter(Boolean);
  }

  function optionalString(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  function numberValue(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  function buildPayload(): Partial<RuntimeProfile> {
    const llamaArgs: LlamaCppArgs = {
      ctxSize: numberValue(form.ctxSize),
      gpuLayers: `${form.gpuLayers}`.trim() === "all" ? "all" : numberValue(form.gpuLayers),
      devices: lines(form.devicesText),
      splitMode: optionalString(form.splitMode),
      tensorSplit: optionalString(form.tensorSplit),
      cacheTypeK: optionalString(form.cacheTypeK),
      cacheTypeV: optionalString(form.cacheTypeV),
      flashAttention: form.flashAttention,
      batchSize: numberValue(form.batchSize),
      ubatchSize: numberValue(form.ubatchSize),
      parallel: numberValue(form.parallel),
      threads: numberValue(form.threads),
      threadsBatch: numberValue(form.threadsBatch),
      contBatching: form.contBatching,
      metrics: form.metrics,
      webui: form.webui
    };

    return {
      id: form.id.trim() || undefined,
      name: form.name.trim(),
      runtimeType: "llama.cpp",
      providerKind: "server",
      buildPath: form.buildPath.trim(),
      modelPath: form.modelPath.trim(),
      host: form.host.trim(),
      port: Number(form.port),
      llamaArgs,
      extraArgs: lines(form.extraArgsText)
    };
  }

  async function saveProfile(): Promise<void> {
    await runAction(mode === "create" ? "profile-create" : "profile-save", async () => {
      const response = await fetchJson<ProfileMutationResponse>(mode === "create" ? "/api/profiles" : `/api/profiles/${encodeURIComponent(selectedProfileId)}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload())
      });
      validation = response.validation;
      setValidation(response.validation);
      setCommand(response.command ?? null);
      await onProfilesChanged();
      setSelectedProfileId(response.profile.id);
      setActionMessage(mode === "create" ? "Draft profile saved. llama.cpp was not started." : "Profile saved. Changes apply on next start.");
    });
  }

  async function validateDraft(): Promise<void> {
    if (mode === "create") {
      await saveProfile();
      return;
    }
    await runAction("profile-validate", async () => {
      validation = await fetchJson<ProfileValidationResponse>(`/api/profiles/${encodeURIComponent(selectedProfileId)}/validate`, { method: "POST" });
      setValidation(validation);
      setActionMessage(validation.valid ? "Profile draft shape is valid." : "Profile has blocking errors.");
    });
  }

  async function duplicateProfile(): Promise<void> {
    if (!selectedProfile) return;
    await runAction("profile-duplicate", async () => {
      const response = await fetchJson<ProfileMutationResponse>(`/api/profiles/${encodeURIComponent(selectedProfile.id)}/duplicate`, { method: "POST" });
      await onProfilesChanged();
      setSelectedProfileId(response.profile.id);
      setCommand(response.command ?? null);
      setActionMessage("Profile duplicated. llama.cpp was not started.");
    });
  }

  async function deleteProfile(): Promise<void> {
    if (!selectedProfile || isSelectedRunning) return;
    const confirmed = window.confirm(`Delete profile '${selectedProfile.name}'? This does not stop runtimes or delete logs.`);
    if (!confirmed) return;
    await runAction("profile-delete", async () => {
      await fetchJson(`/api/profiles/${encodeURIComponent(selectedProfile.id)}`, { method: "DELETE" });
      await onProfilesChanged();
      setSelectedProfileId(profiles.find((profile) => profile.id !== selectedProfile.id)?.id ?? "");
      setCommand(null);
      setActionMessage("Profile deleted. No runtime process was stopped.");
    });
  }

  async function exportProfiles(): Promise<void> {
    await runAction("profile-export", async () => {
      const response = await fetchJson<ExportProfilesResponse>("/api/profiles/export");
      exportText = JSON.stringify(response, null, 2);
      setActionMessage("Profile export generated. It excludes runtime state and logs.");
    });
  }

  async function importProfiles(): Promise<void> {
    await runAction("profile-import", async () => {
      const parsed = JSON.parse(importText);
      importResult = await fetchJson<ImportProfilesResponse>("/api/profiles/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      await onProfilesChanged();
      setActionMessage(`Imported ${importResult.imported} profile(s); skipped ${importResult.skipped}. Existing IDs were not overwritten.`);
    });
  }

  async function loadSnippets(): Promise<void> {
    if (!selectedProfile) return;
    await runAction("profile-snippets", async () => {
      snippets = await fetchJson<ProfileConfigSnippetResponse>(`/api/profiles/${encodeURIComponent(selectedProfile.id)}/snippets`);
      setCommand(snippets.command);
      setActionMessage("Starter snippets generated for the selected profile.");
    });
  }

  async function copyText(value: string, message: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    setActionMessage(message);
  }

  async function copySnippetCommand(): Promise<void> {
    if (snippets) {
      await copyText(snippets.command.displayCommand, "llama.cpp command copied.");
    }
  }

  async function copyOpenCodeSnippet(): Promise<void> {
    if (snippets) {
      await copyText(snippets.opencodeStarterSnippet, "OpenCode starter snippet copied.");
    }
  }

  async function copyIllustriaSnippet(): Promise<void> {
    if (snippets) {
      await copyText(snippets.illustriaStarterSnippet, "Illustria starter snippet copied.");
    }
  }

  function startNewProfile(): void {
    mode = "create";
    form = makeBlankForm();
    validation = null;
    snippets = null;
  }

  $effect(() => {
    if (mode === "edit" && selectedProfile?.id !== lastLoadedProfileId) {
      loadProfile(selectedProfile);
    }
  });
</script>

<Panel tone={isSelectedRunning ? "warning" : "live"} eyebrow="Phase 5" title="Profile editor" class="profile-editor-card">
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="primary" onclick={startNewProfile} disabled={Boolean(pendingAction)}>New manual profile</ToolbarButton>
    <ToolbarButton variant="secondary" onclick={() => loadProfile(selectedProfile)} disabled={!selectedProfile || Boolean(pendingAction)}>Reset changes</ToolbarButton>
    <ToolbarButton variant="secondary" onclick={duplicateProfile} disabled={!selectedProfile || Boolean(pendingAction)}>{pendingAction === "profile-duplicate" ? "Duplicating..." : "Duplicate"}</ToolbarButton>
    <ToolbarButton variant="danger" onclick={deleteProfile} disabled={!selectedProfile || isSelectedRunning || Boolean(pendingAction)}>{pendingAction === "profile-delete" ? "Deleting..." : "Delete"}</ToolbarButton>
  </div>
  {#if isSelectedRunning}
    <p class="port-conflict-copy">This profile is currently running. Saved edits will apply the next time this profile is started.</p>
  {/if}
  <p class="helper-text">Saving profiles never starts, restarts, stops, or kills llama.cpp. Missing paths are allowed as draft warnings; start remains strict.</p>

  <div class="profile-editor-grid">
    <section class="editor-section span-2">
      <h3>Basic</h3>
      <div class="form-grid">
        <label class="form-field">ID<input bind:value={form.id} disabled={mode === "edit"} placeholder="generated-from-name" /></label>
        <label class="form-field">Name<input bind:value={form.name} placeholder="Qwen local server" /></label>
        <label class="form-field">Runtime<input value="llama.cpp" disabled /></label>
        <label class="form-field">Provider<input value="server" disabled /></label>
        <label class="form-field span-2">llama-server path<input bind:value={form.buildPath} placeholder="C:\llama.cpp\llama-server.exe" /></label>
        <label class="form-field span-2">Model path<input bind:value={form.modelPath} placeholder="D:\Models\model.gguf" /></label>
        <label class="form-field">Host<input bind:value={form.host} /></label>
        <label class="form-field">Port<input type="number" min="1" max="65535" bind:value={form.port} /></label>
      </div>
    </section>

    <section class="editor-section">
      <h3>GPU</h3>
      <div class="form-grid single">
        <label class="form-field">Devices<textarea bind:value={form.devicesText} rows="3" placeholder="CUDA0&#10;CUDA1"></textarea></label>
        <label class="form-field">GPU layers<input bind:value={form.gpuLayers} /></label>
        <label class="form-field">Split mode<input bind:value={form.splitMode} placeholder="layer" /></label>
        <label class="form-field">Tensor split<input bind:value={form.tensorSplit} placeholder="5,3" /></label>
      </div>
    </section>

    <section class="editor-section">
      <h3>Context + Batch</h3>
      <div class="form-grid single">
        <label class="form-field">Context size<input type="number" min="1" bind:value={form.ctxSize} /></label>
        <label class="form-field">Parallel<input type="number" min="1" bind:value={form.parallel} /></label>
        <label class="form-field">Batch size<input type="number" min="1" bind:value={form.batchSize} /></label>
        <label class="form-field">UBatch size<input type="number" min="1" bind:value={form.ubatchSize} /></label>
      </div>
    </section>

    <section class="editor-section">
      <h3>Cache + CPU</h3>
      <div class="form-grid single">
        <label class="form-field">Cache K<input bind:value={form.cacheTypeK} placeholder="q8_0" /></label>
        <label class="form-field">Cache V<input bind:value={form.cacheTypeV} placeholder="q8_0" /></label>
        <label class="form-field">Threads<input type="number" min="1" bind:value={form.threads} /></label>
        <label class="form-field">Threads batch<input type="number" min="1" bind:value={form.threadsBatch} /></label>
      </div>
    </section>

    <section class="editor-section">
      <h3>Server</h3>
      <div class="toggle-grid">
        <label class="checkbox-field"><input type="checkbox" bind:checked={form.flashAttention} /> Flash attention</label>
        <label class="checkbox-field"><input type="checkbox" bind:checked={form.contBatching} /> Continuous batching</label>
        <label class="checkbox-field"><input type="checkbox" bind:checked={form.metrics} /> Metrics</label>
        <label class="checkbox-field"><input type="checkbox" bind:checked={form.webui} /> Web UI</label>
      </div>
    </section>

    <section class="editor-section span-2">
      <h3>Advanced extra args</h3>
      <label class="form-field">One arg per line<textarea bind:value={form.extraArgsText} rows="5" placeholder="--timeout&#10;3600"></textarea></label>
      <p class="helper-text">Extra args are preserved as an array and appended last to the generated spawn args. They are not executed through a shell.</p>
    </section>
  </div>

  <div class="panel-actions inline-actions">
    <ToolbarButton variant="success" onclick={saveProfile} disabled={Boolean(pendingAction)}>{pendingAction === "profile-save" || pendingAction === "profile-create" ? "Saving..." : mode === "create" ? "Create draft" : "Save profile"}</ToolbarButton>
    <ToolbarButton variant="secondary" onclick={validateDraft} disabled={Boolean(pendingAction)}>{pendingAction === "profile-validate" ? "Validating..." : "Validate"}</ToolbarButton>
  </div>

  {#if validation}
    <div class="validation-grid">
      <div>
        <strong>{validation.valid ? "No blocking errors" : "Blocking errors"}</strong>
        {#if validation.errors.length}<ul class="warning-list danger-list">{#each validation.errors as error}<li>{error}</li>{/each}</ul>{:else}<p class="empty-copy">Shape is safe to save.</p>{/if}
      </div>
      <div>
        <strong>Warnings</strong>
        {#if validation.warnings.length}<ul class="warning-list">{#each validation.warnings as warning}<li>{warning}</li>{/each}</ul>{:else}<p class="empty-copy">No warnings.</p>{/if}
      </div>
    </div>
  {/if}
</Panel>

<Panel eyebrow="Import / Export" title="Portable profile JSON" class="profile-transfer-card">
  <div class="profile-transfer-grid">
    <div>
      <div class="panel-actions inline-actions">
        <ToolbarButton variant="secondary" onclick={exportProfiles} disabled={Boolean(pendingAction)}>{pendingAction === "profile-export" ? "Exporting..." : "Export profiles"}</ToolbarButton>
        <ToolbarButton variant="ghost" onclick={() => copyText(exportText, "Export JSON copied.")} disabled={!exportText}>Copy export</ToolbarButton>
      </div>
      <textarea class="folder-textarea mono-textarea" bind:value={exportText} rows="10" placeholder="Export JSON appears here"></textarea>
    </div>
    <div>
      <div class="panel-actions inline-actions">
        <ToolbarButton variant="success" onclick={importProfiles} disabled={!importText.trim() || Boolean(pendingAction)}>{pendingAction === "profile-import" ? "Importing..." : "Import append/merge"}</ToolbarButton>
      </div>
      <textarea class="folder-textarea mono-textarea" bind:value={importText} rows="10" placeholder="Paste an exported object or a profiles array"></textarea>
      {#if importResult}
        <p class="helper-text">Imported {importResult.imported}, skipped {importResult.skipped}. Created IDs: {importResult.createdProfileIds.join(", ") || "none"}</p>
        {#if importResult.errors.length}<ul class="warning-list">{#each importResult.errors as error}<li>{error}</li>{/each}</ul>{/if}
      {/if}
    </div>
  </div>
  <p class="helper-text">Import defaults to append/merge. Conflicting IDs receive new IDs; existing profiles are not replaced.</p>
</Panel>

<Panel tone="code" eyebrow="Snippets" title="Copyable starter configs" class="profile-snippets-card">
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="secondary" onclick={loadSnippets} disabled={!selectedProfile || Boolean(pendingAction)}>{pendingAction === "profile-snippets" ? "Generating..." : "Generate snippets"}</ToolbarButton>
    <ToolbarButton variant="ghost" onclick={copySnippetCommand} disabled={!snippets}>Copy command</ToolbarButton>
    <ToolbarButton variant="ghost" onclick={copyOpenCodeSnippet} disabled={!snippets}>Copy OpenCode</ToolbarButton>
    <ToolbarButton variant="ghost" onclick={copyIllustriaSnippet} disabled={!snippets}>Copy Illustria</ToolbarButton>
  </div>
  {#if snippets}
    <p class="helper-text">Endpoint: <code>{snippets.endpoint}</code>. Snippets are editable starters for OpenAI-compatible llama.cpp endpoints.</p>
    <div class="snippet-grid">
      <TerminalBlock label="llama.cpp command" lines={[snippets.command.displayCommand]} />
      <TerminalBlock label="OpenCode starter snippet" lines={[snippets.opencodeStarterSnippet]} />
      <TerminalBlock label="Illustria starter snippet" lines={[snippets.illustriaStarterSnippet]} />
    </div>
  {:else}
    <p class="empty-copy">Generate snippets for the selected profile without requiring the runtime to be running.</p>
  {/if}
</Panel>
