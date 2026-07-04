<script lang="ts">
  import StatusBadge from "../components/StatusBadge.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";

  let {
    serviceLabel,
    serviceState,
    runtimeStatus,
    runtimeTone,
    port,
    uptime,
    isLoading,
    authPendingAction,
    onRefresh,
    onLogout
  }: {
    serviceLabel: string;
    serviceState: string;
    runtimeStatus: string;
    runtimeTone: string;
    port: string;
    uptime?: string;
    isLoading: boolean;
    authPendingAction: string | null;
    onRefresh: () => Promise<void> | void;
    onLogout: () => Promise<void> | void;
  } = $props();
</script>

<div class="top-status-strip" aria-live="polite">
  <div class="status-strip-left">
    <StatusBadge tone={serviceState} label={serviceLabel} />
    <StatusBadge tone={runtimeTone} label={`Runtime ${runtimeStatus}`} />
    <span class="mono-chip">Port {port}</span>
    <span class="mono-chip">Uptime {uptime ?? "--"}</span>
  </div>
  <div class="status-strip-actions">
    <ToolbarButton variant="ghost" onclick={onRefresh} disabled={isLoading} title="Refresh operator state">{isLoading ? "Checking..." : "Refresh"}</ToolbarButton>
    <ToolbarButton variant="ghost" onclick={onLogout} disabled={authPendingAction === "logout"} title="Clear saved admin token">{authPendingAction === "logout" ? "Logging out..." : "Logout"}</ToolbarButton>
  </div>
</div>
