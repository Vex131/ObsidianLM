<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  import CommandPreview from "../components/CommandPreview.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="MODEL LIBRARY" title="Discovered GGUF models" subtitle="Browse local model files discovered from configured folders." />
<SectionPanel eyebrow="Models" title="Local GGUF inventory">
  <div class="table-toolbar"><ToolbarButton variant="secondary" onclick={actions.rescanModels} disabled={Boolean(data.pendingAction)}>{data.pendingAction === "rescan-models" ? "Scanning..." : "Rescan models"}</ToolbarButton></div>
  <div class="discovery-list table-list">
    {#each data.discoveredModels as model}
      <button class={`discovery-item ${data.selectedModelPath === model.path ? "selected" : ""}`} type="button" onclick={() => actions.selectModel(model.path)}>
        <strong>{model.name}</strong><span>{model.folder}</span><small>{data.formatBytes(model.sizeBytes)} | modified {data.formatDate(model.modifiedAt)}</small><code>{model.path}</code>
      </button>
    {:else}<p class="empty-copy">No .gguf models found in configured folders.</p>{/each}
  </div>
</SectionPanel>

<SectionPanel tone="live" eyebrow="Create profile" title="Selected model + build">
  <div class="runtime-hero-metrics">
    <DetailRow label="Model" value={data.selectedModel?.fileName ?? "None selected"} muted={!data.selectedModel} />
    <DetailRow label="Build" value={data.selectedBuild?.name ?? "None selected"} muted={!data.selectedBuild} />
  </div>
  <div class="form-grid">
    <label class="form-field">Profile name<input bind:value={data.profileForm.name} placeholder={data.selectedModel && data.selectedBuild ? `${data.selectedModel.name} ${data.selectedBuild.name}` : "Qwen local profile"} /></label>
    <label class="form-field">Host<input bind:value={data.profileForm.host} /></label>
    <label class="form-field">Port<input type="number" bind:value={data.profileForm.port} min="1" max="65535" /></label>
    <label class="form-field">Context<input type="number" bind:value={data.profileForm.ctxSize} min="1" /></label>
    <label class="form-field">GPU layers<input bind:value={data.profileForm.gpuLayers} /></label>
    <label class="form-field">Batch<input type="number" bind:value={data.profileForm.batchSize} min="1" /></label>
    <label class="form-field">UBatch<input type="number" bind:value={data.profileForm.ubatchSize} min="1" /></label>
    <label class="form-field">Threads<input type="number" bind:value={data.profileForm.threads} min="1" /></label>
    <label class="form-field">Threads batch<input type="number" bind:value={data.profileForm.threadsBatch} min="1" /></label>
    <label class="checkbox-field"><input type="checkbox" bind:checked={data.profileForm.flashAttention} /> Flash attention</label>
  </div>
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="success" onclick={actions.createProfileFromSelection} disabled={!data.selectedModel || !data.selectedBuild || Boolean(data.pendingAction)}>{data.pendingAction === "create-profile" ? "Creating..." : "Create profile"}</ToolbarButton>
  </div>
  <p class="helper-text">Creating a profile appends to profile storage, validates through the profile path, and does not start llama.cpp.</p>
  {#if data.createdProfilePreview}
    <CommandPreview label="created profile command" lines={[data.createdProfilePreview.displayCommand]} />
  {/if}
</SectionPanel>
