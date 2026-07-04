# ObsidianLM Phase 14 — Operator Interface Redesign Plan

## Purpose

Revise the ObsidianLM web interface to match the three approved reference mockups as closely as practical while preserving the existing Vite + Svelte SPA architecture and current backend behavior.

The current UI has the right raw functionality, but it reads like one long generated dashboard: the sidebar is decorative, every feature is stacked into one page, and many panels are nested inside other panels. Phase 14 turns it into a real operator console with page-level structure, a persistent runtime/status shell, focused pages, and fewer but stronger surfaces.

## Approved reference screens

Use these images as the visual target:

1. `obsidianlm_reference_dashboard.png` — Dashboard / command center
2. `obsidianlm_reference_runtime.png` — Dedicated Runtime page
3. `obsidianlm_reference_profiles.png` — Dedicated Profiles editor

These are not just moodboards. They define the desired shell, navigation style, panel density, inspector pattern, top status strip, action grouping, and visual hierarchy.

## Non-goals

- Do not add SvelteKit, Next.js, Electron, Docker, a database, a router dependency, or a heavy UI framework.
- Do not change backend API behavior unless a tiny frontend-supporting field is clearly required.
- Do not make ObsidianLM chat-first.
- Do not create fake analytics or decorative charts.
- Do not hide commands, paths, ports, logs, warnings, or validation.
- Do not implement every page as a new full rewrite at once.
- Do not preserve the current one-long-page structure.

## Design target summary

The new interface should feel like:

> A matte obsidian local runtime cockpit with developer-console clarity: state first, then safe controls, then commands/logs/details.

It should not feel like:

> A generic AI SaaS dashboard made of many nested cards.

## Current UI problems to fix

### 1. Sidebar is decorative

Current sidebar items exist visually, but they do not switch pages. Phase 14 must make the sidebar functional.

### 2. Everything renders on one long page

Runtime, jobs, GPU, profiles, models, builds, logs, and settings currently compete in one scroll. Phase 14 must split this into focused pages.

### 3. Too many equal-weight cards

The screenshot shows many panels with similar weight. The approved mockups use fewer panels with stronger hierarchy:

- Runtime Status Card first
- Quick Actions row second
- Inspector for details
- Command/log panels as first-class technical surfaces

### 4. Stale copy and unclear hierarchy

Remove stale phase-specific hero copy such as `Phase 12 llama-perplexity jobs`. Use page-specific headers.

### 5. Long forms are not treated as editors

Profiles should feel like a precise configuration editor with sections, restart indicators, validation, command preview, and change summary.

---

# Phase structure

## Phase 14A — Lock the design source of truth

### Files

- `DESIGN.md`

### Work

- Update `DESIGN.md` with the Phase 14 reference target.
- Add explicit rules for matching the approved reference screens.
- Add anti-patterns for avoiding the current nested-card / generic-AI-dashboard look.
- Define Dashboard, Runtime, and Profiles page blueprints.
- Define the required shell: grouped sidebar, top status strip, main workspace, optional right inspector.

### Acceptance

- `DESIGN.md` clearly says the three reference screens are the implementation target.
- `DESIGN.md` no longer leaves the older Phase 1 target as the latest UI target.

---

## Phase 14B — Add real navigation and app shell

### Files to add

```text
apps/web/src/lib/navigation.ts
apps/web/src/lib/layout/AppShell.svelte
apps/web/src/lib/layout/SidebarNav.svelte
apps/web/src/lib/layout/PageHeader.svelte
apps/web/src/lib/layout/TopStatusStrip.svelte
apps/web/src/lib/layout/InspectorPanel.svelte
```

### Files to modify

```text
apps/web/src/App.svelte
apps/web/src/styles.css
```

### Navigation model

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

No router dependency is needed.

### Sidebar target

Match the reference images with grouped navigation:

