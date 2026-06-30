<script lang="ts">
  let {
    label,
    lines,
    empty = false
  }: {
    label: string;
    lines: string[];
    empty?: boolean;
  } = $props();
</script>

<div class="terminal-block" aria-label={label}>
  <div class="terminal-bar">
    <span>{label}</span>
    <span>{empty ? "idle" : "preview"}</span>
  </div>
  <pre class:empty><code>{lines.join("\n")}</code></pre>
</div>
