<script lang="ts">
  import Icon, { type IconName } from "./Icon.svelte";

  export let icon: IconName | undefined = undefined;
  export let label = "";
  export let description = "";
  export let href: string | undefined = undefined;
  export let disabled = false;
  export let variant: "default" | "primary" = "default";
  export let compact = false;
</script>

{#if href && !disabled}
  <a class:primary={variant === "primary"} class:compact class="action-button" href={href}>
    {#if icon}<Icon name={icon} size={compact ? 15 : 17} />{/if}
    <span>
      <strong>{label}</strong>
      {#if !compact && description}<small>{description}</small>{/if}
    </span>
  </a>
{:else}
  <button class:primary={variant === "primary"} class:compact class="action-button" type="button" {disabled}>
    {#if icon}<Icon name={icon} size={compact ? 15 : 17} />{/if}
    <span>
      <strong>{label}</strong>
      {#if !compact && description}<small>{description}</small>{/if}
    </span>
  </button>
{/if}

<style>
  .action-button {
    min-width: 0;
    min-height: 38px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 9px;
    padding: 8px 12px;
    border: 1px solid rgba(133, 153, 184, 0.22);
    border-radius: 8px;
    color: #dce5f3;
    background: rgba(19, 31, 51, 0.86);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
  }

  .action-button:hover:not(:disabled) {
    border-color: rgba(158, 180, 216, 0.34);
    background: rgba(26, 41, 66, 0.96);
  }

  .action-button:focus-visible {
    outline: 2px solid rgba(143, 92, 255, 0.72);
    outline-offset: 2px;
  }

  .action-button:disabled {
    opacity: 0.48;
    cursor: not-allowed;
  }

  .action-button.primary {
    border-color: rgba(143, 92, 255, 0.5);
    color: white;
    background: linear-gradient(180deg, #8f5cff, #6c3ee7);
    box-shadow: 0 12px 28px rgba(96, 61, 216, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }

  span {
    min-width: 0;
    display: grid;
    gap: 2px;
  }

  strong,
  small {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 13px;
    font-weight: 800;
    line-height: 1.1;
  }

  small {
    color: #9facbf;
    font-size: 11px;
    line-height: 1.25;
  }

  .primary small {
    color: rgba(255, 255, 255, 0.72);
  }

  .compact {
    min-height: 38px;
    gap: 7px;
    padding: 4px 10px;
  }

  .compact strong {
    font-size: 12px;
  }
</style>
