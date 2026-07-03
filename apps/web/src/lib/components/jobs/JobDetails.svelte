<script lang="ts">
  import type { JobRecord, LlamaBenchJobResult, LlamaPerplexityJobResult } from "@obsidianlm/shared";
  import MetricRow from "../MetricRow.svelte";
  import TerminalBlock from "../TerminalBlock.svelte";
  import { formatOptionalDate } from "../../format";

  let { selectedJob, selectedJobBenchResult, selectedJobPerplexityResult, jobLogs, jobLogLines }: { selectedJob: JobRecord | null; selectedJobBenchResult: LlamaBenchJobResult | null; selectedJobPerplexityResult: LlamaPerplexityJobResult | null; jobLogs: string[]; jobLogLines: string[] } = $props();
</script>

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
    {#if selectedJobPerplexityResult}
      <div class="metric-grid compact">
        <MetricRow label="Final PPL" value={selectedJobPerplexityResult.finalPpl === null ? "Not parsed" : selectedJobPerplexityResult.finalPpl.toFixed(4)} muted={selectedJobPerplexityResult.finalPpl === null} />
        <MetricRow label="Uncertainty" value={selectedJobPerplexityResult.uncertainty === null ? "--" : `+/- ${selectedJobPerplexityResult.uncertainty}`} muted={selectedJobPerplexityResult.uncertainty === null} />
        <MetricRow label="Estimates" value={`${selectedJobPerplexityResult.estimateCount}`} />
      </div>
      {#if selectedJobPerplexityResult.warnings.length}
        <ul class="warning-list">
          {#each selectedJobPerplexityResult.warnings as warning}
            <li>{warning}</li>
          {/each}
        </ul>
      {/if}
    {/if}
    <TerminalBlock label={selectedJob.logPath ?? "job.log"} lines={jobLogLines} empty={!jobLogs.length} />
  </div>
{/if}
