<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="LLAMA.CPP BUILDS" title="Discovered builds and tools" subtitle="Inspect local llama.cpp executables without running detected files." />
<SectionPanel eyebrow="Builds" title="llama.cpp inventory">
  <div class="table-toolbar"><ToolbarButton variant="secondary" onclick={actions.rescanBuilds} disabled={Boolean(data.pendingAction)}>{data.pendingAction === "rescan-builds" ? "Scanning..." : "Rescan builds"}</ToolbarButton></div>
  <div class="discovery-list table-list">
    {#each data.discoveredBuilds as build}
      <button class={`discovery-item ${data.selectedBuildPath === build.serverPath ? "selected" : ""}`} type="button" onclick={() => actions.selectBuild(build.serverPath)}>
        <strong>{build.name}</strong><span>{build.folder}</span><small>Tools: {build.tools.map((tool: any) => tool.fileName).join(", ")}</small><code>{build.serverPath}</code>
      </button>
    {:else}<p class="empty-copy">No llama-server executable found in configured folders.</p>{/each}
  </div>
</SectionPanel>
