# ObsidianLM Agent Instructions

## Project

ObsidianLM is a lightweight local AI runtime manager.

Read `docs/project-plan.md` before making implementation decisions.

The first target runtime is `llama.cpp` / `llama-server.exe`.

ObsidianLM is a control plane. It starts, stops, configures, monitors, and validates local runtimes. External tools like OpenCode and Illustria should talk directly to the llama.cpp OpenAI-compatible API.

## Stack

Use:

- Vite + Svelte SPA for the frontend.
- Node.js + TypeScript + Fastify for the service.
- JSON files for v1 storage.
- A monorepo layout with `apps/web`, `apps/service`, and `packages/shared`.

Do not use:

- Next.js.
- Electron.
- A database.
- Docker as a required local development dependency.
- Heavy UI/charting frameworks unless explicitly approved.

## Safety Rules

- Never silently kill unknown processes.
- Only auto-stop processes that were previously started and tracked by ObsidianLM.
- Ask before running destructive commands.
- Ask before deleting files.
- Ask before killing real system processes.
- Do not commit secrets, real tokens, private IPs, model files, llama.cpp builds, logs, or local runtime state.
- Do not commit `.env` files.

## Implementation Rules

- Keep runtime-specific logic inside runtime adapters.
- Keep shared types/schemas in `packages/shared`.
- Use generic names like runtime, provider, profile, and tool job where possible.
- `llama-bench` and `llama-perplexity` should be modeled as jobs/tools, not long-running runtimes.
- Keep Phase 0 small and working before starting Phase 1.
- Prefer simple, readable code over premature abstractions.

## Subagent Routing

Use the global subagent set when useful. This project uses Svelte/Vite and Fastify/Node, so route implementation work by actual stack rather than by Laravel/Next.js assumptions.

Recommended routing for ObsidianLM:

- Unknown code/data flow: `@explore`
- Current framework docs, CLI behavior, or package compatibility: `@researcher`
- Scoped Svelte/Vite, Fastify/Node, shared TypeScript, runtime, config, and script implementation: `@coder`
- Errors, logs, failed commands, broken startup, or crashed runtime behavior: `@debugger`
- Tests, typechecks, builds, regression coverage, and test repair: `@tester`
- Browser/UI verification: `@e2e`
- Docs-only work: `@docs`
- Risky or multi-file review before completion: `@reviewer`
- Git operations, commits, branches, pushes: `@git`

For now, do not route ObsidianLM frontend work to `@nextjs`, because this project uses Svelte/Vite, not Next.js.

For now, do not route ObsidianLM service work to `@laravel`, because this project uses Fastify/Node, not Laravel.

For now, do not route normal v1 storage work to `@database`, because v1 uses JSON files, not a database.

Do not use removed old global agents: `@web`, `@service`, `@runtime`, `@tests`, `@test-runner`, or `@test-fixer`.

## Verification

Before claiming a phase is complete, run the relevant checks.

For early phases, this usually means:

- `npm install`
- `npm run build`
- `npm run typecheck`
- `npm test` if tests exist
- Manual check that the service starts
- Manual check that the UI loads

Do not run `npm install` automatically unless dependencies are missing, package files changed, or the user/main agent explicitly asked for dependency installation.

## Git

Use small commits.

Suggested commit style:

- `chore: scaffold monorepo`
- `feat(service): add status endpoint`
- `feat(web): add dashboard shell`
- `docs: update setup notes`

Do not commit generated logs, model files, local data files, or build output.
