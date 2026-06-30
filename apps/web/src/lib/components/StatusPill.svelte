<script lang="ts">
  type StatusTone = "online" | "offline" | "warning" | "danger" | "unknown";

  let {
    tone = "unknown",
    label
  }: {
    tone?: StatusTone;
    label: string;
  } = $props();
</script>

<span class={`status-pill status-${tone}`}>
  <span class="status-dot" aria-hidden="true"></span>
  {label}
</span>
