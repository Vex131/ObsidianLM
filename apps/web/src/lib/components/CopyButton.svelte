<script lang="ts">
  import ToolbarButton from "./ToolbarButton.svelte";
  let { value, label = "Copy" }: { value: string; label?: string } = $props();
  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(value);
  }
</script>

<ToolbarButton variant="ghost" onclick={copy} disabled={!value}>{label}</ToolbarButton>
