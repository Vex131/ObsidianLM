<script lang="ts">
  import type { JobRecord } from "@obsidianlm/shared";
  import StatusPill from "../StatusPill.svelte";
  import { formatOptionalDate } from "../../format";

  let { jobs, selectedJobId = $bindable(), selectedJob, jobTone }: { jobs: JobRecord[]; selectedJobId: string; selectedJob: JobRecord | null; jobTone: (statusValue: JobRecord["status"]) => "online" | "offline" | "warning" | "danger" | "unknown" } = $props();
</script>

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
  <p class="empty-copy">No jobs have been run yet. Use the safe test job to verify the generic runner, or run a discovered llama.cpp one-shot tool.</p>
{/if}
