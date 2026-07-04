<script lang="ts">
  import PageHeader from "../layout/PageHeader.svelte";
  import SectionPanel from "../components/SectionPanel.svelte";
  import StatusBadge from "../components/StatusBadge.svelte";
  import ToolbarButton from "../components/ToolbarButton.svelte";
  import ProfileEditor from "../components/profile/ProfileEditor.svelte";
  let { data, actions }: { data: any; actions: any } = $props();
</script>

<PageHeader eyebrow="LAUNCH CONFIGS" title="Manage runtime profiles" subtitle="Create, edit, and manage runtime launch configurations." />

<section class="profiles-layout">
  <SectionPanel eyebrow="Profiles" title="Launch configs" class="profile-list-panel">
    <div class="profile-list-toolbar">
      <input class="log-search-input" placeholder="Search profiles" aria-label="Search profiles" />
    </div>
    <div class="profile-list">
      {#if data.profiles.length}
        {#each data.profiles as profile}
          <button class={`profile-row ${data.selectedProfileId === profile.id ? "selected" : ""}`} type="button" onclick={() => actions.setSelectedProfileId(profile.id)}>
            <strong>{profile.name}</strong>
            <span>{profile.host}:{profile.port}</span>
            {#if data.runtime?.activeProfileId === profile.id}<StatusBadge tone="online" label="Active" />{/if}
          </button>
        {/each}
      {:else}
        <p class="empty-copy">No profiles are configured yet.</p>
      {/if}
    </div>
    <p class="helper-text">Import and export controls are available below the editor.</p>
  </SectionPanel>

  <div class="profile-editor-zone">
    <ProfileEditor
      profiles={data.profiles}
      selectedProfileId={data.selectedProfileId}
      runtime={data.runtime}
      pendingAction={data.pendingAction}
      fetchJson={actions.fetchJson}
      runAction={actions.runAction}
      onProfilesChanged={actions.loadProfiles}
      setSelectedProfileId={actions.setSelectedProfileId}
      setCommand={actions.setCommand}
      setValidation={actions.setValidationResult}
      setActionMessage={actions.setActionMessage}
    />
  </div>
</section>
