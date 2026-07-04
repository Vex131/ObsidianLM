# ObsidianLM Design System

> Source of truth for ObsidianLM UI work. Read this before changing any UI, layout, component, color, spacing, icon, animation, or copy.

## 1. Product Identity

**Product name:** ObsidianLM  
**Product type:** Lightweight local AI runtime manager / control plane  
**Primary runtime target:** llama.cpp / `llama-server.exe`  
**Primary users:** Local AI power users, developers, and builders running models from a main Windows PC while controlling the service locally or over Tailscale.

ObsidianLM is **not** primarily a chat app and should not look like LM Studio. It is a focused operator console for starting, stopping, validating, monitoring, and switching local AI runtime profiles safely.

### Design Direction

Use a **dark, modern, professional developer-console aesthetic**:

- Matte obsidian surfaces, not glossy sci-fi.
- Compact but comfortable dashboard layout.
- Clear runtime state at all times.
- Strong command/control affordances.
- Subtle depth through borders, soft gradients, and restrained glow.
- Developer-grade trust: logs, paths, commands, ports, validation, and warnings should feel first-class.

### Design Keywords

`obsidian`, `operator console`, `runtime cockpit`, `developer tool`, `local-first`, `fast`, `safe`, `sleek`, `calm`, `precise`, `technical`, `premium but not flashy`.

## 2. Inspiration Blend

ObsidianLM should combine these reference directions without copying any one product:

| Reference style | What to borrow | What to avoid |
|---|---|---|
| Linear-style product tools | Dense but elegant layout, speed, reduced noise, clear hierarchy | Project-management visuals or marketing-page hero sections |
| Raycast-style command UI | Keyboard-first actions, fast command palette feel, compact rows | Mac-only visual assumptions or playful consumer styling |
| Vercel/Geist-style developer console | High contrast, clean grid, monochrome foundations, clear tokens | Overly sterile white/black minimalism with no personality |
| Supabase-style developer dashboard | Open-source console feel, dark code-first interface, restrained accent color | Strong green branding as the main identity |
| Modern dark AI dashboards | Atmospheric depth, softly glowing cards, status panels | Generic glassmorphism, neon overload, fake AI metrics, huge decorative blobs |

**Chosen direction:** **Obsidian Operator** — a matte dark runtime cockpit with command-palette speed and developer-console clarity.

## 3. Core UX Principles

### 3.1 State Before Controls

Every screen that can affect a runtime must show the current state before showing destructive or launch controls.

Runtime state hierarchy:

1. Service status
2. Managed runtime status
3. Active profile
4. Bound port
5. Process ID when available
6. Command preview / launch arguments
7. Warnings and safety gates
8. Logs and diagnostics

### 3.2 Safe By Default

Do not hide risky actions inside pretty buttons. Stop, restart, kill, adopt, reset, and overwrite actions must be visually distinct and must explain what they affect.

Use confirmation only for genuinely risky actions. Avoid confirmation fatigue for harmless actions like refresh, copy command, open logs, or validate profile.

### 3.3 Local-First Honesty

The UI should feel like it controls a real local machine, not a cloud SaaS. File paths, ports, process IDs, GPU names, logs, and command previews should be displayed clearly and copyably.

### 3.4 Compact, Not Cramped

This is a utility app. It should avoid large marketing-style hero blocks after Phase 0. Use compact headers, dense cards, clear tables, and resizable panels where useful.

### 3.5 One Primary Action Per Context

Each page should have one obvious primary action:

- Dashboard: Start runtime / Open runtime controls
- Runtime: Start, Stop, Restart depending on state
- Profiles: Validate / Save profile
- Models: Select model
- Builds: Select build
- Logs: Pause / Resume streaming
- Settings: Save settings

## 4. Visual Language

### 4.1 Color Palette

Use CSS custom properties. Keep the palette small and semantic.

