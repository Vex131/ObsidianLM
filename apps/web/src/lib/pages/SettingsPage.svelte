<script lang="ts">
  import { onMount } from "svelte";
  import PageHeader from "../components/PageHeader.svelte";
  import Panel from "../components/Panel.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import {
    API_ENDPOINTS,
    clearStoredAdminToken,
    fetchJson,
    publicFetchJson,
    readStoredAdminToken,
    setupAdminToken,
    verifyAdminToken,
    writeStoredAdminToken,
    type AuthStatusResponse,
    type PortStatus,
    type RuntimeSettingsResponse,
    type RuntimeSettingsUpdate
  } from "../api";

  type FolderKey = "modelFolders" | "llamaCppFolders" | "toolInputFolders";

  let auth: AuthStatusResponse | null = null;
  let token = "";
  let confirm = "";
  let modelFolders: string[] = [];
  let llamaCppFolders: string[] = [];
  let toolInputFolders: string[] = [];
  let port = "";
  let portStatus: PortStatus | null = null;
  let message = "";
  let saving = false;
  let unlocked = false;

  $: folderGroups = [
    { key: "modelFolders" as const, label: "Model folders", values: modelFolders },
    { key: "llamaCppFolders" as const, label: "llama.cpp build folders", values: llamaCppFolders },
    { key: "toolInputFolders" as const, label: "Tool input folders", values: toolInputFolders }
  ];

  async function load() {
    unlocked = Boolean(readStoredAdminToken());
    try {
      auth = await publicFetchJson<AuthStatusResponse>(API_ENDPOINTS.auth.status);
    } catch {
      auth = null;
    }

    if (!readStoredAdminToken()) return;
    try {
      const response = await fetchJson<RuntimeSettingsResponse>(API_ENDPOINTS.settings.get);
      modelFolders = response.settings.modelFolders;
      llamaCppFolders = response.settings.llamaCppFolders;
      toolInputFolders = response.settings.toolInputFolders;
      port = String(response.settings.managedLlamaPort);
      portStatus = await fetchJson<PortStatus>(API_ENDPOINTS.monitoring.ports(response.settings.managedLlamaPort));
    } catch (error) {
      message = error instanceof Error ? error.message : "Could not load protected settings";
    }
  }

  async function authenticate() {
    if (!auth || !token) {
      message = "Enter an admin token.";
      return;
    }
    try {
      if (!auth.configured) {
        if (token !== confirm) {
          message = "Token confirmation does not match.";
          return;
        }
        await setupAdminToken(token);
      } else {
        await verifyAdminToken(token);
        writeStoredAdminToken(token);
        unlocked = true;
      }
      token = confirm = "";
      message = "Admin access is available in this browser.";
      await load();
    } catch (error) {
      token = confirm = "";
      message = error instanceof Error ? error.message : "Authentication failed";
    }
  }

  async function logout() {
    try {
      await fetchJson(API_ENDPOINTS.auth.logout, { method: "POST" });
    } catch {
      // Local removal still locks this browser if the acknowledgement fails.
    }
    clearStoredAdminToken();
    unlocked = false;
    modelFolders = llamaCppFolders = toolInputFolders = [];
    port = "";
    portStatus = null;
    message = "This browser is locked. Server authentication remains configured.";
  }

  async function saveFolders() {
    saving = true;
    try {
      await fetchJson(API_ENDPOINTS.settings.updateDiscoveryFolders, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelFolders: modelFolders.map((value) => value.trim()).filter(Boolean),
          llamaCppFolders: llamaCppFolders.map((value) => value.trim()).filter(Boolean),
          toolInputFolders: toolInputFolders.map((value) => value.trim()).filter(Boolean)
        })
      });
      message = "Discovery folders saved.";
      await load();
    } catch (error) {
      message = error instanceof Error ? error.message : "Discovery folders could not be saved";
    } finally {
      saving = false;
    }
  }

  async function savePort() {
    const managedLlamaPort = Number(port);
    if (!Number.isInteger(managedLlamaPort) || managedLlamaPort < 1 || managedLlamaPort > 65535) {
      message = "Managed port must be an integer from 1 to 65535.";
      return;
    }
    saving = true;
    try {
      await fetchJson(API_ENDPOINTS.settings.updateRuntime, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managedLlamaPort } satisfies RuntimeSettingsUpdate)
      });
      message = "Managed runtime port saved.";
      await load();
    } catch (error) {
      message = error instanceof Error ? error.message : "Managed runtime port could not be saved";
    } finally {
      saving = false;
    }
  }

  function setFolders(key: FolderKey, values: string[]) {
    if (key === "modelFolders") modelFolders = values;
    else if (key === "llamaCppFolders") llamaCppFolders = values;
    else toolInputFolders = values;
  }

  function updateFolder(key: FolderKey, index: number, value: string) {
    const values = [...folderGroups.find((group) => group.key === key)!.values];
    values[index] = value;
    setFolders(key, values);
  }

  function removeFolder(key: FolderKey, index: number) {
    setFolders(key, folderGroups.find((group) => group.key === key)!.values.filter((_, itemIndex) => itemIndex !== index));
  }

  function addFolder(key: FolderKey) {
    setFolders(key, [...folderGroups.find((group) => group.key === key)!.values, ""]);
  }

  onMount(() => void load());
