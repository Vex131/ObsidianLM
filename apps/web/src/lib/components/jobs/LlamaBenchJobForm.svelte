<script lang="ts">
  import type { DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredModel } from "@obsidianlm/shared";
  import MetricRow from "../MetricRow.svelte";
  import ToolbarButton from "../ToolbarButton.svelte";
  import { formatBytes } from "../../format";

  let {
    discoveredModels,
    selectedBenchModelPath = $bindable(),
    benchToolOptions,
    selectedBenchPath = $bindable(),
    selectedBenchModel,
    selectedBenchTool,
    benchForm,
    pendingAction,
    runningJob,
    runLlamaBenchJob
  }: {
    discoveredModels: DiscoveredModel[];
    selectedBenchModelPath: string;
    benchToolOptions: Array<{ build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool }>;
    selectedBenchPath: string;
    selectedBenchModel: DiscoveredModel | null;
    selectedBenchTool: { build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool } | null;
    benchForm: { nGpuLayers: number; ctxSize: number; batchSize: number; ubatchSize: number; threads: number; promptTokens: number; generationTokens: number; repetitions: number };
    pendingAction: string | null;
    runningJob: unknown;
    runLlamaBenchJob: () => Promise<void> | void;
  } = $props();
</script>

<div class="editor-section">
  <h3>llama-bench</h3>
  <div class="metric-grid compact">
    <MetricRow label="Selected model" value={selectedBenchModel?.fileName ?? "No GGUF model discovered"} muted={!selectedBenchModel} />
    <MetricRow label="Selected tool" value={selectedBenchTool?.tool.fileName ?? "No llama-bench tool discovered"} muted={!selectedBenchTool} />
  </div>
  <div class="form-grid">
    <label class="form-field span-2" for="bench-model-select">GGUF model
      <select id="bench-model-select" class="profile-select" bind:value={selectedBenchModelPath} disabled={Boolean(pendingAction) || Boolean(runningJob) || !discoveredModels.length}>
        {#each discoveredModels as model}
          <option value={model.path}>{model.name} - {formatBytes(model.sizeBytes)}</option>
        {/each}
      </select>
    </label>
    <label class="form-field span-2" for="bench-tool-select">llama-bench build/tool
      <select id="bench-tool-select" class="profile-select" bind:value={selectedBenchPath} disabled={Boolean(pendingAction) || Boolean(runningJob) || !benchToolOptions.length}>
        {#each benchToolOptions as option}
          <option value={option.tool.path}>{option.build.name} - {option.tool.fileName}</option>
        {/each}
      </select>
    </label>
    <label class="form-field">GPU layers<input type="number" bind:value={benchForm.nGpuLayers} min="0" /></label>
    <label class="form-field">Context display<input type="number" bind:value={benchForm.ctxSize} min="1" /></label>
    <label class="form-field">Batch<input type="number" bind:value={benchForm.batchSize} min="1" /></label>
    <label class="form-field">UBatch<input type="number" bind:value={benchForm.ubatchSize} min="1" /></label>
    <label class="form-field">Threads<input type="number" bind:value={benchForm.threads} min="1" /></label>
    <label class="form-field">Prompt tokens<input type="number" bind:value={benchForm.promptTokens} min="1" /></label>
    <label class="form-field">Generation tokens<input type="number" bind:value={benchForm.generationTokens} min="1" /></label>
    <label class="form-field">Repetitions<input type="number" bind:value={benchForm.repetitions} min="1" /></label>
  </div>
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="success" onclick={runLlamaBenchJob} disabled={!selectedBenchModel || !selectedBenchTool || Boolean(pendingAction) || Boolean(runningJob)}>{pendingAction === "run-llama-bench" ? "Starting..." : "Run llama-bench"}</ToolbarButton>
  </div>
  <p class="helper-text">Safe laptop CPU defaults use 0 GPU layers, 512 prompt tokens, 128 generation tokens, and 3 repetitions. llama-bench is a one-shot tool job and does not start llama-server.</p>
</div>
