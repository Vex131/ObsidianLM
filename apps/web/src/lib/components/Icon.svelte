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
    | "zap"
    | "load"
    | "nodes"
    | "shield"
    | "list"
    | "warning"
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
    <path d="M4 14a8 8 0 0 1 16 0" />
    <path d="M12 14l4-5" />
    <path d="M7 19h10" />
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
    <path d="M7 4h10l3 5-8 11L4 9l3-5Z" />
    <path d="M4 9h16" />
    <path d="m9 9 3 11 3-11" />
  {:else if name === "log"}
    <path d="M6 4h12v16H6z" />
    <path d="M9 8h6" />
    <path d="M9 12h6" />
    <path d="M9 16h4" />
  {:else if name === "chart"}
    <path d="M4 19h16" />
    <path d="M7 16V9" />
    <path d="M12 16V5" />
    <path d="M17 16v-4" />
  {:else if name === "gear"}
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
    <path d="M12 2.5v3" />
    <path d="M12 18.5v3" />
    <path d="m4.8 4.8 2.1 2.1" />
    <path d="m17.1 17.1 2.1 2.1" />
    <path d="M2.5 12h3" />
    <path d="M18.5 12h3" />
    <path d="m4.8 19.2 2.1-2.1" />
    <path d="m17.1 6.9 2.1-2.1" />
  {:else if name === "help"}
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.7 2.7 0 0 1 5.1 1.4c0 1.9-2.6 2.2-2.6 4" />
    <path d="M12 18h.01" />
  {:else if name === "terminal"}
    <path d="m5 7 5 5-5 5" />
    <path d="M12 17h7" />
  {:else if name === "bell"}
    <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z" />
    <path d="M10 21h4" />
  {:else if name === "monitor"}
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  {:else if name === "chevron-up"}
    <path d="m6 15 6-6 6 6" />
  {:else if name === "check"}
    <path d="m5 12.5 4.2 4.2L19 6.8" />
  {:else if name === "refresh"}
    <path d="M20 6v5h-5" />
    <path d="M4 18v-5h5" />
    <path d="M18.3 9A7 7 0 0 0 6.2 6.7L4 9" />
    <path d="M5.7 15A7 7 0 0 0 17.8 17.3L20 15" />
  {:else if name === "stop"}
    <rect x="6" y="6" width="12" height="12" rx="2" />
  {:else if name === "play"}
    <path d="m8 5 11 7-11 7V5Z" />
  {:else if name === "copy"}
    <rect x="8" y="8" width="11" height="11" rx="2" />
    <path d="M5 15H4a1.8 1.8 0 0 1-1.8-1.8V5A1.8 1.8 0 0 1 4 3.2h8.2A1.8 1.8 0 0 1 14 5v1" />
  {:else if name === "external"}
    <path d="M14 4h6v6" />
    <path d="m10 14 10-10" />
    <path d="M20 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
  {:else if name === "zap"}
    <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />
  {:else if name === "load"}
    <path d="M12 3v7" />
    <path d="m8 7 4 4 4-4" />
    <path d="M5 15v2a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-2" />
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
