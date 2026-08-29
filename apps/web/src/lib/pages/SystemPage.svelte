<script lang="ts">
  import { onMount } from "svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Panel from "../components/Panel.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import CopyButton from "../components/CopyButton.svelte";
  import { API_ENDPOINTS, fetchJson, type ReadinessResponse, type RuntimeSettingsResponse } from "../api";
  import { applicationStatus, refreshApplicationStatus } from "../app-status";

  $: status = $applicationStatus.status;
  let readiness: ReadinessResponse | null = null;
  $: auth = $applicationStatus.auth;
  let settings: RuntimeSettingsResponse | null = null;
  let message = "";
  let loading = false;

  function tone(value: string): "green" | "amber" | "red" | "muted" {
    if (value === "pass") return "green";
    if (value === "block") return "red";
    if (value === "unavailable") return "muted";
    return "amber";
  }

  function action(text: string): [string, string] {
    const value = text.toLowerCase();
    if (value.includes("token") || value.includes("folder")) return ["Settings", "#settings"];
    if (value.includes("model")) return ["Models", "#models"];
    if (value.includes("build") || value.includes("llama-server")) return ["Builds", "#builds"];
    if (value.includes("profile")) return ["Profiles", "#profiles"];
    if (value.includes("bench") || value.includes("perplexity") || value.includes("tool input")) return ["Jobs", "#jobs"];
    if (value.includes("runtime")) return ["Runtime", "#runtime"];
    if (value.includes("gpu") || value.includes("port") || value.includes("process")) return ["Telemetry", "#telemetry"];
    if (value.includes("log")) return ["Logs", "#logs"];
    return ["Settings", "#settings"];
  }

  async function load(refreshStatus = true) {
    loading = true;
    try {
      if (refreshStatus) await refreshApplicationStatus();
      [readiness, settings] = await Promise.all([
        fetchJson<ReadinessResponse>(API_ENDPOINTS.readiness),
        fetchJson<RuntimeSettingsResponse>(API_ENDPOINTS.settings.get)
      ]);
      message = "";
    } catch (error) {
      message = error instanceof Error ? error.message : "System checks unavailable";
    } finally {
      loading = false;
    }
  }

  $: warningMessages = [...new Set([
    ...(status?.warnings ?? []),
    ...(status?.detection.warnings.map((warning) => warning.message) ?? []),
    ...(readiness?.warnings ?? []),
    ...(readiness?.storageWarnings ?? [])
  ])];
  $: diagnostics = JSON.stringify({
    app: status?.app,
    version: status?.version,
    runningMode: status?.runningMode,
    serviceMode: status?.serviceMode,
    dataDirMode: status?.dataDirMode,
    logDirMode: status?.logDirMode,
    uiPort: status?.uiPort,
    managedLlamaPort: status?.managedLlamaPort,
    runtimeStatus: status?.activeRuntime?.status ?? "stopped",
    gpu: status?.gpu,
    authConfigured: auth?.configured,
    readiness: readiness ? { ok: readiness.ok, counts: readiness.counts, checks: readiness.checks.map(({ id, status: checkStatus, count }) => ({ id, status: checkStatus, count })) } : null,
    warnings: warningMessages
  }, null, 2);

  onMount(() => void load(false));
</script>