</script>

<main class="page-surface settings-page" aria-label="Settings">
  <PageHeader title="Settings" subtitle="Authentication, service-machine discovery roots, and the managed runtime port." />
  <p class="notice" role="status" aria-live="polite">{message}</p>

  <div class="settings-grid">
    <Panel title="Authentication / session">
      <div class="panel-content">
        {#if auth}
          <StatusBadge label={auth.configured ? (unlocked ? "Unlocked locally" : "Browser locked") : "Setup required"} tone={unlocked ? "green" : "amber"} />
          {#if unlocked}
            <p>Admin access is available in this browser. The stored token is never displayed.</p>
            <button class="btn" type="button" on:click={() => void logout()}>Forget token / Lock this browser</button>
          {:else}
            <label>Admin token<input bind:value={token} type="password" autocomplete={auth.configured ? "current-password" : "new-password"} /></label>
            {#if !auth.configured}<label>Confirm admin token<input bind:value={confirm} type="password" autocomplete="new-password" /></label>{/if}
            <button class="btn primary" type="button" on:click={() => void authenticate()}>{auth.configured ? "Unlock / Verify" : "Create admin token"}</button>
          {/if}
        {:else}
          <p>Authentication status is unavailable.</p>
        {/if}
      </div>
    </Panel>

    <Panel title="Managed runtime port">
      <div class="panel-content">
        <label>Port<input bind:value={port} inputmode="numeric" aria-describedby="managed-port-help" /></label>
        <small id="managed-port-help">
          {#if portStatus}
            {portStatus.port.inUse ? "Occupied" : "Available now"}; owner PID {portStatus.port.ownerPid ?? "unknown"}; {portStatus.conflict ? portStatus.conflictMessage ?? "conflict" : "no conflict detected"}.
          {:else}Current port status is unavailable.{/if}
        </small>
        <p>Stop an active managed runtime before changing this port.</p>
        <button class="btn primary" type="button" disabled={saving || !unlocked} on:click={() => void savePort()}>Save managed port</button>
      </div>
    </Panel>
  </div>

  <Panel title="Discovery folders">
    <div class="folder-groups">
      {#each folderGroups as group}
        <section>
          <div class="folder-heading"><strong>{group.label}</strong><button class="btn" type="button" on:click={() => addFolder(group.key)}>Add</button></div>
          {#each group.values as folder, index}
            <div class="folder-row">
              <input value={folder} aria-label={`${group.label} ${index + 1}`} on:input={(event) => updateFolder(group.key, index, event.currentTarget.value)} />
              <button class="btn" type="button" aria-label={`Remove ${group.label} ${index + 1}`} on:click={() => removeFolder(group.key, index)}>Remove</button>
            </div>
          {:else}
            <p>No folders configured.</p>
          {/each}
        </section>
      {/each}
      <div class="save-row"><button class="btn primary" type="button" disabled={saving || !unlocked} on:click={() => void saveFolders()}>Save discovery folders</button><a href="#models">Models</a><a href="#builds">Builds</a><a href="#jobs">Jobs</a></div>
    </div>
  </Panel>
</main>

<style>
  .notice { min-height: 1.3rem; color: var(--color-muted); font-size: .85rem; }
  .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; margin-bottom: 1rem; }
  .panel-content, .folder-groups, .folder-groups section { display: grid; gap: .7rem; padding: 1rem; }
  .panel-content label { display: grid; gap: .3rem; color: var(--color-muted); font-size: .8rem; }
  .panel-content p, .folder-groups p { margin: 0; color: var(--color-muted); }
  .folder-groups section { padding: 0; }
  .folder-heading, .folder-row, .save-row { display: flex; align-items: center; gap: .6rem; }
  .folder-heading { justify-content: space-between; }
  .folder-row input { min-width: 0; flex: 1; }
  .save-row { flex-wrap: wrap; padding-top: .4rem; }
  @media (max-width: 700px) { .settings-grid { grid-template-columns: 1fr; } .folder-row { align-items: stretch; flex-direction: column; } }
</style>
