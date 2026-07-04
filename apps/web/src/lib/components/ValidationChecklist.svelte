<script lang="ts">
  let { validation, warnings = [] }: { validation: { valid: boolean; errors: string[]; warnings: string[] } | null; warnings?: string[] } = $props();
</script>

<div class="validation-checklist">
  {#if validation}
    <div class={`check-row ${validation.valid ? "ok" : "danger"}`}><span>{validation.valid ? "PASS" : "FAIL"}</span><strong>{validation.valid ? "Profile can start" : "Blocking validation errors"}</strong></div>
    {#each validation.errors as error}<div class="check-row danger"><span>ERR</span><p>{error}</p></div>{/each}
    {#each validation.warnings as warning}<div class="check-row warning"><span>WARN</span><p>{warning}</p></div>{/each}
  {:else}
    <div class="check-row warning"><span>TODO</span><p>Validate the selected profile before starting llama.cpp.</p></div>
  {/if}
  {#each warnings as warning}<div class="check-row warning"><span>WARN</span><p>{warning}</p></div>{/each}
</div>