```css
:root {
  /* Backgrounds */
  --color-bg: #06070d;
  --color-bg-elevated: #0a0d16;
  --color-bg-panel: #0e1320;
  --color-bg-panel-strong: #111827;
  --color-bg-hover: #151d2e;

  /* Borders */
  --color-border-subtle: rgba(148, 163, 184, 0.14);
  --color-border: rgba(148, 163, 184, 0.22);
  --color-border-strong: rgba(203, 213, 225, 0.32);

  /* Text */
  --color-text: #eef2ff;
  --color-text-muted: #aab6ca;
  --color-text-subtle: #748198;
  --color-text-disabled: #4f5b6f;

  /* Brand accents */
  --color-brand: #8b5cf6;
  --color-brand-soft: rgba(139, 92, 246, 0.16);
  --color-cyan: #38bdf8;
  --color-cyan-soft: rgba(56, 189, 248, 0.14);

  /* Runtime states */
  --color-success: #22c55e;
  --color-success-soft: rgba(34, 197, 94, 0.14);
  --color-warning: #f59e0b;
  --color-warning-soft: rgba(245, 158, 11, 0.14);
  --color-danger: #ef4444;
  --color-danger-soft: rgba(239, 68, 68, 0.14);
  --color-info: #38bdf8;
  --color-info-soft: rgba(56, 189, 248, 0.14);
}
```

#### Color Usage

- **Obsidian black/slate**: base shell and panels.
- **Violet**: brand identity, selected states, active navigation.
- **Cyan**: live telemetry, ports, networking, refresh/diagnostic accents.
- **Green**: running/healthy only.
- **Amber**: stale process, validation warning, partial configuration.
- **Red**: stopped by error, failed validation, destructive actions.

Never use green for a generic primary button unless the action means “start” or “running”. Never use red for non-destructive UI.

### 4.2 Backgrounds

The main background should be mostly dark, with one or two soft radial gradients. Keep gradients subtle.

Recommended base:

```css
body {
  background:
    radial-gradient(circle at 12% 0%, rgba(139, 92, 246, 0.16), transparent 34rem),
    radial-gradient(circle at 88% 8%, rgba(56, 189, 248, 0.12), transparent 28rem),
    linear-gradient(135deg, #06070d 0%, #0a0d16 46%, #0e1320 100%);
}
```

Avoid full glassmorphism as the default. Use glass-like surfaces only for:

- App sidebar
- Floating command palette
- Toasts
- Modal overlays

### 4.3 Typography

Use system fonts to keep the app lightweight. Do not add external web font loading unless the project explicitly decides to.

```css
--font-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono: "JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", ui-monospace, monospace;
```

Type scale:

| Token | Size | Use |
|---|---:|---|
| `--text-xs` | 0.75rem | labels, badges, metadata |
| `--text-sm` | 0.875rem | secondary text, nav, table rows |
| `--text-base` | 1rem | body, controls |
| `--text-lg` | 1.125rem | panel titles |
| `--text-xl` | 1.25rem | section titles |
| `--text-2xl` | 1.5rem | page titles |
| `--text-3xl` | 2rem | dashboard title only |

Rules:

- Page titles should be clear, not huge.
- Use mono font for paths, commands, ports, process IDs, timings, tokens/sec, context size, and logs.
- Use uppercase eyebrow labels sparingly.
- Avoid exaggerated letter spacing except for tiny labels.

### 4.4 Spacing

Use an 8px spacing rhythm.

```css
--space-1: 0.25rem; /* 4px */
--space-2: 0.5rem;  /* 8px */
--space-3: 0.75rem; /* 12px */
--space-4: 1rem;    /* 16px */
--space-5: 1.25rem; /* 20px */
--space-6: 1.5rem;  /* 24px */
--space-8: 2rem;    /* 32px */
--space-10: 2.5rem; /* 40px */
```

Default component spacing:

- Page padding desktop: 24px–32px
- Page padding mobile: 16px
- Panel padding: 16px–20px
- Card gap: 12px–16px
- Dense table row height: 40px–48px
- Main dashboard grid gap: 16px

