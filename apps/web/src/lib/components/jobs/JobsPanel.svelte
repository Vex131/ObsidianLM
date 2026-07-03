<script lang="ts">
  import type { DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredModel, JobRecord } from "@obsidianlm/shared";
  import MetricRow from "../MetricRow.svelte";
  import Panel from "../Panel.svelte";
  import StatusPill from "../StatusPill.svelte";
  import TerminalBlock from "../TerminalBlock.svelte";
  import ToolbarButton from "../ToolbarButton.svelte";
  import { formatBytes, formatOptionalDate } from "../../format";

  interface LlamaBenchResultRowView {
    test: string;
    backend?: string;
    threads?: string;
    nPrompt?: string;
    nGen?: string;
    testTime?: string;
    tokensPerSecond?: number;
  }

  interface LlamaBenchResultView {
    type: "llama-bench";
    rows: LlamaBenchResultRowView[];
  }

  let {
    jobs,
    selectedJobId = $bindable(),
    selectedJob,
    selectedJobBenchResult,
    runningJob,
    jobLogs,
    jobLogLines,
    discoveredModels,
    selectedBenchModelPath = $bindable(),
    benchToolOptions,
    selectedBenchPath = $bindable(),
    selectedBenchModel,
    selectedBenchTool,
    benchForm,
    pendingAction,
    runTestJob,
    cancelJob,
    runLlamaBenchJob,
    jobTone
  }: {
    jobs: JobRecord[];
    selectedJobId: string;
    selectedJob: JobRecord | null;
    selectedJobBenchResult: LlamaBenchResultView | null;
    runningJob: JobRecord | null;
    jobLogs: string[];
    jobLogLines: string[];
    discoveredModels: DiscoveredModel[];
    selectedBenchModelPath: string;
    benchToolOptions: Array<{ build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool }>;
    selectedBenchPath: string;
    selectedBenchModel: DiscoveredModel | null;
    selectedBenchTool: { build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool } | null;
    benchForm: { nGpuLayers: number; ctxSize: number; batchSize: number; ubatchSize: number; threads: number; promptTokens: number; generationTokens: number; repetitions: number };
    pendingAction: string | null;
    runTestJob: () => Promise<void> | void;
    cancelJob: (id: string) => Promise<void> | void;
    runLlamaBenchJob: () => Promise<void> | void;
    jobTone: (statusValue: JobRecord["status"]) => "online" | "offline" | "warning" | "danger" | "unknown";
  } = $props();
</script>

<Panel tone={runningJob ? "warning" : "default"} eyebrow="Jobs" title="One-shot job queue" class="jobs-card">
  <div class="panel-actions inline-actions">
    <ToolbarButton variant="secondary" onclick={runTestJob} disabled={Boolean(pendingAction) || Boolean(runningJob)}>{pendingAction === "run-test-job" ? "Starting..." : "Run safe test job"}</ToolbarButton>
    {#if runningJob}
      <ToolbarButton variant="danger" onclick={() => cancelJob(runningJob.id)} disabled={Boolean(pendingAction)}>{pendingAction === "cancel-job" ? "Cancelling..." : "Cancel running job"}</ToolbarButton>
    {/if}
  </div>
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
  <p class="helper-text">One active managed job is allowed at a time. Cancellation only targets the current in-memory job child process.</p>
  {#if jobs.length}
    <div class="job-list" aria-label="Jobs">
      {#each jobs as job}
        <button class={`job-row ${selectedJob?.id === job.id ? "selected" : ""}`} type="button" onclick={() => (selectedJobId = job.id)}>
          <span><StatusPill tone={jobTone(job.status)} label={job.status} /></span>
          <span>{job.type}</span>
          <span>{formatOptionalDate(job.createdAt)}</span>
          <span>{formatOptionalDate(job.startedAt)}</span>
          <span>{formatOptionalDate(job.finishedAt)}</span>
          <span>{job.exitCode ?? "--"}</span>
        </button>
      {/each}
    </div>
  {:else}
    <p class="empty-copy">No jobs have been run yet. Use the safe test job to verify the generic runner.</p>
  {/if}
  {#if selectedJob}
    <div class="job-detail">
      <div class="metric-grid compact">
        <MetricRow label="Selected job" value={selectedJob.id} />
        <MetricRow label="Executable" value={selectedJob.executable} />
        <MetricRow label="Started" value={formatOptionalDate(selectedJob.startedAt)} />
        <MetricRow label="Finished" value={formatOptionalDate(selectedJob.finishedAt)} />
      </div>
      {#if selectedJob.errorMessage}
        <p class="port-conflict-copy">{selectedJob.errorMessage}</p>
      {/if}
      {#if selectedJobBenchResult}
        <div class="job-list" aria-label="llama-bench results">
          {#each selectedJobBenchResult.rows as row}
            <div class="job-row">
              <span>{row.test}</span>
              <span>{row.backend ?? "--"}</span>
              <span>{row.threads ?? "--"}</span>
              <span>{row.nPrompt ?? "--"} / {row.nGen ?? "--"}</span>
              <span>{row.testTime ?? "--"}</span>
              <span>{row.tokensPerSecond === undefined ? "--" : `${row.tokensPerSecond.toFixed(2)} t/s`}</span>
            </div>
          {/each}
        </div>
      {/if}
      <TerminalBlock label={selectedJob.logPath ?? "job.log"} lines={jobLogLines} empty={!jobLogs.length} />
    </div>
  {/if}
</Panel>
