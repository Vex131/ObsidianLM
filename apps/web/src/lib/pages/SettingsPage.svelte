<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";
  let { data, actions, modelFoldersText = $bindable(), llamaCppFoldersText = $bindable(), toolInputFoldersText = $bindable() }: any = $props();
</script>

<PageHeader eyebrow="SETTINGS" title="App configuration" subtitle="Manage low-frequency local discovery and session settings." />
<SectionPanel tone="warning" eyebrow="Discovery folders" title="Local scan roots">
  <label class="field-label" for="model-folders">Model folders</label>
  <textarea id="model-folders" class="folder-textarea" bind:value={modelFoldersText} placeholder="D:\Models" rows="4"></textarea>
  <label class="field-label" for="build-folders">llama.cpp build folders</label>
  <textarea id="build-folders" class="folder-textarea" bind:value={llamaCppFoldersText} placeholder="C:\llama.cpp" rows="4"></textarea>
  <label class="field-label" for="tool-input-folders">Tool input folders</label>
  <textarea id="tool-input-folders" class="folder-textarea" bind:value={toolInputFoldersText} placeholder="D:\Datasets" rows="4"></textarea>
  <div class="panel-actions inline-actions"><ToolbarButton variant="secondary" onclick={actions.saveDiscoveryFolders} disabled={Boolean(data.pendingAction)}>{data.pendingAction === "save-discovery-folders" ? "Saving..." : "Save discovery folders"}</ToolbarButton></div>
  <p class="helper-text">Only these folders are scanned. Missing folders are saved but reported as warnings during discovery.</p>
</SectionPanel>