### 4.5 Radius

Use rounded UI, but not soft SaaS bubbles.

```css
--radius-sm: 0.5rem;
--radius-md: 0.75rem;
--radius-lg: 1rem;
--radius-xl: 1.25rem;
--radius-pill: 999px;
```

Rules:

- Buttons: `--radius-md` or pill for compact toolbar actions.
- Cards/panels: `--radius-lg` or `--radius-xl`.
- Inputs: `--radius-md`.
- Badges: pill.
- Avoid extreme 28px+ rounded corners.

### 4.6 Shadows and Depth

Dark UI should rely more on borders and contrast than heavy shadows.

```css
--shadow-panel: 0 18px 60px rgba(0, 0, 0, 0.24);
--shadow-float: 0 24px 90px rgba(0, 0, 0, 0.42);
```

Use shadows only for elevated panels, modals, popovers, and command palette.

## 5. Layout System

### 5.1 App Shell

Desktop shell:

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │ Top status / actions                               │
│         ├────────────────────────────────────────────────────│
│         │ Main content grid                    Right inspector│
│         │ Dashboard cards / tables / logs      Context panel  │
└─────────┴────────────────────────────────────────────────────┘
```

Recommended desktop columns:

- Sidebar: 240px
- Main content: flexible, max readable width where needed
- Right inspector: 320px–380px, optional per page

Mobile shell:

- Collapse sidebar into top bar or bottom navigation.
- Runtime state summary must remain visible near the top.
- Critical actions should stack in a safe order.
- Logs should be scrollable with sticky controls.

### 5.2 Navigation

Primary sections:

1. Dashboard
2. Runtime
3. Profiles
4. Models
5. Builds
6. Logs
7. Settings

Future sections may include:

- Benchmarks
- Perplexity
- Jobs
- Adapters
- Plugins

Navigation rules:

- Show disabled future sections only if they help explain roadmap; otherwise hide until implemented.
- Active nav item uses violet/cyan accent border and subtle filled background.
- Include small status dot beside Runtime when it is running, stopped, errored, or warning.

### 5.3 Dashboard Composition

The dashboard should answer these questions immediately:

1. Is ObsidianLM service healthy?
2. Is a runtime currently managed?
3. Which profile is active?
4. Which port is llama.cpp using?
5. Are there stale or unmanaged processes?
6. What should I do next?

Recommended dashboard sections:

- Runtime hero/status panel
- Quick actions row
- Active profile summary
- Telemetry cards
- Recent logs preview
- Warnings/safety panel

### 5.4 Runtime Page Composition

Runtime page should be the most operational page.

Recommended layout:

- Left/main: status timeline, controls, command preview, validation checklist
- Right inspector: active profile, model path, build path, ports, process ID, uptime
- Bottom: streaming logs

### 5.5 Profiles Page Composition

Profiles are configuration objects. The page should feel like a precise editor, not a chat prompt form.

Recommended layout:

- Profile list
- Profile detail editor
- Validation panel
- Command preview
- Save / duplicate / delete actions

## 6. Components

### 6.1 Panels / Cards

Panels are the core surface.

```css
.panel {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, rgba(17, 24, 39, 0.86), rgba(10, 13, 22, 0.86));
  box-shadow: var(--shadow-panel);
}
```

Card variants:

- `panel-default`: normal content
- `panel-live`: runtime/telemetry content with subtle cyan edge
- `panel-warning`: amber edge and soft amber fill
- `panel-danger`: red edge and soft red fill
- `panel-code`: mono-heavy command/log panel

### 6.2 Runtime Status Card

The runtime status card is a special component and must appear on Dashboard and Runtime.

Required fields:

- Runtime state badge: Running / Stopped / Starting / Stopping / Error / Stale detected
- Runtime type: llama.cpp
- Active profile name
- Port
- Process ID if known
- Uptime if running
- Primary action based on state
- Secondary actions: Restart, Copy endpoint, Open logs

State colors:

| State | Visual |
|---|---|
| Running | green dot + green badge |
| Stopped | muted gray badge |
| Starting / Stopping | cyan badge + spinner |
| Warning / Stale | amber badge |
| Error | red badge |

### 6.3 Buttons

Button hierarchy:

| Type | Use | Style |
|---|---|---|
| Primary | Main safe action | violet/cyan gradient or solid violet |
| Secondary | Normal action | dark surface with border |
| Ghost | Low-priority toolbar action | transparent hover |
| Success | Start runtime only | green soft/solid depending context |
| Danger | Stop/kill/delete/reset | red soft with strong border; solid only for confirmed destructive action |

Rules:

- Buttons must show loading state for async actions.
- Destructive buttons should not be visually adjacent to primary safe actions without spacing or grouping.
- Use clear verbs: `Start runtime`, `Stop runtime`, `Restart`, `Validate profile`, `Copy command`.

### 6.4 Inputs

Use dark filled inputs with visible borders.

Required behavior:

- Clear focus ring using cyan or violet.
- Path inputs should support copy and browse/select later.
- Numeric runtime parameters should show units/help text.
- Invalid fields should show inline error text and mark the related validation item.

### 6.5 Badges

Use small, high-signal badges.

Badge examples:

- `llama.cpp`
- `managed`
- `unmanaged`
- `port 8085`
- `CUDA0`
- `q8_0`
- `flash-attn`
- `requires restart`

### 6.6 Command Preview

Command preview is a first-class component.

Rules:

- Use mono font.
- Preserve wrapping but avoid destroying readability.
- Provide Copy button.
- Highlight changed/important args later if useful.
- Include a note when command preview differs from currently running process.

### 6.7 Logs

Logs should look like a terminal panel, but not a fake terminal.

Rules:

- Mono font.
- Darker background than normal cards.
- Sticky toolbar with pause/resume, clear view, copy, download later.
- Severity colors: info/cyan, warn/amber, error/red, success/green.
- Preserve timestamps.
- Auto-scroll only when user is already at bottom.

### 6.8 Tables and Lists

Use compact rows for profiles, models, builds, and logs.

Rules:

- Row height: 40–48px.
- Hover state should be subtle.
- Selected row should use violet/cyan left edge or border.
- Show key metadata in columns, not hidden in menus.
- Actions can be in row-end menu, but primary row action should be obvious.

### 6.9 Modals and Command Palette

Command palette should feel Raycast-like:

- Centered floating panel
- Search input at top
- Grouped actions
- Keyboard navigable
- Shows shortcuts when available

Use command palette later for:

- Start runtime
- Stop runtime
- Switch profile
- Open logs
- Copy endpoint
- Validate profile
- Open settings

## 7. Motion and Interaction

Motion should make the app feel responsive, not decorative.

Recommended durations:

```css
--motion-fast: 120ms;
--motion-base: 180ms;
--motion-slow: 260ms;
```

Use motion for:

- Button press/hover
- Panel entrance on page load
- Status transitions
- Toasts
- Command palette open/close
- Log stream indicator

Avoid:

- Long page transitions
- Bouncy animations
- Constant pulsing glows
- Animated backgrounds that consume CPU/GPU unnecessarily

Respect `prefers-reduced-motion`.

## 8. Accessibility

Minimum requirements:

- Keyboard navigable controls.
- Visible focus states.
- Sufficient color contrast on dark backgrounds.
- Do not communicate state by color only; pair color with labels/icons.
- Buttons must have accessible names.
- Runtime status and errors should use `aria-live` where appropriate.
- Logs should remain readable with screen zoom.

## 9. Copywriting

Tone: calm, direct, technical, reassuring.

Use:

- `Runtime is running`
- `No managed runtime is active`
- `Stale llama.cpp process detected`
- `This will stop only the managed runtime`
- `Command preview`
- `Validation passed`

Avoid:

- Marketing copy like `Unlock your AI potential`
- Vague errors like `Something went wrong`
- Overly casual copy like `Oopsie`
- Fear-based warnings

Safety copy must be specific about scope.

Example:

> ObsidianLM found a llama.cpp process it did not start. It will not stop this process automatically. You can adopt it, ignore it, or stop it manually.

## 10. Page-Level Design Notes

### 10.1 Dashboard

Goal: fast overview and next action.

Must include:

- Service status
- Managed runtime status
- Active profile summary
- Port summary
- Warning panel
- Recent logs preview

Avoid:

- Huge hero text after Phase 0
- Fake usage analytics
- Decorative charts without real data

### 10.2 Runtime

Goal: operate the active managed runtime safely.

Must include:

- Start/stop/restart controls
- Runtime state
- Command preview
- Validation checklist
- Runtime endpoint
- Logs

### 10.3 Profiles

Goal: configure repeatable launch profiles.

Must include:

- Profile list
- Profile editor
- Validation state
- Command preview
- Requires-restart indicators for settings that cannot hot reload

### 10.4 Models

Goal: browse and select local model files later.

Must include when implemented:

- Folder path
- Search/filter
- Model filename
- Quantization hint if derivable
- Size
- Last modified
- Selected profile usage

### 10.5 Builds

Goal: manage llama.cpp binary folders/builds later.

Must include when implemented:

- Build path
- Detected executable
- Version/build metadata if available
- CUDA/Vulkan/CPU hints if available
- Last verified date

### 10.6 Logs

Goal: diagnose runtime/service behavior.

Must include:

- Service logs
- Runtime logs
- Filtering by severity/source
- Copy visible logs
- Pause/resume streaming

### 10.7 Settings

Goal: configure safe defaults.

Must include:

- ObsidianLM port
- Managed runtime default port
- llama.cpp folder
- Model folder
- Startup behavior
- Stale process policy
- Auth/admin token settings later

## 11. Responsive Behavior

Breakpoints:

```css
--breakpoint-sm: 640px;
--breakpoint-md: 900px;
--breakpoint-lg: 1200px;
```

Desktop:

- Sidebar visible.
- Multi-column cards.
- Optional right inspector.
- Logs can sit beside controls or below them.

Tablet:

- Sidebar can shrink or move to top.
- Two-column card grid.
- Inspector stacks below main content.

Mobile:

- Single-column layout.
- Top runtime summary remains near top.
- Buttons stack with safe order.
- Tables become cards/lists.
- Logs stay scrollable and readable.

## 12. Implementation Guidance for Svelte/Vite

Use simple, local CSS first. Do not introduce a heavy UI framework just to match this design.

Recommended component structure later:

```text
apps/web/src/lib/components/
  AppShell.svelte
  SidebarNav.svelte
  PageHeader.svelte
  Panel.svelte
  StatusBadge.svelte
  RuntimeStatusCard.svelte
  CommandPreview.svelte
  LogViewer.svelte
  ToolbarButton.svelte
  EmptyState.svelte
  WarningCallout.svelte
