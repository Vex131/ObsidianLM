<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import { defaultShellStatus, type ShellStatusSummary } from "./shell-status";

  export let shellStatus: ShellStatusSummary = defaultShellStatus;
</script>

<header class="top-header">
  <div class="header-actions" aria-label="Header actions">
    <button type="button" aria-label="Open terminal">
      <Icon name="terminal" size={18} />
    </button>
    <button class="notification-button" type="button" aria-label="Notifications">
      <Icon name="bell" size={18} />
      {#if shellStatus.warningCount > 0}
        <span>{shellStatus.warningCount}</span>
      {/if}
    </button>
    <a href="#settings" aria-label="Open settings">
      <Icon name="gear" size={18} />
    </a>
    <div class="avatar" aria-label="Operator profile">OP</div>
  </div>
</header>

<style>
  .top-header {
    position: relative;
    height: var(--topbar-height);
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 18px;
    padding: 0 26px 0 22px;
    border-bottom: 1px solid rgba(141, 161, 195, 0.11);
    background: linear-gradient(180deg, rgba(7, 13, 24, 0.96), rgba(7, 13, 24, 0.64));
    box-shadow: none;
    backdrop-filter: blur(18px);
  }

  .header-actions {
    grid-column: 3;
    justify-self: end;
    position: absolute;
    top: 17px;
    right: 26px;
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-actions button,
  .header-actions a {
    position: relative;
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(132, 153, 188, 0.18);
    border-radius: var(--radius-md);
    color: var(--color-muted);
    background: rgba(18, 29, 48, 0.82);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    cursor: default;
    text-decoration: none;
  }

  .notification-button span {
    position: absolute;
    top: -7px;
    right: -6px;
    min-width: 16px;
    height: 19px;
    padding: 0 5px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    color: white;
    background: linear-gradient(135deg, #9b6cff, #6b45d6);
    font-size: 10px;
    font-weight: 800;
    box-shadow: 0 6px 14px rgba(96, 61, 216, 0.44);
  }

  .avatar {
    width: 39px;
    height: 39px;
    display: grid;
    place-items: center;
    border: 1px solid rgba(132, 153, 188, 0.2);
    border-radius: 999px;
    color: white;
    background: rgba(18, 29, 48, 0.88);
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.05em;
  }

  @media (max-width: 900px) {
    .top-header {
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      padding: 0 14px;
    }

    .header-actions {
      position: static;
      grid-column: 2;
    }
  }

  @media (max-width: 640px) {
    .header-actions button:first-child {
      display: none;
    }
  }
</style>
