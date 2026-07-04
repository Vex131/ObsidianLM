<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PageId } from "../navigation";
  import SidebarNav from "./SidebarNav.svelte";
  import TopStatusStrip from "./TopStatusStrip.svelte";

  let {
    activePage,
    runtimeStatus,
    runtimeTone,
    serviceLabel,
    serviceState,
    port,
    uptime,
    isLoading,
    authPendingAction,
    onRefresh,
    onLogout,
    inspector,
    children
  }: {
    activePage: PageId;
    runtimeStatus: string;
    runtimeTone: string;
    serviceLabel: string;
    serviceState: string;
    port: string;
    uptime?: string;
    isLoading: boolean;
    authPendingAction: string | null;
    onRefresh: () => Promise<void> | void;
    onLogout: () => Promise<void> | void;
    inspector?: Snippet;
    children?: Snippet;
  } = $props();
</script>

<main class="operator-shell">
  <SidebarNav {activePage} {runtimeStatus} {runtimeTone} />
  <section class="operator-workspace">
    <TopStatusStrip
      {serviceLabel}
      {serviceState}
      {runtimeStatus}
      {runtimeTone}
      {port}
      {uptime}
      {isLoading}
      {authPendingAction}
      {onRefresh}
      {onLogout}
    />
    <div class="operator-content">
      {@render children?.()}
    </div>
  </section>
  {#if inspector}
    <aside class="operator-inspector-shell" aria-label="Page inspector">
      {@render inspector()}
    </aside>
  {/if}
</main>
