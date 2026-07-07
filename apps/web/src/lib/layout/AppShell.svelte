<script lang="ts">
  import Sidebar from "./Sidebar.svelte";
  import TopHeader from "./TopHeader.svelte";
  import { defaultShellStatus, type ShellStatusSummary } from "./shell-status";

  export let activeHash = "#dashboard";
  export let shellStatus: ShellStatusSummary = defaultShellStatus;
</script>

<div class="app-shell">
  <Sidebar {activeHash} {shellStatus} />
  <div class="app-main-column">
    <TopHeader {shellStatus} />
    <section class="app-content">
      <slot />
    </section>
  </div>
</div>

<style>
  .app-shell {
    height: 100vh;
    min-height: 0;
    display: grid;
    grid-template-columns: var(--sidebar-width) minmax(0, 1fr);
    overflow: hidden;
    background: transparent;
  }

  .app-shell > :global(.sidebar) {
    grid-row: 1 / -1;
  }

  .app-main-column {
    grid-column: 2;
    grid-row: 1 / -1;
    min-width: 0;
    height: 100vh;
    display: grid;
    grid-template-rows: var(--topbar-height) minmax(0, 1fr);
    background: transparent;
    overflow: hidden;
  }

  .app-content {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: transparent;
  }

  @media (max-width: 1120px) {
    .app-shell {
      grid-template-columns: 86px minmax(0, 1fr);
    }
  }

  @media (max-width: 720px) {
    .app-shell {
      min-height: 100vh;
      height: auto;
      grid-template-columns: minmax(0, 1fr);
    }

    .app-main-column {
      grid-column: 1;
      height: auto;
      min-height: 100vh;
    }

    .app-shell > :global(.sidebar) {
      display: none;
    }
  }
</style>
