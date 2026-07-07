<script lang="ts">
  import Icon from "../components/Icon.svelte";
  import LogoMark from "../components/LogoMark.svelte";
  import StatusDot from "../components/StatusDot.svelte";
  import { defaultShellStatus, type ShellStatusSummary } from "./shell-status";

  export let activeHash = "#dashboard";
  export let shellStatus: ShellStatusSummary = defaultShellStatus;

  type NavIcon =
    | "grid"
    | "gauge"
    | "layers"
    | "cube"
    | "database"
    | "artifact"
    | "log"
    | "chart"
    | "gear"
    | "help";

  type NavSection = {
    label: string;
    items: {
      label: string;
      hash: string;
      icon: NavIcon;
      statusDot?: boolean;
    }[];
  };

  const navSections: NavSection[] = [
    {
      label: "Core",
      items: [
        { label: "Dashboard", hash: "#dashboard", icon: "grid" },
        { label: "Runtime", hash: "#runtime", icon: "gauge", statusDot: true },
        { label: "Profiles", hash: "#profiles", icon: "layers" },
        { label: "Models", hash: "#models", icon: "cube" }
      ]
    },
    {
      label: "Library",
      items: [
        { label: "Builds", hash: "#builds", icon: "database" },
        { label: "Artifacts", hash: "#artifacts", icon: "artifact" }
      ]
    },
    {
      label: "Observability",
      items: [
        { label: "Logs", hash: "#logs", icon: "log" },
        { label: "Telemetry", hash: "#telemetry", icon: "chart" }
      ]
    },
    {
      label: "System",
      items: [
        { label: "Settings", hash: "#settings", icon: "gear" },
        { label: "System", hash: "#system", icon: "help" }
      ]
    }
  ];
</script>

<aside class="sidebar" aria-label="Primary navigation">
  <div class="brand-row">
    <a class="brand" href="#dashboard" aria-label="ObsidianLM dashboard">
      <LogoMark width={35} height={39} />
      <span class="brand-copy">
        <strong>ObsidianLM</strong>
        <span>Operator</span>
      </span>
    </a>
    <button class="menu-button" type="button" aria-label="Menu">
      <Icon name="menu" size={19} />
    </button>
  </div>

  <nav class="nav-stack">
    {#each navSections as section}
      <section class="nav-section" aria-label={section.label}>
        <p>{section.label}</p>
        <div class="nav-items">
          {#each section.items as item}
            <a class:active={activeHash === item.hash} href={item.hash} aria-current={activeHash === item.hash ? "page" : undefined}>
              <Icon name={item.icon} size={19} />
              <span class="nav-label">{item.label}</span>
              {#if item.statusDot}
                <span class="nav-status"><StatusDot tone={shellStatus.runtimeTone} /></span>
              {/if}
            </a>
          {/each}
        </div>
      </section>
    {/each}
  </nav>

  <footer class="operator-card">
    <div class="operator-icon">
      <Icon name="monitor" size={25} />
    </div>
    <div class="operator-copy">
      <strong>obx-operator</strong>
      <span>{shellStatus.versionLabel}</span>
    </div>
    <Icon name="chevron-up" size={15} />
  </footer>
</aside>

<style>
  .sidebar {
    position: relative;
    width: var(--sidebar-width);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--color-line);
    background:
      linear-gradient(180deg, rgba(15, 24, 40, 0.98), rgba(6, 12, 24, 0.96)),
      rgba(8, 14, 26, 0.96);
    box-shadow: 18px 0 60px rgba(0, 0, 0, 0.24);
    z-index: 3;
  }

  .brand-row {
    position: relative;
    height: var(--brand-height);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 19px 20px 15px 30px;
    border-bottom: 0;
  }

  .brand-row::after {
    content: "";
    position: absolute;
    left: 30px;
    right: 24px;
    bottom: 0;
    height: 1px;
    background: rgba(123, 143, 176, 0.13);
  }

  .brand {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    color: var(--color-text);
    text-decoration: none;
  }

  .brand-copy {
    display: grid;
    gap: 2px;
    line-height: 1;
  }

  .brand-copy strong {
    font-size: 20px;
    letter-spacing: -0.03em;
  }

  .brand-copy span {
    color: var(--color-muted);
    font-size: 13px;
    font-weight: 700;
  }

  .menu-button {
    display: grid;
    place-items: center;
    color: var(--color-muted);
    border: 0;
    background: transparent;
  }

  .menu-button {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    cursor: default;
  }

  .nav-stack {
    flex: 1;
    min-height: 0;
    padding: 20px 18px 88px 18px;
    overflow-y: auto;
    -ms-overflow-style: none;
    scrollbar-width: none;
  }

  .nav-stack::-webkit-scrollbar {
    display: none;
  }

  .nav-section + .nav-section {
    margin-top: 26px;
  }

  .nav-section p {
    margin: 0 0 10px 10px;
    color: var(--color-dim);
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.11em;
    text-transform: uppercase;
  }

  .nav-items {
    display: grid;
    gap: 0;
  }

  .nav-items a {
    position: relative;
    height: var(--nav-item-height);
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 0 12px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--color-muted);
    font-size: 14px;
    font-weight: 650;
    letter-spacing: -0.01em;
    text-decoration: none;
  }

  .nav-items a + a {
    margin-top: 8px;
  }

  .nav-items a :global(.icon) {
    color: #b7c3d8;
  }

  .nav-items a:hover {
    color: var(--color-text);
    background: rgba(255, 255, 255, 0.035);
  }

  .nav-items a.active {
    color: #fff;
    border-color: transparent;
    background: linear-gradient(90deg, #6b45d6, #7d48d8 60%, #693dc0);
    box-shadow:
      0 8px 26px rgba(97, 64, 209, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.16);
  }

  .nav-items a.active :global(.icon) {
    color: #fff;
  }

  .nav-label {
    min-width: 0;
    flex: 1;
  }

  .nav-status {
    margin-left: auto;
    display: inline-flex;
  }

  .operator-card {
    position: absolute;
    left: 18px;
    right: 18px;
    bottom: 20px;
    height: 72px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding-top: 18px;
    border-top: 1px solid rgba(133, 153, 188, 0.14);
    color: #a7b3c8;
    background: transparent;
    box-shadow: none;
  }

  .operator-icon {
    width: 31px;
    height: 31px;
    display: grid;
    place-items: center;
    color: #c5d1e5;
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .operator-copy {
    min-width: 0;
    flex: 1;
    display: grid;
    gap: 2px;
    line-height: 1.2;
  }

  .operator-copy strong {
    color: #c8d2e4;
    font-size: 13px;
    font-weight: 750;
  }

  .operator-copy span {
    color: #748197;
    font-size: 12px;
    font-weight: 750;
  }

  @media (max-width: 1120px) {
    .sidebar {
      width: 86px;
    }

    .brand-row {
      justify-content: center;
      padding: 18px 20px;
    }

    .brand-copy,
    .menu-button,
    .nav-section p,
    .nav-label,
    .operator-copy,
    .operator-card > :last-child {
      display: none;
    }

    .nav-stack {
      padding: 20px 18px 88px;
    }

    .nav-items a {
      justify-content: center;
      padding: 0;
    }

    .nav-status {
      position: absolute;
      right: 8px;
      margin-left: 0;
    }

    .operator-card {
      justify-content: center;
    }
  }
</style>
