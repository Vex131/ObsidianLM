<script lang="ts">
  import InspectorPanel from "../layout/InspectorPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  let { data }: { data: any } = $props();
</script>

<InspectorPanel eyebrow="Inspector" title="Runtime facts">
  <DetailRow label="Endpoint" value={data.apiUrl} />
  <DetailRow label="PID" value={data.status?.activeRuntime?.pid} muted={!data.status?.activeRuntime?.pid} />
  <DetailRow label="Profile" value={data.status?.activeRuntime?.profileName ?? data.selectedProfile?.name} muted={!data.status?.activeRuntime && !data.selectedProfile} />
  <DetailRow label="Model" value={data.selectedProfile?.modelPath} muted={!data.selectedProfile?.modelPath} />
  <DetailRow label="Build" value={data.selectedProfile?.buildPath} muted={!data.selectedProfile?.buildPath} />
  <DetailRow label="Validation" value={data.validation ? (data.validation.valid ? "Valid" : "Failed") : "Not checked"} muted={!data.validation} />
</InspectorPanel>
