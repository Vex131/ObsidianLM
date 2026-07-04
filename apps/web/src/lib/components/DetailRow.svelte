<script lang="ts">
  let { label, value, muted = false }: { label: string; value: string | number | null | undefined; muted?: boolean } = $props();
</script>

<div class={`detail-row ${muted ? "muted" : ""}`}>
  <span>{label}</span>
  <code>{value ?? "--"}</code>
</div>