```

Recommended CSS structure:

```text
apps/web/src/styles/
  tokens.css
  base.css
  layout.css
  components.css
```

Do not over-componentize during early phases. Extract components when patterns repeat.

## 13. Design Acceptance Checklist

Before completing UI work, check:

- [ ] Runtime/service state is visible before controls.
- [ ] Risky actions explain what they affect.
- [ ] Colors use semantic tokens, not random hex values.
- [ ] Layout works at 320px width.
- [ ] Keyboard focus is visible.
- [ ] Loading, empty, error, warning, and success states are designed.
- [ ] Logs and commands use mono font.
- [ ] No fake metrics or decorative charts were added.
- [ ] UI remains lightweight; no heavy animation or unnecessary dependency.
- [ ] Visual style matches Obsidian Operator: dark, precise, calm, professional.

## 14. Do Not Do These

- Do not make ObsidianLM a chat-first UI.
- Do not copy LM Studio layout as the main model.
- Do not use bright neon cyberpunk styling.
- Do not use full glassmorphism everywhere.
- Do not add fake SaaS analytics.
- Do not hide command previews.
- Do not hide warnings in tiny toast messages only.
- Do not use destructive controls without clear scope.
- Do not add Next.js, Electron, Docker, or a large component framework for design alone.
- Do not use generic AI dashboard templates without adapting them to local runtime management.

## 15. Phase 14 Design Target — Approved Operator Console Reference

Phase 14 supersedes the earlier Phase 1 visual target. The current implementation has enough functionality; the priority is now to make the interface feel like a real operator console instead of one long generated dashboard.

### Approved Reference Screens

Use the three approved mockups as the primary visual reference for Phase 14 UI work:

1. **Dashboard / Command Center** — compact operator overview with runtime status first, quick actions, profile summary, warnings, command preview, logs, telemetry, and right inspector.
2. **Runtime / Managed Server** — operational runtime control page with status first, safe actions, validation checklist, command preview, startup safety, logs, and runtime inspector.
3. **Profiles / Launch Configs** — precise profile editor with profile list, grouped editor sections, validation status, command preview, and change summary.

The goal is close implementation alignment with these images: shell, density, hierarchy, grouped sidebar, top status strip, right inspector, panel rhythm, command/log surfaces, and calm developer-console tone.

Do not treat the images as decorative inspiration only. They are the intended implementation direction.

### Phase 14 Product Feel

The UI should feel like:

> A matte obsidian local runtime cockpit with developer-console clarity: state first, safe controls second, commands/logs/details always visible.

It should not feel like:

> A generic AI SaaS dashboard made of many nested cards.

### Mandatory Shell Pattern

Desktop pages should use this shell unless a page has a strong reason not to:

```text
┌───────────────┬────────────────────────────────────────────┬───────────────┐
│ Sidebar       │ Top status strip / page content             │ Inspector     │
│ 240-256px     │ flexible main workspace                     │ 320-360px     │
└───────────────┴────────────────────────────────────────────┴───────────────┘
```

Required shell elements:

- Left grouped sidebar.
- Compact top status strip visible on logged-in pages.
- Page header with small eyebrow, title, and short subtitle.
- Main workspace using fewer, stronger panels.
- Optional right inspector for selected/runtime/page details.

### Sidebar Grouping

Preferred Phase 14 navigation structure:

```text
CORE
  Dashboard
  Runtime
  Profiles
  Models

