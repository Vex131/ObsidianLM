<script lang="ts">
  let {
    label,
    value,
    muted = false
  }: {
    label: string;
    value: string | number;
    muted?: boolean;
  } = $props();
</script>

<div class="metric-row">
  <span>{label}</span>
  <strong class:muted>{value}</strong>
</div>
