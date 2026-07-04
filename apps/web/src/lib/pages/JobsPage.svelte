<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import JobsPanel from "../components/jobs/JobsPanel.svelte";
  let {
    data,
    actions,
    selectedJobId = $bindable(),
    selectedBenchModelPath = $bindable(),
    selectedBenchPath = $bindable(),
    selectedPerplexityModelPath = $bindable(),
    selectedPerplexityPath = $bindable(),
    selectedDatasetPath = $bindable()
  }: any = $props();
</script>

<PageHeader eyebrow="ONE-SHOT TOOLS" title="Run llama.cpp jobs" subtitle="Jobs are one-shot tools. They do not start or replace the managed llama.cpp server runtime." />
<JobsPanel
  jobs={data.jobs}
  bind:selectedJobId
  selectedJob={data.selectedJob}
  selectedJobBenchResult={data.selectedJobBenchResult as never}
  selectedJobPerplexityResult={data.selectedJobPerplexityResult as never}
  runningJob={data.runningJob}
  jobLogs={data.jobLogs}
  jobLogLines={data.jobLogLines}
  discoveredModels={data.discoveredModels}
  discoveredToolInputs={data.discoveredToolInputs}
  bind:selectedBenchModelPath
  benchToolOptions={data.benchToolOptions}
  bind:selectedBenchPath
  selectedBenchModel={data.selectedBenchModel}
  selectedBenchTool={data.selectedBenchTool}
  benchForm={data.benchForm}
  bind:selectedPerplexityModelPath
  bind:selectedPerplexityPath
  bind:selectedDatasetPath
  perplexityToolOptions={data.perplexityToolOptions}
  selectedPerplexityModel={data.selectedPerplexityModel}
  selectedPerplexityTool={data.selectedPerplexityTool}
  selectedDataset={data.selectedDataset}
  perplexityForm={data.perplexityForm}
  pendingAction={data.pendingAction}
  runTestJob={actions.runTestJob}
  cancelJob={actions.cancelJob}
  runLlamaBenchJob={actions.runLlamaBenchJob}
  runLlamaPerplexityJob={actions.runLlamaPerplexityJob}
  jobTone={actions.jobTone}
/>