LIBRARY
  Builds
  Jobs
  Tool Inputs

OBSERVABILITY
  Logs
  Telemetry
  Processes

SYSTEM
  Settings
  System
```

Rules:

- The sidebar must be functional, not decorative.
- Active item uses violet fill and subtle border.
- Runtime item includes a small status dot for running/stopped/warning/error.
- Do not show future sections unless they are useful and visually quiet.
- Use page-local tabs for dense subsections instead of overloading the sidebar.

### Top Status Strip

The top status strip should be compact and persistent:

```text
● Service healthy | ● Runtime running | Port 8085 | Uptime 02h 41m 32s
```

It may also contain compact icon actions such as terminal, notifications, settings, and operator/session.

Rules:

- Runtime/service status must remain visible across pages.
- The strip should not become a second navbar.
- Avoid large hero headers; page titles stay compact.

### Right Inspector Pattern

Use a right inspector to remove detail clutter from the main canvas.

Good inspector content:

- Endpoint
- Process details
- Active profile
- Model path
- Build path
- Port/network
- Validation summary
- Runtime facts
- Selected model/build/job details

Inspector rules:

- Use compact detail rows, not nested cards.
- Paths and IDs should be copyable.
- Inspector can collapse or stack below content on smaller screens.

## 16. Phase 14 Page Blueprints

### 16.1 Dashboard / Command Center

Goal: answer the operational questions immediately.

Page header:

- Eyebrow: `Command center`
- Title: `ObsidianLM operator console`
- Subtitle: `Control and monitor your local llama.cpp runtimes with precision.`

Main content order:

1. Runtime Status Card
2. Quick Actions Strip
3. Active Profile Summary
4. Safety & Warnings
5. Command Preview
6. Recent Runtime Logs
7. GPU / Telemetry Summary

Right inspector:

- Endpoint
- Process
- Profile
- Model
- Build
- Validation

Dashboard rules:

- Dashboard summarizes. It must not contain full profile editors, full discovery lists, full job forms, or large settings textareas.
- Runtime Status Card must be visually dominant.
- There should be one obvious next action.

### 16.2 Runtime / Managed Server

Goal: operate the managed llama.cpp server safely.

Page header:

- Eyebrow: `Managed server`
- Title: `Control llama.cpp runtime`
- Subtitle: `Manage and operate your local llama.cpp server with precision.`

Main content order:

1. Runtime Status Card
2. Runtime action bar: Start runtime, Stop runtime, Restart, Validate, Copy endpoint
3. Validation Checklist
4. Command Preview
5. Startup & Safety
6. Runtime Logs

Right inspector:

- Active Profile
- Model Path
- Build Path
- Port & Network
- Runtime Facts

Runtime rules:

- State before controls is mandatory.
- Stop/restart actions must explain scope.
- Logs should be visible without passing through unrelated UI.
- Command preview is first-class, not hidden behind a disclosure.

### 16.3 Profiles / Launch Configs

Goal: configure repeatable launch profiles with precision.

Page header:

- Eyebrow: `Launch configs`
- Title: `Manage runtime profiles`
- Subtitle: `Create, edit, and manage runtime launch configurations.`

Desktop layout:

```text
Profile list  | Profile editor                              | Validation / Command / Changes
280-320px     | flexible main editor                         | 320-360px
```

Profile editor sections:

- Identity
- Model & Build
- Runtime Parameters
- KV Cache Settings
- GPU / Offload Settings
- Advanced Flags

Right inspector:

- Validation Status
- Command Preview
- Change Summary

Profiles rules:

- This page should feel like a configuration editor, not a dashboard.
- Use section rows and grouped fields instead of nested cards.
- `Save profile` is primary.
- `Duplicate` is secondary.
- `Delete` is danger and visually separated.
- Show `Requires restart` indicators for settings that cannot hot reload.

### 16.4 Models

Goal: browse and select local GGUF model files.

Must include:

- Folder/search/rescan toolbar.
- Compact model table/list.
- Selected model inspector.
- Quantization hint when derivable.
- Size and modified time.
- Profile usage if known.

### 16.5 Builds

Goal: browse detected llama.cpp builds/tools.

Must include:

- Rescan toolbar.
- Build list/table.
- Detected executables/tools.
- Build/version/compiler metadata if available.
- Selected build inspector.

### 16.6 Jobs

Goal: run one-shot llama.cpp tools without confusing them with the managed runtime.

Must include:

- Job type selector or tabs.
- Running job summary.
- llama-bench form.
- llama-perplexity form.
- Job history.
- Job details/logs.

Required copy:

> Jobs are one-shot tools. They do not start or replace the managed llama.cpp server runtime.

### 16.7 Logs

Goal: diagnose runtime/service behavior.

Must include:

- Source/severity/search toolbar.
- Full log viewer.
- Pause/resume streaming.
- Copy visible.
- Clear visible.

### 16.8 Telemetry / Processes

Goal: inspect local machine state.

Must include:

- GPU devices.
- GPU processes.
- llama.cpp-like process detection.
- Port status.
- Clear read-only safety copy for external processes.

### 16.9 Settings / System

Goal: configure low-frequency app and service settings.

Must include:

- Auth/session controls.
- Service mode metadata.
- Data/log directory mode.
- Default managed runtime port.
- Discovery folders if not housed under Models/Builds/Tool Inputs.

## 17. Phase 14 Visual Rules

### Reduce Nested Cards

Avoid the current “card maze” look.

Use:

- Fewer page-level panels.
- Detail rows inside panels.
- Inspector panels for secondary details.
- Tables/lists for repeated items.
- Terminal surfaces for commands/logs.

Avoid:

- Cards inside cards inside cards.
- Equal visual weight for every feature.
- Turning every metric into a bordered box.
- Multiple unrelated forms on the same page.

### Panel Hierarchy

Use these panel levels:

1. **Hero/status panel** — only for runtime status or page-critical state.
2. **Section panel** — major page region.
3. **Code/log surface** — command preview, logs, raw output.
4. **Detail row/list row** — metadata inside a panel.

Only level 1 and floating overlays should use noticeable glow/shadow.

### Action Placement

- Primary action belongs in the page header or dominant status panel.
- Runtime actions belong directly under runtime state.
- Destructive actions must be visually separated from safe actions.
- Copy/open/refresh actions should be compact toolbar actions.

### Density

- Compact is good; cramped is not.
- Use 12–16px gaps between related regions.
- Use 16–20px panel padding.
- Use compact rows for metadata.
- Keep page headers short.

### Matching the Reference Images

For Dashboard, Runtime, and Profiles, implementation should be visually compared against the approved reference images before completion.

Check:

- Sidebar grouping.
- Top status strip.
- Page header size.
- Dominant runtime status card.
- Right inspector presence and content.
- Reduced nested cards.
- Command/log surfaces.
- Semantic accent colors.

## 18. Phase 14 Implementation Guidance

### Routing

Use lightweight hash navigation first:

```text
#dashboard
#runtime
#profiles
#models
#builds
#jobs
#logs
#telemetry
#settings
#system
```

Do not add a routing dependency just for Phase 14.

### Recommended Layout Components

```text
apps/web/src/lib/layout/
  AppShell.svelte
  SidebarNav.svelte
  PageHeader.svelte
  TopStatusStrip.svelte
  InspectorPanel.svelte