<main class="page-surface system-page" aria-label="System">
  <PageHeader title="System" subtitle="Service health, authoritative setup readiness, and portable diagnostics." />
  <div class="actions">
    <button class="btn" type="button" disabled={loading} on:click={() => void load()}>{loading ? "Running checks..." : "Run checks / Refresh"}</button>
    <StatusBadge label={readiness?.ok ? "Ready" : readiness ? "Blocking" : "Unavailable"} tone={readiness?.ok ? "green" : readiness ? "red" : "muted"} />
    <CopyButton value={diagnostics} label="Copy diagnostics" />
    <span role="status" aria-live="polite">{message}</span>
  </div>

  <div class="system-grid">
    <Panel title="Service summary">
      <dl>
        <dt>Application / version</dt><dd>{status?.app ?? "ObsidianLM"} {status?.version ?? "—"}</dd>
        <dt>Running mode</dt><dd>{status?.runningMode ?? "—"}</dd>
        <dt>Service mode</dt><dd>{status?.serviceMode ? "Windows service" : "Not service mode"}</dd>
        <dt>UI port</dt><dd>{status?.uiPort ?? "—"}</dd>
        <dt>Managed llama.cpp port</dt><dd>{status?.managedLlamaPort ?? "—"}</dd>
        <dt>Data location mode</dt><dd>{status?.dataDirMode ?? "—"}</dd>
        <dt>Log location mode</dt><dd>{status?.logDirMode ?? "—"}</dd>
        <dt>Runtime</dt><dd>{status?.activeRuntime?.status ?? "stopped"}</dd>
        <dt>GPU monitoring</dt><dd>{status?.gpu.available ? `${status.gpu.gpuCount} GPU(s)` : "Unavailable"}</dd>
        <dt>Authentication</dt><dd>{auth?.configured ? "Configured" : "Setup required"}</dd>
        <dt>Startup policy</dt><dd>{settings?.settings.startupMode ?? "—"}</dd>
        <dt>Stale process policy</dt><dd>{settings?.settings.staleProcessPolicy ?? "—"}</dd>
      </dl>
    </Panel>

    <Panel title="Readiness checklist">
      <div class="summary"><strong>{readiness?.blockingChecks.length ?? 0} blocking</strong><span>{readiness?.checks.filter((check) => check.status === "warning" || check.status === "unavailable").length ?? 0} warnings</span><span>{readiness?.checks.filter((check) => check.status === "pass").length ?? 0} passing</span></div>
      <div class="checks">
        {#each readiness?.checks ?? [] as check}
          <article><div><strong>{check.label}</strong><StatusBadge label={check.status} tone={tone(check.status)} /></div><p>{check.message}</p>{#if check.count !== undefined}<small>Count: {check.count}</small>{/if}</article>
        {:else}<p>No readiness result is available.</p>{/each}
      </div>
    </Panel>
  </div>

  <div class="system-grid lower">
    <Panel title="Next actions">
      <div class="messages">{#each readiness?.nextActions ?? [] as nextAction}{@const next = action(nextAction)}<article><p>{nextAction}</p><a href={next[1]}>Open {next[0]}</a></article>{:else}<p>No next actions reported.</p>{/each}</div>
    </Panel>
    <Panel title="Warnings / startup detection">
      <div class="messages"><p>Checked {status?.detection.checkedAt ? new Date(status.detection.checkedAt).toLocaleString() : "—"} · {(status?.detection.categories ?? []).join(", ") || "no detection categories"}</p>{#each warningMessages as warning}<article><p>{warning}</p></article>{:else}<p>No warnings reported.</p>{/each}</div>
    </Panel>
  </div>
</main>

<style>
  .actions, .summary { display: flex; align-items: center; gap: .65rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .actions > span { color: var(--color-muted); font-size: .8rem; }
  .system-grid { display: grid; grid-template-columns: minmax(18rem, .8fr) minmax(0, 1.2fr); gap: 1rem; margin-bottom: 1rem; }
  .system-grid.lower { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  dl, .checks, .messages { display: grid; gap: .65rem; padding: 1rem; margin: 0; }
  dl { grid-template-columns: minmax(10rem, 1fr) minmax(0, 1fr); }
  dt { color: var(--color-muted); } dd { margin: 0; overflow-wrap: anywhere; }
  .summary { padding: 1rem 1rem 0; margin: 0; }
  .checks article, .messages article { display: grid; gap: .35rem; padding-bottom: .65rem; border-bottom: 1px solid var(--color-line); }
  .checks article > div { display: flex; justify-content: space-between; gap: .6rem; }
  .checks p, .messages p { margin: 0; color: var(--color-muted); }
  @media (max-width: 760px) { .system-grid, .system-grid.lower { grid-template-columns: 1fr; } }
  @media (max-width: 390px) { dl { grid-template-columns: 1fr; } }
</style>
