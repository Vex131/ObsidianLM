<script lang="ts">
  export let title = "";
  export let subtitle = "";
</script>

<header class="page-header">
  {#if title}
    <h1 class="page-title">{title}</h1>
  {/if}

  {#if subtitle}
    <p class="page-subtitle">{subtitle}</p>
  {/if}
</header>