```text
ObsidianLM
Operator

CORE
  Dashboard
  Runtime     ● running/stopped/warning dot
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

If the sidebar gets too tall, hide lower-priority items behind page-local tabs later, not nested cards.

### App shell layout

Desktop:

```text
┌───────────────┬────────────────────────────────────────────┬───────────────┐
│ Sidebar       │ Top status strip / page content             │ Inspector     │
│ 240-256px     │ flexible main workspace                     │ 320-360px     │
└───────────────┴────────────────────────────────────────────┴───────────────┘
```

The right inspector can be hidden on pages that do not need it.

### Acceptance

- Sidebar links change the visible page.
- Active nav item updates.
- Refresh keeps the selected page.
- Unknown hash falls back to `#dashboard`.
- Top status strip is visible across logged-in pages.
- `App.svelte` starts moving toward orchestration instead of owning all layout markup.

---

## Phase 14C — Build shared visual primitives

### Files to add or refactor

```text
apps/web/src/lib/components/StatusBadge.svelte
apps/web/src/lib/components/CopyButton.svelte
apps/web/src/lib/components/DetailRow.svelte
apps/web/src/lib/components/SectionPanel.svelte
apps/web/src/lib/components/ActionTile.svelte
apps/web/src/lib/components/ValidationChecklist.svelte
apps/web/src/lib/components/CommandPreview.svelte
apps/web/src/lib/components/LogViewer.svelte
apps/web/src/lib/components/PathField.svelte
```

Keep existing components if useful:

```text
Panel.svelte
StatusPill.svelte
TerminalBlock.svelte
ToolbarButton.svelte
MetricRow.svelte
```

But make sure the final UI does not look like every detail is a card.

### Component rules

#### Panels

Use panels for page sections only. Do not nest full panels inside full panels except for code/log containers.

#### Detail rows

Use compact rows inside inspector panels instead of mini-cards.

#### Action tiles

Use action tiles only for major quick actions. Avoid turning every control into an action tile.

#### Code/log surfaces

Command preview and logs should have darker terminal-like surfaces, monospace text, copy controls, and sticky toolbars where useful.

### Acceptance

- Visual primitives can reproduce the three mockup layouts.
- CSS avoids random new colors; semantic tokens are used.
- Components work with keyboard focus states.

---

## Phase 14D — Dashboard page

### Files to add

```text
apps/web/src/lib/pages/DashboardPage.svelte
apps/web/src/lib/inspectors/DashboardInspector.svelte
apps/web/src/lib/components/runtime/RuntimeStatusCard.svelte
apps/web/src/lib/components/runtime/QuickActionsStrip.svelte
apps/web/src/lib/components/runtime/ActiveProfileSummary.svelte
apps/web/src/lib/components/runtime/SafetyWarningsPanel.svelte
apps/web/src/lib/components/telemetry/GpuTelemetrySummary.svelte
```

### Dashboard layout target

Match `obsidianlm_reference_dashboard.png`.

Main content:

1. Compact page header
   - Eyebrow: `Command center`
   - Title: `ObsidianLM operator console`
   - Subtitle: `Control and monitor your local llama.cpp runtimes with precision.`

2. Runtime Status Card
   - Service health
   - Runtime state
   - Active profile
   - Port
   - PID
   - Uptime
   - Endpoint
   - Restart / Stop / Start / Copy endpoint / Open logs

3. Quick Actions Strip
   - Switch profile
   - Load model
   - Build runtime
   - Validate setup
   - Open config
   - View logs

4. Main panel grid
   - Active Profile Summary
   - Safety & Warnings
   - Command Preview
   - Recent Runtime Logs
   - GPU / Telemetry

Right inspector:

- Endpoint
- Process
- Profile
- Model
- Build
- Validation

### Important behavior

The dashboard should summarize. It should not contain full editors, full discovery lists, full job forms, or giant settings textareas.

### Acceptance

- Dashboard fits above the fold much more than the current screenshot.
- Runtime status is visually dominant.
- There is a clear next action.
- It feels close to the approved dashboard mockup.

---

## Phase 14E — Runtime page

### Files to add

```text
apps/web/src/lib/pages/RuntimePage.svelte
apps/web/src/lib/inspectors/RuntimeInspector.svelte
apps/web/src/lib/components/runtime/RuntimeControlBar.svelte
apps/web/src/lib/components/runtime/StartupSafetyPanel.svelte
```

### Runtime layout target

Match `obsidianlm_reference_runtime.png`.

Main content:

1. Page header
   - Eyebrow: `Managed server`
   - Title: `Control llama.cpp runtime`

2. Runtime Status Card
   - Large running/stopped indicator
   - Active profile
   - Endpoint
   - Uptime
   - Port
   - PID

3. Runtime action bar
   - Start runtime
   - Stop runtime
   - Restart
   - Validate
   - Copy endpoint

4. Mid panels
   - Validation Checklist
   - Command Preview
   - Startup & Safety

5. Bottom panel
   - Runtime Logs
   - Pause / Resume / Clear view / Open full logs

Right inspector:

- Active Profile
- Model Path
- Build Path
- Port & Network
- Runtime Facts

### Acceptance

- Runtime state appears before controls.
- Stop/restart copy explains scope.
- Logs are easy to inspect without scrolling through unrelated UI.
- It feels close to the approved runtime mockup.

---

## Phase 14F — Profiles page

### Files to add or refactor

```text
apps/web/src/lib/pages/ProfilesPage.svelte
apps/web/src/lib/inspectors/ProfileInspector.svelte
apps/web/src/lib/components/profile/ProfileList.svelte
apps/web/src/lib/components/profile/ProfileEditorV2.svelte
apps/web/src/lib/components/profile/ProfileSection.svelte
apps/web/src/lib/components/profile/RestartRequiredIndicator.svelte
apps/web/src/lib/components/profile/ChangeSummaryPanel.svelte
```

### Profiles layout target

Match `obsidianlm_reference_profiles.png`.

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

Top actions:

- Save profile — primary
- Duplicate — secondary
- Delete — danger, separated

Right inspector:

- Validation Status
- Command Preview
- Change Summary

### Important behavior

This page should feel like an editor, not a stack of dashboard cards.

### Acceptance

- Profile list is visually stable and selected row is obvious.
- Main editor uses section rows, not nested cards.
- Requires-restart indicators are visible.
- Command preview updates from current profile settings.
- It feels close to the approved profiles mockup.

---

## Phase 14G — Re-home remaining current panels

After Dashboard, Runtime, and Profiles match the reference direction, move the remaining existing panels into their own focused pages.

### Models page

Purpose: browse discovered GGUF models.

Layout:

- Folder/search/rescan toolbar
- Compact table/list of models
- Right inspector for selected model
- Create/switch profile affordance only when relevant

### Builds page

Purpose: browse discovered llama.cpp builds/tools.

Layout:

- Rescan toolbar
- Build list/table
- Tools detected per build
- Right inspector for selected build

### Jobs page

Purpose: run llama-bench and llama-perplexity as one-shot tools.

Layout:

- Job type selector/tabs
- Current/running job summary
- Job form
- Job history list
- Job details/logs

Important copy:

> Jobs are one-shot tools. They do not start or replace the managed llama.cpp server runtime.

### Logs page

Purpose: full service/runtime log inspection.

Layout:

- Source/severity/search toolbar
- Full log viewer
- Copy visible / clear view / pause stream

### Telemetry page

Purpose: GPU/process/port monitoring.

Layout:

- GPU devices
- GPU processes
- detected llama.cpp-like processes
- port status

### Settings page

Purpose: low-frequency app settings.

Layout:

- Auth/session
- discovery folders
- default managed port
- service/data/log directory mode

---

# Styling implementation plan

## CSS direction

Either keep a single `styles.css` for the first implementation pass or split only after the layout is stable.

Preferred eventual split:

```text
apps/web/src/styles/tokens.css
apps/web/src/styles/base.css
apps/web/src/styles/layout.css
apps/web/src/styles/components.css
apps/web/src/styles/pages.css
```

If splitting creates too much churn, keep `styles.css` but add clear section comments.

## New layout tokens

Add tokens like:

```css
--sidebar-width: 16rem;
--inspector-width: 22rem;
--topbar-height: 4rem;
--content-max-width: 106rem;
--panel-bg: linear-gradient(180deg, rgba(17, 24, 39, 0.82), rgba(10, 13, 22, 0.9));
--panel-bg-quiet: rgba(10, 13, 22, 0.72);
--panel-bg-code: rgba(4, 6, 14, 0.92);
```

## Reduce the “AI card maze” look

