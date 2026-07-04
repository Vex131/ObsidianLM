<script lang="ts">
  import InspectorPanel from "../layout/InspectorPanel.svelte";
  import DetailRow from "../components/DetailRow.svelte";
  import CommandPreview from "../components/CommandPreview.svelte";
  import ValidationChecklist from "../components/ValidationChecklist.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<InspectorPanel eyebrow="Launch config" title="Profile inspector">
  <ValidationChecklist validation={data.validation} />
  <DetailRow label="Selected" value={data.selectedProfile?.name} muted={!data.selectedProfile} />
  <DetailRow label="Restart" value="Required after profile edits" />
  <CommandPreview label={data.command?.executable ?? "llama-server.exe"} lines={data.commandLines} onCopy={actions.copyCommand} />
  <section class="change-summary">
    <h3>Change summary</h3>
    <p>Profile edits are saved to profile storage and apply on the next managed runtime start.</p>
  </section>
</InspectorPanel>
