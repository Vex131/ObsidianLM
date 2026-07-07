<script lang="ts">
  export let label = "";
  export let value: string | number | null | undefined = "";
</script>

<div class="detail-row">
  <dt>{label}</dt>
  <dd>{value ?? "-"}</dd>
</div>

<style>
  .detail-row {
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(96px, 0.45fr) minmax(0, 1fr);
    gap: 14px;
    align-items: baseline;
    padding: 10px 0;
    border-bottom: 1px solid rgba(133, 153, 184, 0.1);
  }

  .detail-row:last-child {
    border-bottom: 0;
  }

  dt,
  dd {
    margin: 0;
  }

  dt {
    color: #7d8aa1;
    font-size: 12px;
    font-weight: 750;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  dd {
    min-width: 0;
    overflow: hidden;
    color: #dce5f3;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
