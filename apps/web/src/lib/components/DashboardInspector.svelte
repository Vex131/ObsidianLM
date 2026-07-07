<script lang="ts">
  import Icon from "./Icon.svelte";
  import DetailRow from "./DetailRow.svelte";
  import ActionButton from "./ActionButton.svelte";
  import { extractModelFileType, formatDateTime, formatNumber, type InspectorEndpointHealth } from "../dashboard/dashboard-format";
  import { emptyDashboardInspectorData, type DashboardInspectorData } from "../dashboard/dashboard-data";
  import type { RuntimeState } from "../api";
  import type { RuntimeProfile } from "@obsidianlm/shared";

  export let inspectorData: DashboardInspectorData = emptyDashboardInspectorData;
  export let inspectorHealth: InspectorEndpointHealth = "muted";
  export let inspectorHealthLabel = "";
  export let inspectorHealthTone: "green" | "amber" | "red" | "muted" = "muted";
  export let endpointLabel = "";
  export let pidLabel = "";
  export let uptimeLabel = "";
  export let runtimeState: RuntimeState | null = null;
  export let activeProfile: RuntimeProfile | null = null;
  export let warnings: string[] = [];

  $: profile = inspectorData.profile ?? activeProfile ?? null;
  $: validation = inspectorData.validation ?? null;
  $: hasProfile = !!profile;
  $: modelPath = profile?.modelPath ?? "";
  $: modelFileType = extractModelFileType(modelPath);
  $: buildPath = profile?.buildPath ?? "";
  $: runtimeRunning = runtimeState?.status === "running";
  $: modelLoaded = runtimeRunning && hasProfile && !!activeProfile?.modelPath;
  $: endpointHealth = inspectorHealth;
  $: endpointHealthTone = inspectorHealthTone;
  $: endpointHealthLabel = inspectorHealthLabel;

  $: validationRows = buildValidationRows(validation, warnings);

  type ValidationRow = { label: string; status: "ok" | "warning" | "error" | "empty"; detail: string };

  function buildValidationRows(
    validation: { valid?: boolean; errors?: string[]; warnings?: string[] } | null,
    detectionWarnings: string[]
  ): ValidationRow[] {
    const rows: ValidationRow[] = [
      { label: "Runtime binary", status: "empty", detail: "" },
      { label: "Model file", status: "empty", detail: "" },
      { label: "Port availability", status: "empty", detail: "" },
      { label: "GPU compatibility", status: "empty", detail: "" },
      { label: "Dependencies", status: "empty", detail: "" }
    ];

    if (!validation) {
      const hasDetectionWarnings = detectionWarnings.length > 0;
      if (hasDetectionWarnings) {
        for (const row of rows) {
          if (row.status === "empty") {
            row.status = "warning";
            row.detail = "Detection warnings present";
            break;
          }
        }
      }
      return rows;
    }

    const errors = validation.errors ?? [];
    const warnings_list = validation.warnings ?? [];

    for (let i = 0; i < rows.length; i++) {
      if (i < errors.length) {
        rows[i].status = "error";
        rows[i].detail = errors[i];
      } else if (i < warnings_list.length) {
        rows[i].status = "warning";
        rows[i].detail = warnings_list[i];
      } else if (validation.valid) {
        rows[i].status = "ok";
        rows[i].detail = "OK";
      }
    }

    return rows;
  }
</script>

