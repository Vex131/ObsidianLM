<script lang="ts">
  let { label, value }: { label: string; value: string | null | undefined } = $props();
</script>

<div class="path-field">
  <span>{label}</span>
  <code>{value || "--"}</code>
</div>
