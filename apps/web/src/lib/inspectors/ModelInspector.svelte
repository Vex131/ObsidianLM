<script lang="ts">
  import InspectorPanel from "../layout/InspectorPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  let { model, formatBytes, formatDate }: { model: any; formatBytes: (n: number) => string; formatDate: (v: string) => string } = $props();
</script>

<InspectorPanel eyebrow="Model" title="Selected GGUF">
  <DetailRow label="Name" value={model?.name ?? model?.fileName} muted={!model} />
  <DetailRow label="Size" value={model ? formatBytes(model.sizeBytes) : "--"} muted={!model} />
  <DetailRow label="Modified" value={model ? formatDate(model.modifiedAt) : "--"} muted={!model} />
  <DetailRow label="Path" value={model?.path} muted={!model?.path} />
</InspectorPanel>