<section class="inspector">
  <div class="inspector-header">
    <h2>INSPECTOR</h2>
    <Icon name="chevron" size={14} />
  </div>

  <div class="inspector-sections">
    <div class="inspector-section">
      <h3>Endpoint</h3>
      <dl class="inspector-details">
        <DetailRow label="URL" value={endpointLabel} />
        <DetailRow label="Health" value={endpointHealthLabel} />
      </dl>
    </div>

    <div class="inspector-section">
      <h3>Process</h3>
      <dl class="inspector-details">
        <DetailRow label="PID" value={pidLabel} />
        <DetailRow label="Uptime" value={uptimeLabel} />
        <DetailRow label="Started" value={formatDateTime(runtimeState?.startedAt)} />
        <DetailRow label="User" value="operator" />
        <DetailRow label="Priority" value="Normal" />
      </dl>
    </div>

    <div class="inspector-section">
      <h3>Profile</h3>
      {#if hasProfile}
        {#if activeProfile}
          <dl class="inspector-details">
            <DetailRow label="Name" value={activeProfile.name} />
            <DetailRow label="ID" value={activeProfile.id} />
            <DetailRow label="Host" value={activeProfile.host || "—"} />
            <DetailRow label="Port" value={activeProfile.port ? String(activeProfile.port) : "—"} />
          </dl>
        {/if}
      {:else}
        <div class="inspector-empty">
          <Icon name="nodes" size={18} />
          <span>No active profile</span>
        </div>
      {/if}
    </div>

    <div class="inspector-section">
      <h3>Model</h3>
      {#if modelPath}
        <dl class="inspector-details">
          <DetailRow label="Path" value={modelPath} />
          <DetailRow label="File size" value="—" />
          <DetailRow label="File type" value={modelFileType} />
          <DetailRow label="Loaded" value={modelLoaded ? "Yes" : "No"} />
        </dl>
      {:else}
        <div class="inspector-empty">
          <Icon name="load" size={18} />
          <span>No model loaded</span>
        </div>
      {/if}
    </div>

    <div class="inspector-section">
      <h3>Build</h3>
      {#if buildPath}
        <dl class="inspector-details">
          <DetailRow label="Build path" value={buildPath} />
          <DetailRow label="Compiler" value="—" />
          <DetailRow label="Build version" value="—" />
        </dl>
      {:else}
        <div class="inspector-empty">
          <Icon name="zap" size={18} />
          <span>No build path configured</span>
        </div>
      {/if}
    </div>

    <div class="inspector-section">
      <h3>Validation</h3>
      {#if validationRows.length > 0}
        <dl class="inspector-details inspector-validation">
          {#each validationRows as row}
            <DetailRow label={row.label} value={row.detail} />
          {/each}
        </dl>
      {:else}
        <div class="inspector-empty">
          <Icon name="shield" size={18} />
          <span>No validation data</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="inspector-footer">
    <ActionButton icon="shield" label="Run validation" href="#system" />
  </div>
</section>

<style>
  .inspector {
    min-width: 0;
    min-height: 0;
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr auto;
    overflow: hidden;
    border: 1px solid rgba(133, 153, 184, 0.1);
    border-radius: 8px;
    background: rgba(7, 13, 24, 0.12);
  }

  .inspector-header {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 14px;
    border-bottom: 1px solid rgba(133, 153, 184, 0.08);
    background: rgba(5, 10, 19, 0.18);
  }

  .inspector-header h2 {
    margin: 0;
    color: #c8d2e4;
    font-size: 11px;
    font-weight: 850;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .inspector-header :global(.icon) {
    color: #5e6a7e;
  }

  .inspector-sections {
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 13px 14px 14px;
  }

  .inspector-section {
    padding-bottom: 14px;
    margin-bottom: 15px;
    border-bottom: 1px solid rgba(133, 153, 184, 0.08);
  }

  .inspector-section:last-child {
    margin-bottom: 0;
    padding-bottom: 0;
    border-bottom: 0;
  }

  .inspector-section h3 {
    margin: 0 0 8px;
    color: #6e7a8e;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .inspector-details {
    min-width: 0;
    margin: 0;
  }

  .inspector-details :global(.detail-row) {
    grid-template-columns: 100px minmax(0, 1fr);
    padding: 4px 0;
    min-height: 24px;
    border-bottom-color: rgba(133, 153, 184, 0.07);
  }

  .inspector-details :global(.detail-row dd) {
    text-align: right;
  }

  .inspector-validation :global(.detail-row dd) {
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 11px;
  }

  .inspector-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 0;
    color: #69758b;
    font-size: 12px;
  }

  .inspector-empty > :global(.icon) {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    opacity: 0.6;
  }

  .inspector-footer {
    padding: 10px 14px 14px;
    border-top: 1px solid rgba(133, 153, 184, 0.08);
  }

  .inspector-footer :global(.action-button) {
    width: 100%;
    justify-content: center;
  }

  :global(.detail-row dd) {
    color: #dce5f3;
    font-family: "Cascadia Code", "SFMono-Regular", Consolas, monospace;
    font-size: 12px;
    line-height: 1.45;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    min-width: 0;
  }
</style>