```

### Recommended Page Components

```text
apps/web/src/lib/pages/
  DashboardPage.svelte
  RuntimePage.svelte
  ProfilesPage.svelte
  ModelsPage.svelte
  BuildsPage.svelte
  JobsPage.svelte
  LogsPage.svelte
  TelemetryPage.svelte
  SettingsPage.svelte
  SystemPage.svelte
```

### Recommended Shared Components

```text
apps/web/src/lib/components/
  ActionTile.svelte
  CommandPreview.svelte
  CopyButton.svelte
  DetailRow.svelte
  LogViewer.svelte
  PathField.svelte
  SectionPanel.svelte
  StatusBadge.svelte
  ValidationChecklist.svelte
```

### Refactor Order

1. Update design source of truth.
2. Add hash navigation and shell.
3. Extract shared visual primitives.
4. Build Dashboard page.
5. Build Runtime page.
6. Build Profiles page.
7. Move remaining panels to focused pages.
8. Update E2E smoke tests and capture comparison screenshots.

### State Management Rule

Do not rewrite all data loading at the same time as the UI refactor.

Recommended first pass:

- Keep existing API calls/state in `App.svelte` if needed.
- Pass state/actions into page components.
- Extract state into modules only after the page structure is stable.

## 19. Phase 14 Acceptance Checklist

- [ ] Sidebar navigation is functional.
- [ ] Dashboard, Runtime, and Profiles match the approved reference direction.
- [ ] The app is no longer one long page.
- [ ] Dashboard summarizes instead of hosting every tool.
- [ ] Runtime page has state before controls.
- [ ] Profiles page feels like an editor.
- [ ] Right inspector is used for dense details.
- [ ] Commands, paths, ports, validation, warnings, and logs remain visible and copyable.
- [ ] Nested card usage is reduced.
- [ ] No fake analytics or decorative charts are added.
- [ ] No new heavy frontend framework or router dependency is added.
- [ ] Mobile layout remains usable at 320px width.
- [ ] Keyboard focus is visible.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes.
- [ ] `npm run test` passes.
- [ ] `npm run test:e2e` passes or any failure is documented accurately.

