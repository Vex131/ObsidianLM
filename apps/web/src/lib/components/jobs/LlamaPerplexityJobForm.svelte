<script lang="ts">
  import type { DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredModel, DiscoveredToolInputFile } from "@obsidianlm/shared";
  import MetricRow from "../MetricRow.svelte";
  import ToolbarButton from "../ToolbarButton.svelte";
  import { formatBytes } from "../../format";

  let {
    discoveredModels,
    discoveredToolInputs,
    selectedPerplexityModelPath = $bindable(),
    selectedPerplexityPath = $bindable(),
    selectedDatasetPath = $bindable(),
    perplexityToolOptions,
    selectedPerplexityModel,
    selectedPerplexityTool,
    selectedDataset,
    perplexityForm,
    pendingAction,
    runningJob,
    runLlamaPerplexityJob
  }: {
    discoveredModels: DiscoveredModel[];
    discoveredToolInputs: DiscoveredToolInputFile[];
    selectedPerplexityModelPath: string;
    selectedPerplexityPath: string;
    selectedDatasetPath: string;
    perplexityToolOptions: Array<{ build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool }>;
    selectedPerplexityModel: DiscoveredModel | null;
    selectedPerplexityTool: { build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool } | null;
    selectedDataset: DiscoveredToolInputFile | null;
    perplexityForm: { nGpuLayers: number; ctxSize: number; batchSize: number; ubatchSize: number; threads: number };
    pendingAction: string | null;
    runningJob: unknown;
    runLlamaPerplexityJob: () => Promise<void> | void;
  } = $props();
</script>

<div class="editor-section">
  <h3>llama-perplexity</h3>
  <div class="metric-grid compact">
    <MetricRow label="Selected model" value={selectedPerplexityModel?.fileName ?? "No GGUF model discovered"} muted={!selectedPerplexityModel} />
    <MetricRow label="Selected tool" value={selectedPerplexityTool?.tool.fileName ?? "No llama-perplexity tool discovered"} muted={!selectedPerplexityTool} />
    <MetricRow label="Selected input" value={selectedDataset?.fileName ?? "No tool input discovered"} muted={!selectedDataset} />
  </div>
  <div class="form-grid">
    <label class="form-field span-2" for="perplexity-model-select">GGUF model
      <select id="perplexity-model-select" class="profile-select" bind:value={selectedPerplexityModelPath} disabled={Boolean(pendingAction) || Boolean(runningJob) || !discoveredModels.length}>
        {#each discoveredModels as model}
          <option value={model.path}>{model.name} - {formatBytes(model.sizeBytes)}</option>
        {/each}
      </select>
    </label>
    <label class="form-field span-2" for="perplexity-tool-select">llama-perplexity build/tool
      <select id="perplexity-tool-select" class="profile-select" bind:value={selectedPerplexityPath} disabled={Boolean(pendingAction) || Boolean(runningJob) || !perplexityToolOptions.length}>
        {#each perplexityToolOptions as option}
          <option value={option.tool.path}>{option.build.name} - {option.tool.fileName}</option>
        {/each}
      </select>
    </label>
    <label class="form-field span-2" for="perplexity-dataset-select">Dataset/tool input
      <select id="perplexity-dataset-select" class="profile-select" bind:value={selectedDatasetPath} disabled={Boolean(pendingAction) || Boolean(runningJob) || !discoveredToolInputs.length}>
        {#each discoveredToolInputs as input}
          <option value={input.path}>{input.fileName} - {formatBytes(input.sizeBytes)}</option>
        {/each}
      </select>
    </label>
    <label class="form-field">GPU layers<input type="number" bind:value={perplexityForm.nGpuLayers} min="0" /></label>
    <label class="form-field">Context size<input type="number" bind:value={perplexityForm.ctxSize} min="1" /></label>
    <label class="form-field">Batch<input type="number" bind:value={perplexityForm.batchSize} min="1" /></label>
    <label class="form-field">UBatch<input type="number" bind:value={perplexityForm.ubatchSize} min="1" /></label>
    <label class="form-field">Threads<input type="number" bind:value={perplexityForm.threads} min="1" /></label>
  </div>
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="success" onclick={runLlamaPerplexityJob} disabled={!selectedPerplexityModel || !selectedPerplexityTool || !selectedDataset || Boolean(pendingAction) || Boolean(runningJob)}>{pendingAction === "run-llama-perplexity" ? "Starting..." : "Run llama-perplexity"}</ToolbarButton>
  </div>
  <p class="helper-text">Lower PPL is generally better, but comparisons are meaningful only within similar model, tokenizer, dataset, and evaluation settings. This is a one-shot tool job and does not start llama-server.</p>
</div>
