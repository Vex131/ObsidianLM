# ObsidianLM Design System

> Source of truth for ObsidianLM UI work. Read this before changing any UI, layout, component, color, spacing, icon, animation, or copy.

## 1. Product Identity

**Product name:** ObsidianLM  
**Product type:** Lightweight local AI runtime manager / control plane  
**Primary runtime target:** llama.cpp / `llama-server.exe`  
**Primary users:** Local AI power users, developers, and builders running models from a main Windows PC while controlling the service locally or over Tailscale.

ObsidianLM is **not** primarily a chat app and should not look like LM Studio. It is a focused operator console for starting, stopping, validating, monitoring, and switching local AI runtime configuration safely.

**Architecture status:** the current implementation uses one selected Build and one managed llama.cpp router. `router-runtime-state.json` is current lifecycle authority; `runtime-state.json` is preserved legacy evidence. App shell, Runtime, and Dashboard read `RouterRuntimeState` directly and do not rely on an active Profile. Run 7 implements same-Build model loading through llama.cpp's management API without a router restart, plus explicit preflight/stop/release/start/load cross-Build replacement on the stable endpoint. Run 8 adds conservative read-only router-child process, GPU, and forwarded-log attribution without child lifecycle authority. Run 9 assigns configuration-facing responsibility as follows: Profiles edits authoritative Configured Models; Models shows Configured Model/Artifact relationships and router-reported model state; Builds owns stable Build readiness, dependencies, and generated artifacts. Run 10 assigns Runtime ownership of managed router lifecycle and the Configured Model drawer, and Dashboard ownership of high-level active Build/loaded-model/resource summary. Profile compatibility actions load only stopped or same-Build targets and never hide a cross-Build restart; cross-Build replacement has no automatic rollback. `/api/profiles` and `activeProfileId` remain compatibility only. Phase 15 product foundation (Runs 1–10) is complete; Run 11 full certification remains incomplete pending B3/B11 evidence — see `docs/validation/phase15-run11.md`.

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

### Current Dashboard Baseline

`docs/design/reference/obsidianlm-dashboard.html` is the current dashboard visual baseline. The implemented Dashboard page establishes the reusable shell, sidebar, top header, page heading, panel, status, meter, card, and dense data-row conventions for future pages.

Common visual primitives and tokens belong in `apps/web/src/styles.css`; component-local styles should only cover page- or component-specific layout. Later pages should follow the Dashboard heading rhythm, 10px dashboard card gaps, matte panel treatment, mini status pills, mono value styling, and compact log/table surfaces unless a page has a specific reason to diverge.

## 3. Core UX Principles

### 3.1 State Before Controls

Every screen that can affect a runtime must show the current state before showing destructive or launch controls.

Runtime state hierarchy:

1. Service status
2. Managed runtime/router status
3. Active llama.cpp build
4. Router endpoint
5. Configured models and router-reported model state when known
6. Process ID and proven child-process information when available
7. Command/preset preview
8. Warnings and safety gates
9. Logs and diagnostics

Legacy active-profile fields remain available only as a compatibility projection where required by the API. Runtime UI should lead with Build/router state and the configured-model catalog; `activeProfileId` is not lifecycle authority.

Router-mode model state accommodates concepts such as available/unloaded, loading, loaded, sleeping, and unavailable/error without hardcoding upstream labels. Router health and router catalog are separate views: bounded health comes from `GET /health`, while configured-model availability/load state comes from `GET /models`; `/models/sse` remains optional future work.

### 3.2 Safe By Default

Do not hide risky actions inside pretty buttons. Stop, restart, kill, reset, and overwrite actions must be visually distinct and must explain what they affect. Process adoption must not be offered unless a future phase can prove ownership safely.

Use confirmation only for genuinely risky actions. Avoid confirmation fatigue for harmless actions like refresh, copy command, open logs, or validate profile.

### 3.3 Local-First Honesty

The UI should feel like it controls a real local machine, not a cloud SaaS. File paths, ports, process IDs, GPU names, logs, and command previews should be displayed clearly and copyably.

In planned Phase 16 Controller Mode, "local-first" means honest machine ownership rather than pretending every resource belongs to the browser or Controller host. Every operational screen must keep the active Node visible, label remote paths as Node-local, and avoid presenting last-known remote state as live state.

### 3.4 Compact, Not Cramped

This is a utility app. It should avoid large marketing-style hero blocks after Phase 0. Use compact headers, dense cards, clear tables, and resizable panels where useful.

### 3.5 One Primary Action Per Context

