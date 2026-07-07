<script lang="ts">
  export let value = 0;
  export let label = "";

  $: percent = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
</script>

<div class="metric-bar" aria-label={label || "Metric"} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percent)} role="meter">
  <span style={`width: ${percent}%`}></span>
</div>

<style>
  .metric-bar {
    width: 100%;
    height: 8px;
    overflow: hidden;
    border: 1px solid rgba(133, 153, 184, 0.14);
    border-radius: 999px;
    background: rgba(5, 10, 19, 0.78);
  }

  span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #6c3ee7, #8f5cff 48%, #42d7e8);
    box-shadow: 0 0 10px rgba(143, 92, 255, 0.18);
  }
</style>
