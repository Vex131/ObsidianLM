<script lang="ts">
  export let label = "";
  export let tone: "green" | "amber" | "red" | "muted" = "muted";
</script>

<span class:green={tone === "green"} class:amber={tone === "amber"} class:red={tone === "red"} class:muted={tone === "muted"} class="status-badge">
  <span aria-hidden="true"></span>
  {label}
</span>

<style>
  .status-badge {
    --badge-color: #8b98ad;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 24px;
    padding: 0 9px;
    border: 1px solid color-mix(in srgb, var(--badge-color) 34%, transparent);
    border-radius: 999px;
    color: #dce5f3;
    background: color-mix(in srgb, var(--badge-color) 12%, transparent);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .status-badge > span {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--badge-color);
    box-shadow: 0 0 14px color-mix(in srgb, var(--badge-color) 70%, transparent);
  }

  .green {
    --badge-color: var(--color-green);
  }

  .amber {
    --badge-color: var(--color-amber);
  }

  .red {
    --badge-color: var(--color-red);
  }

  .muted {
    --badge-color: #8b98ad;
  }
</style>
