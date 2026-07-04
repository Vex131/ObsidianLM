<script lang="ts">
  import { navItems, pageHash, type PageId } from "../navigation";

  let { activePage, runtimeStatus, runtimeTone }: { activePage: PageId; runtimeStatus: string; runtimeTone: string } = $props();

  const groups = ["CORE", "LIBRARY", "OBSERVABILITY", "SYSTEM"] as const;
</script>

<aside class="operator-sidebar" aria-label="Primary navigation">
  <div class="brand-block compact-brand">
    <div class="brand-mark" aria-hidden="true">OLM</div>
    <div>
      <strong>ObsidianLM</strong>
      <span>Operator</span>
    </div>
  </div>

  <nav class="operator-nav">
    {#each groups as group}
      <section class="nav-group" aria-label={group}>
        <p>{group}</p>
        {#each navItems.filter((item) => item.group === group) as item}
          <a class={`operator-nav-item ${activePage === item.id ? "active" : ""}`} href={pageHash(item.id)} aria-current={activePage === item.id ? "page" : undefined}>
            <span>{item.label}</span>
            {#if item.id === "runtime"}
              <span class={`status-dot status-${runtimeTone}`} aria-label={`Runtime ${runtimeStatus}`}></span>
            {/if}
          </a>
        {/each}
      </section>
    {/each}
  </nav>
</aside>
