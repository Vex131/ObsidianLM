<script lang="ts">
  import { onMount } from "svelte";
  import AppShell from "./lib/layout/AppShell.svelte";
  import DashboardPage from "./lib/pages/DashboardPage.svelte";
  import RuntimePage from "./lib/pages/RuntimePage.svelte";
  import ProfilesPage from "./lib/pages/ProfilesPage.svelte";
  import ModelsPage from "./lib/pages/ModelsPage.svelte";
  import BuildsPage from "./lib/pages/BuildsPage.svelte";
  import JobsPage from "./lib/pages/JobsPage.svelte";
  import LogsPage from "./lib/pages/LogsPage.svelte";
  import TelemetryPage from "./lib/pages/TelemetryPage.svelte";
  import SettingsPage from "./lib/pages/SettingsPage.svelte";
  import SystemPage from "./lib/pages/SystemPage.svelte";
  import { defaultShellStatus, type ShellStatusSummary, type ShellStatusTone } from "./lib/layout/shell-status";
  import { API_ENDPOINTS, fetchJson, publicFetchJson, readStoredAdminToken, type StatusResponse } from "./lib/api";
  import type { RouterRuntimeResponse } from "@obsidianlm/shared";

  const pageLabels = {
    "#dashboard": "Dashboard",
    "#runtime": "Runtime",
    "#profiles": "Profiles",
    "#models": "Models",
    "#builds": "Builds",
    "#jobs": "Jobs",
    "#logs": "Logs",
    "#telemetry": "Telemetry",
    "#settings": "Settings",
    "#system": "System"
  } as const;

  const pathRoutes: Record<string, keyof typeof pageLabels> = {
    "/": "#dashboard",
    "/dashboard": "#dashboard",
    "/runtime": "#runtime",
    "/profiles": "#profiles",
    "/models": "#models",
    "/builds": "#builds",
    "/artifacts": "#jobs",
    "/jobs": "#jobs",
    "/logs": "#logs",
    "/telemetry": "#telemetry",
    "/settings": "#settings",
    "/system": "#system"
  };

  let activeHash = "#dashboard";
  let status: StatusResponse | null = null;
  let statusRequestFailed = false;
  let routerRuntime: RouterRuntimeResponse | null = null;
  let now = Date.now();

  $: shellStatus = buildShellStatus(status, statusRequestFailed, routerRuntime, now);

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

  function runtimeSummary(runtimeStatus: RouterRuntimeResponse["routerState"]["status"] | undefined): Pick<ShellStatusSummary, "runtimeLabel" | "runtimeTone"> {
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
    currentRuntime: RouterRuntimeResponse | null,
    currentTime: number
  ): ShellStatusSummary {
    const serviceLabel = currentStatus ? "Service healthy" : requestFailed ? "Service offline" : defaultShellStatus.serviceLabel;
    const serviceTone = currentStatus ? "green" : requestFailed ? "red" : defaultShellStatus.serviceTone;
    const runtime = runtimeSummary(currentRuntime?.routerState.status);
    const portLabel = currentRuntime?.routerState.port ? String(currentRuntime.routerState.port) : (currentStatus?.managedLlamaPort ? String(currentStatus.managedLlamaPort) : "—");

    return {
      serviceLabel,
      serviceTone,
      runtimeLabel: runtime.runtimeLabel,
      runtimeTone: runtime.runtimeTone,
      portLabel,
      uptimeLabel: formatUptime(currentRuntime?.routerState.startedAt, currentTime),
      warningCount: (currentStatus?.warnings?.length ?? 0) + (currentStatus?.detection?.warnings?.length ?? 0) + (currentRuntime?.warnings?.length ?? 0) + (currentRuntime?.routerState.warnings?.length ?? 0),
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
      routerRuntime = null;
      return;
    }

    try {
      routerRuntime = await fetchJson<RouterRuntimeResponse>(API_ENDPOINTS.runtime.state);
    } catch {
      routerRuntime = null;
    }
  }

  function syncHash() {
    const hash = window.location.hash.split("?")[0];
    activeHash = hash === "#artifacts" ? "#jobs" : (hash || pathRoutes[window.location.pathname.replace(/\/+$/, "") || "/"] || "#dashboard");
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
    <DashboardPage {routerRuntime} />
  {:else if activeHash === "#runtime"}
    <RuntimePage {routerRuntime} />
  {:else if activeHash === "#profiles"}
    <ProfilesPage />
  {:else if activeHash === "#models"}
    <ModelsPage />
  {:else if activeHash === "#builds"}
    <BuildsPage />
  {:else if activeHash === "#jobs"}
    <JobsPage />
  {:else if activeHash === "#logs"}
    <LogsPage />
  {:else if activeHash === "#telemetry"}
    <TelemetryPage />
  {:else if activeHash === "#settings"}
    <SettingsPage />
  {:else if activeHash === "#system"}
    <SystemPage />
  {:else}
    <DashboardPage {routerRuntime} />
  {/if}
</AppShell>
