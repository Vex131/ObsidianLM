<script lang="ts">
  export let tone: "green" | "amber" | "red" | "muted" = "green";
</script>

<span class:green={tone === "green"} class:amber={tone === "amber"} class:red={tone === "red"} class:muted={tone === "muted"}></span>

<style>
  span {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--color-dim);
    box-shadow: none;
  }

  .green {
    background: var(--color-green);
    box-shadow: 0 0 12px rgba(89, 220, 122, 0.62), 0 0 0 3px rgba(89, 220, 122, 0.1);
  }

  .amber {
    background: #f5be55;
    box-shadow: 0 0 10px rgba(245, 190, 85, 0.42), 0 0 0 3px rgba(245, 190, 85, 0.08);
  }

  .red {
    background: #ff6b7a;
    box-shadow: 0 0 10px rgba(255, 107, 122, 0.42), 0 0 0 3px rgba(255, 107, 122, 0.08);
  }

  .muted {
    background: #586276;
    box-shadow: none;
  }
</style>