Each page should have one obvious primary action:

- Dashboard: Start runtime / Open runtime controls
- Runtime: Start, Stop, Restart depending on state
- Profiles/configurations: Validate / Save configuration
- Models: Configure model / Switch model
- Builds: Validate build / Switch build and restart router when required
- Logs: Pause / Resume streaming
- Settings: Save settings

## 4. Visual Language

### 4.1 Color Palette

Use CSS custom properties. Keep the palette small and semantic.

```css
:root {
  /* Backgrounds */
  --color-bg: #050914;
  --color-bg-elevated: #07101d;
  --color-panel: rgba(17, 27, 43, 0.86);
  --color-panel-strong: rgba(14, 23, 38, 0.96);

  /* Borders */
  --color-line: rgba(116, 137, 171, 0.18);
  --color-line-strong: rgba(133, 153, 184, 0.24);

  /* Text */
  --color-text: #e8eefb;
  --color-muted: #a5b1c7;
  --color-dim: #69758b;

  /* Brand accents */
  --color-purple: #8f5cff;
  --color-purple-strong: #6c3ee7;
  --color-cyan: #42d7e8;

  /* Runtime states */
  --color-green: #59dc7a;
  --color-amber: #f4b95f;
  --color-red: #ff6b7a;

  /* Shell */
  --sidebar-width: 296px;
  --topbar-height: 68px;
  --brand-height: 75px;
  --nav-item-height: 38px;
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
    radial-gradient(circle at 74% 3%, rgba(72, 86, 132, 0.18), transparent 25%),
    linear-gradient(135deg, #04070f 0%, #07101b 52%, #050913 100%);
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

Desktop shell follows the dashboard reference:

```text
┌──────────────────────────────────────────────────────────────┐
│ Sidebar │ Top status / actions                               │
│         ├────────────────────────────────────────────────────│
│         │ Main content grid                    Right inspector│
│         │ Dashboard cards / tables / logs      Context panel  │
└─────────┴────────────────────────────────────────────────────┘
```

Desktop dimensions:

- Sidebar: `296px`
- Top header: `68px`
- Brand row: `75px`
- Nav item height: `38px`
- Dashboard grid: `minmax(0, 1.45fr) minmax(340px, .9fr)` with `10px` gaps

Mobile shell:

- At tablet widths, collapse sidebar to `86px`, hide labels/headings/brand copy, and keep centered icons with the Runtime status indicator.
- At mobile widths, hide the sidebar and stack cards.
- Runtime state summary must remain visible near the top through the dashboard hero; the centered top-header status strip hides on tablet/mobile.
- Critical actions should stack in a safe order.
- Logs should be scrollable with sticky controls.

### 5.2 Navigation

Primary sections:

1. Dashboard
2. Runtime
3. Profiles
4. Models
5. Builds
6. Jobs
7. Logs
8. Telemetry
9. Settings
10. System

Future sections may include:

- Benchmarks
- Perplexity
- Adapters
- Plugins

Navigation rules:

- Show disabled future sections only if they help explain roadmap; otherwise hide until implemented.
- Active nav item uses the reference violet gradient fill and soft purple shadow.
- Include small status dot beside Runtime when it is running, stopped, errored, or warning.

### 5.3 Dashboard Composition

The dashboard should answer these questions immediately:

1. Which Node is active, and is it local, remote, online, or offline?
2. Is that Node's ObsidianLM service healthy?
3. Is a runtime currently managed on that Node?
4. Which configured model is selected, and which model is loaded?
5. Which llama.cpp build is active?
6. Which configured models are available and which model is loaded, if known?
7. Which port is llama.cpp using on that Node?
8. Are there stale or unmanaged processes?
9. What should I do next?

Recommended dashboard sections:

- Runtime hero/status panel
- Quick Actions
- Active Build and Model Details
- Recent Events
- Health Checklist
- Resource Snapshot
- Performance Log

### 5.4 Runtime Page Composition

Runtime page should be the most operational page.

Recommended layout:

- Left/main: status timeline, controls, command preview, validation checklist
- Right inspector: active build, router endpoint, available/loaded model state, selected configuration, paths, process IDs, uptime
- Bottom: streaming logs

### 5.5 Profiles Page Composition

Profiles edits authoritative Configured Models. The page should feel like a precise editor, not a chat prompt form, while preserving legacy Profile compatibility.

The Profiles editor is capability-driven. A new unsaved draft initially shows only discovered Model and llama.cpp Build selectors; applicable controls appear progressively after the selected build is inspected. llama.cpp defaults are inherited, not copied into every profile: an inherited field stores no override and emits no flag. ObsidianLM-managed host and port defaults remain a separate runtime-management contract.

Recommended layout:

- Profile list
- Profile detail editor
- Validation panel
- Command preview
- Save / duplicate / delete actions

Real-build validation checklist:

1. Configure and rescan a real llama.cpp build folder.
2. Select an official discovered build and confirm version, help flags, and devices appear.
3. Select a custom discovered build and confirm unknown flags remain visible under Build-specific options.
4. Select a discovered model and confirm the new draft begins with sparse llama.cpp overrides.
5. Change one override and confirm preview emits only it plus model, host, and port.
6. Change builds and confirm incompatible overrides warn without disappearing.
7. Do not start a runtime unless performing a separate explicit runtime smoke test.

## 6. Components

### 6.1 Panels / Cards

Panels are the core surface.

```css
.panel {
  border: 1px solid var(--color-line-strong);
  border-radius: var(--radius-md);
  background: linear-gradient(180deg, rgba(18, 29, 47, .95), rgba(12, 20, 34, .96));
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
- Active Build/router, with legacy active Profile projection where applicable
- Configured models and their router state when known; do not infer loaded state from the router parent PID
- Port
- Router/runtime process ID if known
- Proven child-process summary when available
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
- Current mode shows the model-bound `llama-server` command.
- Current router mode shows two separate copyable views: the router launch command and the generated model-preset INI.
- Label generated INI as a derived artifact, not the authoritative editable configuration.
- Runtime owns the Configured Model drawer and presents the active router configuration plus the actual router launch command.

### 6.7 Logs

Logs should look like a terminal panel, but not a fake terminal.

Rules:

- Mono font.
- Darker background than normal cards.
- Sticky toolbar with pause/resume, clear view, copy, download later.
- Severity colors: info/cyan, warn/amber, error/red, success/green.
- Preserve timestamps.
- Auto-scroll only when user is already at bottom.
- Make source clear enough to distinguish service logs, router lifecycle output, router/model-child output, and one-shot job logs.
- Do not promise per-child separation until the selected Windows build's router output has been validated.

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
- Switch model
- Switch build and restart router
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
- `No managed router is active`
- `Switch model`
- `Switch build & restart router`
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

> ObsidianLM found a llama.cpp process it did not start. It will not adopt or stop this process. Stop it manually only if you know it is safe to do so.

## 10. Page-Level Design Notes

### 10.1 Dashboard

Goal: fast overview and next action.

Must include:

- Active Node and online/offline state when Phase 16 is implemented
- Service status
- Managed runtime status
- Active Build/router summary; legacy active-profile summary only for compatibility projection
- Available/loaded model state when safely known
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

- Active Node and whether runtime state is live or last-known when Phase 16 is implemented
- Start/stop/restart controls
- Runtime state
- Router launch command preview and generated preset preview
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
- Clear build requirement and router alias after the Phase 15 data model is implemented
- Legacy import/migration state when an old profile cannot be mapped safely

### 10.4 Models

Goal: distinguish discovered local model artifacts from configured model presets.

Implemented behavior: Models displays GGUF artifacts discovered in configured model folders. Definitive whitelisted GGUF metadata is authoritative for classification; filename heuristics provide fallback or supporting evidence when metadata is inconclusive. Catalog synchronization stores the effective classification evidence. If authoritative metadata conflicts with a configured base-Model or projector role, synchronization retains the stable Artifact identity but marks the role invalid. The selected-artifact inspector performs bounded header/KV inspection without loading tensor data or starting llama.cpp, shows Configured Model relationships and router observation, and can open an unsaved Profiles draft with the artifact preselected.

Discovery IDs remain path-derived and do not survive a move or folder rename. Projector matches are candidates only; Models does not persist model/projector relationships. Configured router models, aliases, presets, and explicit switching are current Phase 15 contracts (Runs 9–10 UI included).

Current and forward-looking requirements:

- Owning Node and local/remote source
- Folder path
- Search/filter
- Model filename
- Quantization hint if derivable
- Size
- Last modified
- Configured Model relationships and router observation
- Configured-model identities/aliases that reference the artifact
- Optional `mmproj` association and text-only versus multimodal configuration state when implemented
- `Switch model` when available under the active build, or `Switch build & restart router` when another build is required
- Managed/unmanaged source status when the router exposes cache- or environment-visible models outside ObsidianLM's configured catalog

### 10.5 Builds

Goal: manage llama.cpp binary folders/builds independently from model artifacts and configured models.

Implemented Phase 14 behavior: Builds is a read-only discovered toolchain library. It scans only configured roots with bounded, symlink-safe recursion; keeps distinct `llama-server` executables separate; associates same-directory companion tools; and lazily reuses the Profiles capability manifest for version, flags, devices, backend hints, provenance hints, and profile dependencies. Discovery identities remain path-derived and machine-local.

`Router candidate` means required router CLI options were statically detected in parsed `--help` output. It is not functional router validation. Run 4/6 separately provide functional Build validation and managed router lifecycle; launch still requires current capability evidence and strict `/health`/`/models` reconciliation.

Must include when implemented:

- Owning Node and local/remote source
- Build path
- Detected executable
- Version/build metadata if available
- CUDA/Vulkan/CPU hints if available
- Last verified date
- Router capability validation for the selected executable
- Safe unsupported-build status: not eligible for managed router use unless a separately designed legacy compatibility mode exists
- Configured models that depend on the build before it is changed or removed

### 10.6 Logs

Goal: diagnose runtime/service behavior.

Must include:

- Node and source labels on every remote log stream/history view
- Service logs
- Router/runtime lifecycle logs
- Router/model-child output when available
- One-shot job logs as a separate source
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
- Known Node connections, active Node selection, and connection removal when Phase 16 is implemented; credentials are never displayed in normal responses

### 10.8 Controller and Node Details (Phase 16 Planning)

The shell must make the operated machine unambiguous. Add a Node selector in the shell or top status area and retain a persistent active-Node indicator even when only one Node is configured. Compact states may read `Active Node: Local` or `Active Node: Home PC · Online · Windows · 2 GPUs · Router running`. Controller-only Mode must not imply that the Controller laptop is also managed as a Local Node; Local Node capability is an explicit future/optional role.

Node cards show `Local` or `Remote`, connection state, display name, stable identity, endpoint, protocol/version, and capabilities without exposing credentials. A Node endpoint is displayable operational configuration, not a credential. Remote paths stay copyable but are labeled as paths on the selected Node; the Controller must never imply that it can browse them through its own filesystem.

Offline is not stopped. When a Node is unreachable, show `Node offline/unreachable`, the last update time, and clearly marked last-known runtime state such as `Last known router state: Running`. Disable destructive or state-changing actions until current state is available. Cached data may remain visible only with stale/last-known labeling.

Connection UI must account for `Online`, `Offline`, `Identity mismatch`, `Authentication required`, `Capability limited`, `Version incompatible`, and `Configuration conflict` without prescribing final components or copy. An identity mismatch blocks privileged actions and requires explicit re-pairing; editing an endpoint must not silently redefine the saved Node identity. Configuration conflicts preserve the newer authoritative Node state and explain that the attempted save was not applied.

Capability negotiation controls availability. Unsupported or version-incompatible actions remain disabled with a reason rather than disappearing, being attempted optimistically, or falling back to a generic command. Destructive and lifecycle copy names the target, for example `Restart router on Home PC`, `Stop runtime on Home PC`, or `Cancel job on Home PC`. Removing a connection explains that it does not stop the Node, uninstall its service, or delete its models, configuration, logs, jobs, or runtime state.

Connection management must never present SSH as the normal transport. Tailscale must be described as encrypted connectivity, not ObsidianLM authentication; application authentication remains required. These are Phase 16 requirements only; they do not redesign the current Obsidian Operator visual language or claim that Controller/Node support exists today.

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

## 15. Dashboard Reference Baseline

The dashboard reference in `docs/design/reference/obsidianlm-dashboard.html` supersedes earlier Phase 14 shell dimensions where they conflict. The current priority is to keep the interface aligned with this real operator-console baseline.

Phase 14 is complete. Dashboard, Runtime, Profiles, Models, Builds, Jobs, Logs, Telemetry, Settings, and System are focused operator-console pages. Existing reference copy that says `profile` or `managed server` may describe legacy compatibility surfaces; current runtime state is Build/router based. Runs 9–10 configuration and Runtime/Dashboard integration are implemented. Phase 15 product foundation (Runs 1–10) is complete; Run 11 real-machine certification remains incomplete pending B3/B11 evidence under correct matrix IDs (see `docs/validation/phase15-run11.md`).

### Approved Reference Screens

Use the dashboard reference as the primary visual reference for shell and dashboard UI work:

1. **Dashboard / Command Center** — compact operator overview with runtime status first, quick actions, active Build/loaded-model/resource summary, recent events, health checklist, and performance log.
2. **Runtime / Managed Server** — should reuse the shell, heading, panel, status, and log conventions established by the dashboard.
3. **Profiles / Launch Configs** — should reuse the same matte panels, grouped detail sections, compact rows, and status pills.

The goal is close implementation alignment with the reference: shell, density, hierarchy, grouped sidebar, top status strip, panel rhythm, card/log surfaces, and calm developer-console tone.

Do not treat the images as decorative inspiration only. They are the intended implementation direction.

### Phase 14 Product Feel

The UI should feel like:

> A matte obsidian local runtime cockpit with developer-console clarity: state first, safe controls second, commands/logs/details always visible.

It should not feel like:

> A generic AI SaaS dashboard made of many nested cards.

### Mandatory Shell Pattern

Desktop pages should use this shell unless a page has a strong reason not to:

```text
┌────────────────┬───────────────────────────────────────────────────────────┐
│ Sidebar        │ Top status strip / scrollable page content                │
│ 296px          │ flexible dashboard/page workspace                         │
└────────────────┴───────────────────────────────────────────────────────────┘
```

Required shell elements:

- Left grouped sidebar.
- Compact top status strip visible on logged-in pages.
- Page header with title and short subtitle.
- Main workspace using fewer, stronger panels.
- Optional right-column panels or inspector content inside the page workspace when the page needs dense details.

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

OBSERVABILITY
  Logs
  Telemetry

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
● Service healthy | ● Router running | Build: Latest Official | Port 8085 | Uptime 02h 41m 32s
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
- Router and proven child-process details
- Active build
- Available and loaded model state
- Selected model configuration/preset
- Model and optional mmproj paths
- Build path and validation
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
3. Active Build / Loaded Model / Resource Summary
4. Safety & Warnings
5. Active Router Configuration and Launch Command
6. Recent Runtime Logs
7. GPU / Process / Resource Summary

Right inspector:

- Endpoint
- Process
- Profile
- Model
- Build
- Validation

The active summary is Build/router state plus configured-model availability. Legacy Profile details may appear as a compatibility projection; the summary must not imply that model selection restarts the runtime.

Dashboard rules:

- Dashboard summarizes. It must not contain full profile editors, full discovery lists, full job forms, or large settings textareas.
- Runtime Status Card must be visually dominant.
- There should be one obvious next action.
- In Phase 16, the active Node and whether displayed state is live or last-known remain visible above runtime actions.

### 16.2 Runtime / Managed Runtime

Goal: operate the managed Build-selected llama.cpp router safely.

Page header:

- Eyebrow: `Managed runtime`
- Title: `Control llama.cpp runtime`
- Subtitle: `Manage the active llama.cpp runtime, endpoint, and lifecycle with precision.`

Main content order:

1. Runtime Status Card
2. Runtime action bar: Start runtime, Stop, Restart, Validate, Copy endpoint
3. Validation Checklist
4. Active Router Configuration, Actual Launch Command, and Generated Preset Preview
5. Startup & Safety
6. Runtime Logs

Right inspector:

- Active Build
- Available Configured Models
- Router Model State (for example unloaded, loading, loaded, sleeping, or unavailable/error) when known
- Model / mmproj Path for the selected configuration
- Build Path
- Port & Network
- Runtime Facts

Runtime rules:

- State before controls is mandatory.
- Stop/restart actions must explain scope.
- Logs should be visible without passing through unrelated UI.
- Command preview is first-class, not hidden behind a disclosure.
- Profile start loads its mapped model when stopped or under the same active Build. A different Build requires the explicit cross-Build replacement action.
- Same-Build switching keeps the router PID, Runtime ID, command, and endpoint; llama.cpp owns `models-max=1` eviction and ObsidianLM issues no normal unload.
- Cross-Build switching preflights before source stop, verifies port release, starts on the same endpoint, and does not automatically roll back on target failure.
- Do not infer loaded model or GPU ownership solely from the router PID.
- In Phase 16, controls name the target Node and are disabled while that Node is offline or lacks the required capability.

### 16.3 Profiles / Model Configurations

Goal: edit authoritative Configured Models while preserving the legacy Profile compatibility surface.

Page header:

- Eyebrow: `Model configs`
- Title: `Manage model configurations`
- Subtitle: `Configure model identity, build requirements, and llama.cpp preset parameters.`

Desktop layout:

```text
Profile list  | Profile editor                              | Validation / Command / Changes
280-320px     | flexible main editor                         | 320-360px
```

Profile editor sections:

- Identity
- Model artifact, optional mmproj, and Build requirement
- Router alias
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
- Show `Requires build switch` for configurations outside the active build.
- Do not show `Requires restart` for same-build model selection merely because the historical profile flow restarted a server.
- Keep legacy profile import/export and migration status visible until compatibility work is complete.
- `/api/profiles` and `activeProfileId` are compatibility only; they are not lifecycle or loaded-model authority.

### 16.4 Models

Goal: browse local GGUF artifacts and the configured model presets that reference them.

Must include:

- Folder/search/rescan toolbar.
- Owning Node plus clear remote-path labels in Phase 16.
- Compact model table/list.
- Selected model inspector.
- Quantization hint when derivable.
- Size and modified time.
- Configured Model relationships if known.
- Optional mmproj candidates/association without automatic same-directory pairing claims.
- Separate artifact identity from each configured model identity and router alias.

### 16.5 Builds

Goal: browse detected llama.cpp builds/tools and understand configured-model dependencies.

Must include:

- Rescan toolbar.
- Owning Node plus clear remote-path labels in Phase 16.
- Build list/table.
- Detected executables/tools.
- Build/version/compiler metadata if available.
- Static router flag/preset capability evidence plus separate functional Build validation; current launch requires both.
- Readiness counts/checks use authoritative Configured Models, stable cataloged Builds, and router-eligible Builds; discovery remains evidence.
- Clear ineligible/unsupported state when a build lacks required router behavior; version labels alone are not proof of capability.
- Official/custom/experimental/compatibility classification only when known or explicitly configured.
- Dependent configured models and whether selecting one requires a router restart.
- Selected build inspector.

### 16.6 Jobs

Goal: run one-shot llama.cpp tools without confusing them with the managed runtime.

Must include:

- Job type selector or tabs.
- Selected Node, build/tool, model artifact, and dataset/input in Phase 16.
- Running job summary.
- llama-bench form.
- llama-perplexity form.
- Job history.
- Job details/logs.
- Clear copy that jobs execute on the selected Node and do not transfer model/dataset files through the Controller.

Required copy:

> Jobs are one-shot tools. They do not become runtime model instances or replace the managed llama.cpp runtime.

### 16.7 Logs

Goal: diagnose runtime/service behavior.

Must include:

- Source/severity/search toolbar.
- Node/source labels, bounded recent history, reconnect state, and safe refresh/resumption in Phase 16.
- Full log viewer.
- Pause/resume streaming.
- Copy visible.
- Clear visible.
- Current source distinctions for managed runtime stdout/stderr/system entries, persisted job logs, and bounded service-wrapper files.
- Router lifecycle and router/child origin metadata are current Phase 15 contracts with Runtime/Dashboard/Logs UI integration from Runs 8–10; remote Node-labelled streams remain Phase 16 work.

### 16.8 Telemetry / Processes

Goal: inspect the selected Node's machine state without treating remote telemetry as Controller-local evidence.

Must include:

- Active Node plus live/offline/last-known state in Phase 16.
- GPU devices.
- GPU processes.
- llama.cpp-like process detection.
- Managed router, proven router-child, previous-candidate, unmanaged, and unknown classifications from Run 8.
- Port status.
- Clear read-only safety copy for external processes.
- Unknown processes remain warning-only; managing one router never grants ownership of every `llama-server.exe`.
- Process ownership and GPU classification come from the Node; the Controller does not independently infer ownership.

### 16.9 Settings / System

Goal: configure low-frequency app and service settings.

Must include:

- Clear local-access status without credential, token-setup, or browser-unlock controls.
- Known Nodes, active Node selection, capability/version state, and safe connection removal in Phase 16.
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

- [x] Sidebar navigation is functional.
- [x] Dashboard, Runtime, and Profiles match the approved reference direction.
- [x] The app is no longer one long page.
- [x] Dashboard summarizes instead of hosting every tool.
- [x] Runtime page has state before controls.
- [x] Profiles page feels like an editor.
- [x] Right inspector is used for dense details.
- [x] Commands, paths, ports, validation, warnings, and logs remain visible and copyable.
- [x] Nested card usage is reduced.
- [x] No fake analytics or decorative charts are added.
- [x] No new heavy frontend framework or router dependency is added.
- [x] Mobile layout remains usable at 320px width.
- [x] Keyboard focus is visible.
- [x] `npm run typecheck` passes.
- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] `npm run test` passes.
- [x] `npm run test:e2e` passes.
