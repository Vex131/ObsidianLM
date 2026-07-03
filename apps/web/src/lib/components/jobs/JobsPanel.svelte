<script lang="ts">
  import type { DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredModel, DiscoveredToolInputFile, JobRecord, LlamaBenchJobResult, LlamaPerplexityJobResult } from "@obsidianlm/shared";
  import Panel from "../Panel.svelte";
  import ToolbarButton from "../ToolbarButton.svelte";
  import JobDetails from "./JobDetails.svelte";
  import JobList from "./JobList.svelte";
  import LlamaBenchJobForm from "./LlamaBenchJobForm.svelte";
  import LlamaPerplexityJobForm from "./LlamaPerplexityJobForm.svelte";

  let {
    jobs,
    selectedJobId = $bindable(),
    selectedJob,
    selectedJobBenchResult,
    selectedJobPerplexityResult,
    runningJob,
    jobLogs,
    jobLogLines,
    discoveredModels,
    discoveredToolInputs,
    selectedBenchModelPath = $bindable(),
    benchToolOptions,
    selectedBenchPath = $bindable(),
    selectedBenchModel,
    selectedBenchTool,
    benchForm,
    selectedPerplexityModelPath = $bindable(),
    selectedPerplexityPath = $bindable(),
    selectedDatasetPath = $bindable(),
    perplexityToolOptions,
    selectedPerplexityModel,
    selectedPerplexityTool,
    selectedDataset,
    perplexityForm,
    pendingAction,
    runTestJob,
    cancelJob,
    runLlamaBenchJob,
    runLlamaPerplexityJob,
    jobTone
  }: {
    jobs: JobRecord[];
    selectedJobId: string;
    selectedJob: JobRecord | null;
    selectedJobBenchResult: LlamaBenchJobResult | null;
    selectedJobPerplexityResult: LlamaPerplexityJobResult | null;
    runningJob: JobRecord | null;
    jobLogs: string[];
    jobLogLines: string[];
    discoveredModels: DiscoveredModel[];
    discoveredToolInputs: DiscoveredToolInputFile[];
    selectedBenchModelPath: string;
    benchToolOptions: Array<{ build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool }>;
    selectedBenchPath: string;
    selectedBenchModel: DiscoveredModel | null;
    selectedBenchTool: { build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool } | null;
    benchForm: { nGpuLayers: number; ctxSize: number; batchSize: number; ubatchSize: number; threads: number; promptTokens: number; generationTokens: number; repetitions: number };
    selectedPerplexityModelPath: string;
    selectedPerplexityPath: string;
    selectedDatasetPath: string;
    perplexityToolOptions: Array<{ build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool }>;
    selectedPerplexityModel: DiscoveredModel | null;
    selectedPerplexityTool: { build: DiscoveredLlamaCppBuild; tool: DiscoveredLlamaCppTool } | null;
    selectedDataset: DiscoveredToolInputFile | null;
    perplexityForm: { nGpuLayers: number; ctxSize: number; batchSize: number; ubatchSize: number; threads: number };
    pendingAction: string | null;
    runTestJob: () => Promise<void> | void;
    cancelJob: (id: string) => Promise<void> | void;
    runLlamaBenchJob: () => Promise<void> | void;
    runLlamaPerplexityJob: () => Promise<void> | void;
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

  <LlamaBenchJobForm
    {discoveredModels}
    bind:selectedBenchModelPath
    {benchToolOptions}
    bind:selectedBenchPath
    {selectedBenchModel}
    {selectedBenchTool}
    {benchForm}
    {pendingAction}
    {runningJob}
    {runLlamaBenchJob}
  />

  <LlamaPerplexityJobForm
    {discoveredModels}
    {discoveredToolInputs}
    bind:selectedPerplexityModelPath
    bind:selectedPerplexityPath
    bind:selectedDatasetPath
    {perplexityToolOptions}
    {selectedPerplexityModel}
    {selectedPerplexityTool}
    {selectedDataset}
    {perplexityForm}
    {pendingAction}
    {runningJob}
    {runLlamaPerplexityJob}
  />

  <p class="helper-text">One active managed job is allowed at a time. Cancellation only targets the current in-memory job child process.</p>
  <JobList {jobs} bind:selectedJobId {selectedJob} {jobTone} />
  <JobDetails {selectedJob} {selectedJobBenchResult} {selectedJobPerplexityResult} {jobLogs} {jobLogLines} />
</Panel>
