<script lang="ts">
  let { tone = "unknown", label }: { tone?: string; label: string } = $props();
</script>

<span class={`status-badge status-${tone}`}>
  <span aria-hidden="true"></span>
  {label}
</span>
