<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./lib/layout/AppShell.svelte";
  import DashboardPage from "./lib/pages/DashboardPage.svelte";
  import PlaceholderPage from "./lib/pages/PlaceholderPage.svelte";
  import { defaultShellStatus, type ShellStatusSummary, type ShellStatusTone } from "./lib/layout/shell-status";
  import { API_ENDPOINTS, fetchJson, publicFetchJson, readStoredAdminToken, type RuntimeState, type StatusResponse } from "./lib/api";

  type RuntimeStateResponse = {
    state: RuntimeState;
    warnings: string[];
  };

  const pageLabels = {
    "#dashboard": "Dashboard",
    "#runtime": "Runtime",
    "#profiles": "Profiles",
    "#models": "Models",
    "#builds": "Builds",
    "#artifacts": "Artifacts",
    "#logs": "Logs",
    "#telemetry": "Telemetry",
    "#settings": "Settings",
    "#system": "System"
  } as const;

  let activeHash = "#dashboard";
  let status: StatusResponse | null = null;
  let statusRequestFailed = false;
  let runtimeState: RuntimeState | null = null;
  let runtimeWarnings: string[] = [];
  let now = Date.now();

  $: currentPageLabel = pageLabels[activeHash as keyof typeof pageLabels] ?? "Dashboard";
  $: shellStatus = buildShellStatus(status, statusRequestFailed, runtimeState, now);

  function parsePortLabel(apiUrl: string | null | undefined): string | null {
    if (!apiUrl) {
      return null;
    }

    try {
      const parsed = new URL(apiUrl);
      return parsed.port || null;
    } catch {
      return null;
    }
  }

  function formatUptime(startedAt: string | null | undefined, currentTime: number): string {
    if (!startedAt) {
      return "—";
    }

    const startedTime = new Date(startedAt).getTime();
    if (Number.isNaN(startedTime)) {
      return "—";
    }

    const totalSeconds = Math.max(0, Math.floor((currentTime - startedTime) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (value: number) => String(value).padStart(2, "0");

    return `${pad(hours)}h ${pad(minutes)}m ${pad(seconds)}s`;
  }

  function runtimeSummary(runtimeStatus: RuntimeState["status"] | NonNullable<StatusResponse["activeRuntime"]>["status"] | undefined): Pick<ShellStatusSummary, "runtimeLabel" | "runtimeTone"> {
    const normalizedStatus = runtimeStatus ?? "stopped";
    const toneByStatus: Record<string, ShellStatusTone> = {
      running: "green",
      starting: "amber",
      stopping: "amber",
      failed: "red",
      exited: "red",
      stopped: "muted",
      unknown_previous_runtime: "muted"
    };
    const labelByStatus: Record<string, string> = {
      running: "Runtime running",
      starting: "Runtime starting",
      stopping: "Runtime stopping",
      failed: "Runtime failed",
      exited: "Runtime exited",
      stopped: "Runtime stopped",
      unknown_previous_runtime: "Runtime stopped"
    };

    return {
      runtimeLabel: labelByStatus[normalizedStatus] ?? "Runtime stopped",
      runtimeTone: toneByStatus[normalizedStatus] ?? "muted"
    };
  }

  function buildShellStatus(
    currentStatus: StatusResponse | null,
    requestFailed: boolean,
    currentRuntime: RuntimeState | null,
    currentTime: number
  ): ShellStatusSummary {
    const serviceLabel = currentStatus ? "Service healthy" : requestFailed ? "Service offline" : defaultShellStatus.serviceLabel;
    const serviceTone = currentStatus ? "green" : requestFailed ? "red" : defaultShellStatus.serviceTone;
    const runtime = runtimeSummary(currentRuntime?.status ?? currentStatus?.activeRuntime?.status);
    const portLabel = parsePortLabel(currentStatus?.activeRuntime?.apiUrl) ?? (currentStatus?.managedLlamaPort ? String(currentStatus.managedLlamaPort) : "—");

    return {
      serviceLabel,
      serviceTone,
      runtimeLabel: runtime.runtimeLabel,
      runtimeTone: runtime.runtimeTone,
      portLabel,
      uptimeLabel: formatUptime(currentRuntime?.startedAt, currentTime),
      warningCount: (currentStatus?.warnings?.length ?? 0) + (currentStatus?.detection?.warnings?.length ?? 0),
      versionLabel: currentStatus?.version ? `v${currentStatus.version.replace(/^v/, "")}` : defaultShellStatus.versionLabel
    };
  }

  async function refreshShellStatus() {
    try {
      status = await publicFetchJson<StatusResponse>(API_ENDPOINTS.status);
      statusRequestFailed = false;
    } catch {
      status = null;
      statusRequestFailed = true;
    }

    if (!readStoredAdminToken()) {
      runtimeState = null;
      runtimeWarnings = [];
      return;
    }

    try {
      const runtimeResponse = await fetchJson<RuntimeStateResponse>(API_ENDPOINTS.runtime.state);
      runtimeState = runtimeResponse.state;
      runtimeWarnings = runtimeResponse.warnings ?? [];
    } catch {
      runtimeState = null;
      runtimeWarnings = [];
    }
  }

  function syncHash() {
    activeHash = window.location.hash || "#dashboard";
  }

  onMount(() => {
    syncHash();
    void refreshShellStatus();
    window.addEventListener("hashchange", syncHash);
    const statusInterval = window.setInterval(() => void refreshShellStatus(), 5000);
    const uptimeInterval = window.setInterval(() => {
      now = Date.now();
    }, 1000);

    return () => {
      window.removeEventListener("hashchange", syncHash);
      window.clearInterval(statusInterval);
      window.clearInterval(uptimeInterval);
    };
  });
</script>

<svelte:head>
  <title>ObsidianLM Operator Console</title>
</svelte:head>

<AppShell {activeHash} {shellStatus}>
  {#if activeHash === "#dashboard"}
    <DashboardPage {shellStatus} {status} {runtimeState} {runtimeWarnings} />
  {:else}
    <PlaceholderPage title={currentPageLabel} />
  {/if}
</AppShell>
