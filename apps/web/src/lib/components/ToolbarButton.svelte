<script lang="ts">
  import type { Snippet } from "svelte";

  type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";

  let {
    variant = "secondary",
    disabled = false,
    type = "button",
    title,
    onclick,
    children
  }: {
    variant?: ButtonVariant;
    disabled?: boolean;
    type?: "button" | "submit" | "reset";
    title?: string;
    onclick?: () => void | Promise<void>;
    children?: Snippet;
  } = $props();
</script>

<button class={`button button-${variant}`} {type} {disabled} {title} {onclick}>
  {@render children?.()}
</button>