- Use large page sections instead of many small equal cards.
- Use compact rows inside panels.
- Use one inspector column for details instead of scattering metrics everywhere.
- Use buttons and rows, not mini-cards, for secondary actions.
- Keep glow minimal; active nav and runtime status can glow, ordinary cards should not.

---

# Data / state handling guidance

Current `App.svelte` owns most state. Do not try to rewrite all data loading in Phase 14.

Recommended first pass:

- Keep API loading functions in `App.svelte` temporarily.
- Pass state/actions to page components as props.
- Extract layout and page markup first.
- Only after pages are stable, consider extracting state into modules/stores.

This keeps the refactor mostly visual/structural and lowers risk.

---

# Testing and verification

Run:

```bash
npm run typecheck
npm run lint
npm run build
npm run test
npm run test:e2e
```

Update Playwright smoke to verify:

1. Login/setup still works.
2. Sidebar navigation works.
3. Dashboard renders runtime status, quick actions, command preview, logs, and inspector.
4. Runtime page renders status, controls, validation, safety, logs, and inspector.
5. Profiles page renders profile list, editor, validation, command preview, and change summary.
6. Jobs page still exposes llama-bench and llama-perplexity controls.
7. Models/builds discovery still renders.
8. Logs page supports filtering/copy/clear visible.
9. Mobile layout remains usable at 390×844.
10. No console errors.

## Visual acceptance

For each of the three core pages, capture a screenshot and compare manually to the matching approved reference image.

Checklist:

- Sidebar grouping matches.
- Top status strip matches.
- Page header is compact.
- Runtime state is above controls.
- Right inspector exists where expected.
- Command/log surfaces use mono font.
- There are fewer, stronger panels instead of many nested cards.
- The page does not look like a generic AI dashboard.

---

# Recommended OpenCode prompt

```md
Implement Phase 14: revise the ObsidianLM web interface to match the approved operator-console reference images.

Use these references as the target:
- obsidianlm_reference_dashboard.png
- obsidianlm_reference_runtime.png
- obsidianlm_reference_profiles.png

Also update DESIGN.md with the Phase 14 target if it is not already updated.

Current problem:
- The current web app is one long page even though it has a sidebar.
- The sidebar is decorative and does not switch pages.
- The UI has too many equal nested cards and looks like a generic AI dashboard.

Hard constraints:
- Keep the existing Vite + Svelte SPA.
- Do not add SvelteKit, Next.js, Electron, Docker, a database, a router dependency, or a heavy UI framework.
- Preserve existing API behavior and runtime/job/profile behavior.
- Do not add fake analytics or decorative charts.
- Do not hide paths, ports, commands, logs, validation, or warnings.
- Do not put large new logic directly into App.svelte.

Implement in small steps:
1. Add hash-based page navigation and grouped sidebar.
2. Extract AppShell, SidebarNav, PageHeader, TopStatusStrip, and InspectorPanel.
3. Build shared visual primitives for detail rows, badges, command preview, log viewer, validation checklist, action tiles, and path fields.
4. Create DashboardPage matching obsidianlm_reference_dashboard.png.
5. Create RuntimePage matching obsidianlm_reference_runtime.png.
6. Create ProfilesPage matching obsidianlm_reference_profiles.png.
7. Move remaining panels into focused pages: Models, Builds, Jobs, Logs, Telemetry, Settings/System.
8. Update Playwright smoke tests for navigation and core page rendering.

Visual requirements:
- Left sidebar grouped as Core, Library, Observability, System.
- Compact top status strip visible on all logged-in pages.
- Main workspace plus optional right inspector.
- Runtime Status Card must be first on Dashboard and Runtime.
- Dashboard summarizes; it must not contain full editors/forms/discovery lists.
- Runtime page operates the managed llama.cpp server safely.
- Profiles page feels like a precise editor with profile list, editor, validation, command preview, and change summary.
- Reduce nested cards. Prefer section panels, detail rows, and inspector panels.

Verification:
- npm run typecheck
- npm run lint
- npm run build
- npm run test
- npm run test:e2e
- Capture screenshots of Dashboard, Runtime, and Profiles and compare visually against the three references.
```
