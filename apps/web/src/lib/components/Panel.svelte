<script lang="ts">
  export let title = "";
  export let flushHeader = false;
  export let bodyClass = "";
</script>

<section class="panel">
  {#if title || $$slots.title}
    <header class:flushHeader class="panel-header">
      <slot name="title">
        <h2 class="panel-title">{title}</h2>
      </slot>
    </header>
  {/if}
  <div class="panel-body {bodyClass}">
    <slot />
  </div>
</section>

<style>
  .panel {
    position: relative;
    min-width: 0;
    min-height: 0;
    border: 1px solid rgba(133, 153, 184, 0.24);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(18, 29, 47, 0.96), rgba(12, 20, 34, 0.98));
    box-shadow:
      0 22px 80px rgba(0, 0, 0, 0.42),
      inset 0 1px 0 rgba(255, 255, 255, 0.035);
    overflow: hidden;
  }

  .panel-header {
    padding: 0;
    border: 0;
    background: transparent;
  }

  .panel-header.flushHeader {
    padding: 0;
  }

  .panel-title,
  :global(.panel-header) h2 {
    margin: 0;
    color: #c7d0df;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.1em;
    font-weight: 900;
    line-height: 1;
  }

  .panel-body {
    height: 100%;
    min-height: 0;
  }
</style>
