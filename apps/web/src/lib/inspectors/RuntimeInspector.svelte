<script lang="ts">
  import InspectorPanel from "../layout/InspectorPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  let { data }: { data: any } = $props();
</script>

<InspectorPanel eyebrow="Managed server" title="Runtime inspector">
  <DetailRow label="Active profile" value={data.selectedProfile?.name ?? data.status?.activeRuntime?.profileName} muted={!data.selectedProfile && !data.status?.activeRuntime} />
  <DetailRow label="Model path" value={data.selectedProfile?.modelPath} muted={!data.selectedProfile?.modelPath} />
  <DetailRow label="Build path" value={data.selectedProfile?.buildPath} muted={!data.selectedProfile?.buildPath} />
  <DetailRow label="Host" value={data.selectedProfile?.host ?? "127.0.0.1"} />
  <DetailRow label="Port" value={data.portStatus?.port?.port ?? data.selectedProfile?.port ?? data.status?.managedLlamaPort} />
  <DetailRow label="PID" value={data.status?.activeRuntime?.pid} muted={!data.status?.activeRuntime?.pid} />
  <DetailRow label="Command hash" value={data.runtime?.commandHash ?? data.command?.commandHash} muted={!data.runtime?.commandHash && !data.command?.commandHash} />
</InspectorPanel>
