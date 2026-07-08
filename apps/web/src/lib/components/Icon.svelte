<script lang="ts" context="module">
  export type IconName =
    | "menu"
    | "grid"
    | "gauge"
    | "layers"
    | "cube"
    | "database"
    | "artifact"
    | "log"
    | "chart"
    | "gear"
    | "help"
    | "terminal"
    | "bell"
    | "monitor"
    | "chevron-up"
    | "check"
    | "refresh"
    | "stop"
    | "play"
    | "copy"
    | "external"
    | "search"
    | "x"
    | "zap"
    | "load"
    | "nodes"
    | "shield"
    | "list"
    | "warning"
    | "cpu"
    | "gpu"
    | "chevron";
</script>

<script lang="ts">
  export let name: IconName;

  export let size = 18;
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "menu"}
    <path d="M4 7h16" />
    <path d="M4 12h16" />
    <path d="M4 17h16" />
  {:else if name === "grid"}
    <rect x="4" y="4" width="6" height="6" rx="1.5" />
    <rect x="14" y="4" width="6" height="6" rx="1.5" />
    <rect x="4" y="14" width="6" height="6" rx="1.5" />
    <rect x="14" y="14" width="6" height="6" rx="1.5" />
  {:else if name === "gauge"}
    <path d="M5 17a8 8 0 1 1 14 0" />
    <path d="m12 13 4-4" />
    <circle cx="12" cy="13" r="1.7" />
  {:else if name === "layers"}
    <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" />
    <path d="m3.5 12 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  {:else if name === "cube"}
    <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
    <path d="M12 12 4 7.5" />
    <path d="m12 12 8-4.5" />
    <path d="M12 12v9" />
  {:else if name === "database"}
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  {:else if name === "artifact"}
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <path d="M9 7h6" />
    <path d="M9 11h6" />
    <path d="M9 15h4" />
  {:else if name === "log"}
    <path d="M6 4h12v16H6z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h4" />
  {:else if name === "chart"}
    <rect x="5" y="4" width="14" height="16" rx="2" />
    <path d="m9 15 2.5-3 2 2 2.5-5" />
  {:else if name === "gear"}
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12a7.5 7.5 0 0 0-.1-1l2-1.6-2-3.5-2.5 1a8 8 0 0 0-1.8-1L14.3 3h-4.6l-.4 2.9a8 8 0 0 0-1.8 1L5 5.9l-2 3.5L5 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.5 2.5-1a8 8 0 0 0 1.8 1l.4 2.9h4.6l.4-2.9a8 8 0 0 0 1.8-1l2.5 1 2-3.5-2-1.6c.1-.3.1-.7.1-1Z" />
  {:else if name === "help"}
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.7 2.7 0 0 1 5.1 1.4c0 1.9-2.6 2.2-2.6 4" />
    <path d="M12 18h.01" />
  {:else if name === "terminal"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3" />
    <path d="M12 15h5" />
  {:else if name === "bell"}
    <path d="M18 9a6 6 0 1 0-12 0c0 7-2 7-2 8h16c0-1-2-1-2-8Z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  {:else if name === "monitor"}
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  {:else if name === "chevron-up"}
    <path d="m6 15 6-6 6 6" />
  {:else if name === "check"}
    <path d="m5 12.5 4.2 4.2L19 6.8" />
  {:else if name === "refresh"}
    <path d="M20 12a8 8 0 0 1-14.5 4.7" />
    <path d="M4 12A8 8 0 0 1 18.5 7.3" />
    <path d="M5 17H2v-3" />
    <path d="M19 7h3v3" />
  {:else if name === "stop"}
    <rect x="8" y="8" width="8" height="8" rx="1" />
  {:else if name === "play"}
    <path d="m8 5 11 7-11 7V5Z" />
  {:else if name === "copy"}
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M5 15H4a1.8 1.8 0 0 1-1.8-1.8V5A1.8 1.8 0 0 1 4 3.2h8.2A1.8 1.8 0 0 1 14 5v1" />
  {:else if name === "external"}
    <path d="M14 4h6v6" />
    <path d="m10 14 10-10" />
    <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
  {:else if name === "search"}
    <circle cx="11" cy="11" r="6" />
    <path d="m16 16 4 4" />
  {:else if name === "x"}
    <path d="M7 7l10 10" />
    <path d="M17 7 7 17" />
  {:else if name === "zap"}
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  {:else if name === "load"}
    <path d="M6 9V4h5" />
    <path d="M18 15v5h-5" />
    <path d="M8 5a8 8 0 0 1 11 7" />
    <path d="M16 19a8 8 0 0 1-11-7" />
    <rect x="8" y="9" width="8" height="6" rx="1.5" />
  {:else if name === "nodes"}
    <circle cx="6" cy="7" r="3" />
    <circle cx="18" cy="7" r="3" />
    <circle cx="12" cy="18" r="3" />
    <path d="m8.5 9.5 2 5" />
    <path d="m15.5 9.5-2 5" />
    <path d="M9 7h6" />
  {:else if name === "shield"}
    <path d="M12 3 19 6v5c0 4.6-2.8 8.2-7 10-4.2-1.8-7-5.4-7-10V6l7-3Z" />
    <path d="m9 12 2 2 4-4" />
  {:else if name === "list"}
    <path d="M8 6h12" />
    <path d="M8 12h12" />
    <path d="M8 18h12" />
    <path d="M4 6h.01" />
    <path d="M4 12h.01" />
    <path d="M4 18h.01" />
  {:else if name === "warning"}
    <path d="M12 3 22 20H2L12 3Z" />
    <path d="M12 9v5" />
    <path d="M12 17h.01" />
  {:else if name === "cpu"}
    <rect x="7" y="7" width="10" height="10" rx="2" />
    <path d="M9 1v4" />
    <path d="M15 1v4" />
    <path d="M9 19v4" />
    <path d="M15 19v4" />
    <path d="M1 9h4" />
    <path d="M1 15h4" />
    <path d="M19 9h4" />
    <path d="M19 15h4" />
  {:else if name === "gpu"}
    <rect x="4" y="7" width="13" height="10" rx="2" />
    <path d="M17 10h3v4h-3" />
    <path d="M8 17v3" />
    <path d="M13 17v3" />
    <path d="M8 4v3" />
    <path d="M13 4v3" />
    <path d="M8 11h5" />
  {:else if name === "chevron"}
    <path d="m9 6 6 6-6 6" />
  {/if}
</svg>

<style>
  .icon {
    display: block;
    flex: 0 0 auto;
  }
</style>
