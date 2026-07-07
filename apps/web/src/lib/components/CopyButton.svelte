<script lang="ts">
  import Icon from "./Icon.svelte";

  export let value = "";
  export let label = "Copy to clipboard";

  let copied = false;
  let copiedTimer: number | undefined;

  async function copyValue() {
    if (!value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => {
        copied = false;
      }, 1400);
    } catch {
      copied = false;
    }
  }
</script>

<button class:copied type="button" aria-label={label} disabled={!value} on:click={copyValue}>
  <Icon name={copied ? "check" : "copy"} size={15} />
  <span>{copied ? "Copied" : "Copy"}</span>
</button>

<style>
  button {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 0 9px;
    border: 1px solid rgba(133, 153, 184, 0.22);
    border-radius: 7px;
    color: #cbd6e8;
    background: rgba(17, 28, 47, 0.78);
    font: inherit;
    font-size: 12px;
    font-weight: 750;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    color: #f3f6fd;
    border-color: rgba(143, 92, 255, 0.5);
  }

  button:focus-visible {
    outline: 2px solid rgba(143, 92, 255, 0.72);
    outline-offset: 2px;
  }

  button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .copied {
    color: var(--color-green);
  }
</style>
