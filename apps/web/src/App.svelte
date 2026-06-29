<script lang="ts">
  import type { StatusResponse } from "@obsidianlm/shared";

  let status = $state<StatusResponse | null>(null);
  let errorMessage = $state<string | null>(null);
  let isLoading = $state(true);

  async function loadStatus(): Promise<void> {
    isLoading = true;
    errorMessage = null;

    try {
      const response = await fetch("/api/status");

      if (!response.ok) {
        throw new Error(`Status request failed with ${response.status}`);
      }

      status = (await response.json()) as StatusResponse;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to load service status.";
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    void loadStatus();
  });
</script>

<main class="shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <div class="brand-mark">OLM</div>
    <nav>
      <a class="nav-item active" href="/">Dashboard</a>
      <span class="nav-item disabled">Profiles</span>
      <span class="nav-item disabled">Runtime</span>
      <span class="nav-item disabled">Settings</span>
    </nav>
  </aside>

  <section class="content">
    <header class="hero">
      <div>
        <p class="eyebrow">Phase 0 Foundation</p>
        <h1>ObsidianLM Control Plane</h1>
        <p class="lede">
          Lightweight dashboard shell for the local AI runtime manager. Runtime management is intentionally not implemented yet.
        </p>
      </div>

      <button class="refresh" type="button" onclick={loadStatus} disabled={isLoading}>
        {isLoading ? "Checking..." : "Refresh Status"}
      </button>
    </header>

    {#if errorMessage}
      <section class="panel error" aria-live="polite">
        <h2>Service Unreachable</h2>
        <p>{errorMessage}</p>
      </section>
    {:else}
      <section class="grid" aria-live="polite">
        <article class="panel status-card">
          <span class="label">Service</span>
          <strong>{status?.service ?? "checking"}</strong>
          <p>{status?.app ?? "ObsidianLM"} API status endpoint</p>
        </article>

        <article class="panel">
          <span class="label">ObsidianLM Port</span>
          <strong>{status?.uiPort ?? "--"}</strong>
          <p>UI and API service port</p>
        </article>

        <article class="panel">
          <span class="label">Managed llama.cpp Port</span>
          <strong>{status?.managedLlamaPort ?? "--"}</strong>
          <p>Reserved for future llama.cpp runtime API</p>
        </article>

        <article class="panel">
          <span class="label">Active Runtime</span>
          <strong>{status?.activeRuntime ?? "none"}</strong>
          <p>No runtime is started or managed in Phase 0.</p>
        </article>
      </section>

      <section class="panel placeholder">
        <div>
          <span class="label">Runtime Management</span>
          <h2>Not implemented yet</h2>
          <p>
            Phase 0 does not start, stop, scan, kill, or manage llama.cpp processes. Port 8085 remains reserved for a future managed runtime.
          </p>
        </div>
      </section>

      <section class="panel warnings">
        <h2>Warnings</h2>
        {#if status?.warnings?.length}
          <ul>
            {#each status.warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {:else}
          <p>No warnings reported by the Phase 0 service.</p>
        {/if}
      </section>
    {/if}
  </section>
</main>
