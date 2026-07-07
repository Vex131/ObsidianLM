<script lang="ts">
  import PageHeader from "../components/PageHeader.svelte";
  import type { RuntimeState, StatusResponse } from "../api";
  import { defaultShellStatus, type ShellStatusSummary } from "../layout/shell-status";

  export let shellStatus: ShellStatusSummary = defaultShellStatus;
  export let status: StatusResponse | null = null;
  export let runtimeState: RuntimeState | null = null;
  export let runtimeWarnings: string[] = [];
</script>

<main class="page-surface dashboard-page" aria-label="Dashboard">
  <PageHeader
    title="Dashboard"
    subtitle="Control and monitor your local llama.cpp runtimes with precision."
  />
</main>

<style>
  .dashboard-page {
    height: calc(100vh - var(--topbar-height));
  }
</style>
