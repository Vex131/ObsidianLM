<script lang="ts">
  import type { RuntimeHealthResponse, RuntimeTestChatResponse } from "@obsidianlm/shared";
  import MetricRow from "../MetricRow.svelte";
  import Panel from "../Panel.svelte";
  import StatusPill from "../StatusPill.svelte";
  import ToolbarButton from "../ToolbarButton.svelte";

  let {
    health,
    testChatResult,
    pendingAction,
    onCheckHealth,
    onRunTestChat
  }: {
    health: RuntimeHealthResponse | null;
    testChatResult: RuntimeTestChatResponse | null;
    pendingAction: string | null;
    onCheckHealth: () => Promise<void> | void;
    onRunTestChat: (prompt: string) => Promise<void> | void;
  } = $props();

  let prompt = $state("Say OK in one short sentence.");
  const healthTone = $derived(health?.ok ? "live" : health ? "warning" : "default");
  const healthPillTone = $derived(health?.ok ? "online" : health ? "warning" : "unknown");
</script>

<Panel tone={healthTone} eyebrow="Runtime diagnostics" title="Health and test chat" class="runtime-diagnostics-card">
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="secondary" onclick={onCheckHealth} disabled={Boolean(pendingAction)}>{pendingAction === "runtime-health" ? "Checking..." : "Check runtime health"}</ToolbarButton>
  </div>

  <div class="metric-grid compact">
    <MetricRow label="Health" value={health?.status ?? "Not checked"} muted={!health} />
    <MetricRow label="Latency" value={health?.latencyMs === null || health?.latencyMs === undefined ? "--" : `${health.latencyMs} ms`} muted={health?.latencyMs === null || health?.latencyMs === undefined} />
    <MetricRow label="Endpoint" value={health?.endpoint ?? "--"} muted={!health?.endpoint} />
    <MetricRow label="Models" value={health?.modelsCount === undefined ? "--" : `${health.modelsCount}`} muted={health?.modelsCount === undefined} />
  </div>
  {#if health}
    <p class="empty-copy"><StatusPill tone={healthPillTone} label={health.ok ? "Healthy" : "Needs attention"} /> {health.message}</p>
  {/if}

  <div class="editor-section">
    <h3>Test chat</h3>
    <label class="form-field span-2" for="test-chat-prompt">Diagnostic prompt
      <textarea id="test-chat-prompt" class="folder-textarea" bind:value={prompt} rows="3"></textarea>
    </label>
    <div class="panel-actions inline-actions">
      <ToolbarButton variant="success" onclick={() => onRunTestChat(prompt)} disabled={Boolean(pendingAction)}>{pendingAction === "test-chat" ? "Sending..." : "Run test chat"}</ToolbarButton>
    </div>
    <p class="helper-text">Diagnostic only. This sends one small non-streaming request and does not create chat history or proxy general inference.</p>
  </div>

  {#if testChatResult}
    <div class="metric-grid compact">
      <MetricRow label="Status" value={testChatResult.ok ? "OK" : "Failed"} />
      <MetricRow label="Latency" value={testChatResult.latencyMs === null ? "--" : `${testChatResult.latencyMs} ms`} muted={testChatResult.latencyMs === null} />
      <MetricRow label="Prompt length" value={`${testChatResult.promptLength}`} />
      <MetricRow label="Max tokens" value={`${testChatResult.maxTokens}`} />
    </div>
    {#if testChatResult.responsePreview}
      <p class="empty-copy">{testChatResult.responsePreview}</p>
    {:else}
      <p class="port-conflict-copy">{testChatResult.message}</p>
    {/if}
  {/if}
</Panel>
