<script lang="ts">
  import InspectorPanel from "../layout/InspectorPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  let { build }: { build: any } = $props();
</script>

<InspectorPanel eyebrow="Build" title="llama.cpp tools">
  <DetailRow label="Name" value={build?.name} muted={!build} />
  <DetailRow label="Server" value={build?.serverPath} muted={!build?.serverPath} />
  <DetailRow label="Folder" value={build?.folder} muted={!build?.folder} />
  <DetailRow label="Tools" value={build?.tools?.map((tool: any) => tool.fileName).join(", ") || "--"} muted={!build?.tools?.length} />
</InspectorPanel>
