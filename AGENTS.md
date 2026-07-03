# ObsidianLM Project Rules

Follow the global OpenCode rules first. This file only adds ObsidianLM-specific guidance.

## Project Shape

- `apps/service` contains the backend service.
- `apps/web` contains the frontend app.
- `packages/shared` contains shared types, defaults, and contracts.
- `scripts/windows` contains Windows service scripts.
- `data` and service-mode storage may contain local/user runtime data. Treat them carefully.

## Working Rules

- Inspect the relevant app/package before editing.
- Keep backend, frontend, and shared-contract changes aligned.
- Preserve existing API shapes, settings formats, storage paths, auth behavior, and Windows service behavior unless the task asks for a change.
- Do not move or rewrite project structure casually.
- Do not add dependencies unless clearly justified.

## Safety

- Do not delete or reset `data`, settings, logs, auth/token data, generated user content, or service-mode files without explicit approval.
- Do not run destructive migrations, storage wipes, service uninstall/reinstall flows, or broad cleanup commands without explicit approval.
- Do not expose raw admin tokens, token hashes, secrets, local paths with credentials, or private runtime data in logs or responses.

## Commands and Verification

- Run backend commands from `apps/service`.
- Run frontend commands from `apps/web`.
- Run shared/package commands from the relevant package folder.
- Use the existing package manager and scripts already present in the repo.
- Do not start dev servers, service processes, watchers, or queue workers unless explicitly asked or required for a bounded smoke test with guaranteed cleanup.
- Prefer the repo’s existing tests, typechecks, lint/build scripts, or targeted service/web checks for files changed.
- Only claim commands passed if they were actually run.

## Context Tools

- Use Serena for symbol lookup, references, project memories, and targeted code navigation before broad source reads.
- This repo has a Graphify graph in `graphify-out/` with god nodes, community structure, and cross-file relationships.
- When the user types `/graphify`, invoke the Graphify skill/tool before doing anything else.
- For codebase questions, first run `graphify query "<question>"` when `graphify-out/graph.json` exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts.
- Prefer scoped Graphify results over `graphify-out/GRAPH_REPORT.md` or raw grep output.
- Dirty `graphify-out/` files are expected after hooks or incremental updates. Only skip Graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If `graphify-out/wiki/index.md` exists, use it for broad navigation instead of raw source browsing.
- Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` when Graphify is available; it is AST-only and has no API cost.

## Subagent Routing for Phase Work

Phase work often spans service, web, shared contracts, tests, docs, and verification. Use subagents when they are likely to reduce main-context tokens or prevent repeated broad reads.

For any phase or task touching 3+ of these areas, use at least one focused subagent unless the reason to stay direct is clear and stated: `apps/service`, `apps/web`, `packages/shared`, `scripts/windows`, tests, README/docs, browser smoke, runtime/process management, storage/settings/auth.

Recommended phase pipeline:

1. Use Graphify or Serena first for targeted context when available.
2. Use `@explore` for a concise implementation map when file ownership, API flow, or UI/data flow is not already obvious.
3. Keep tightly coupled integration in the main agent or one `@coder`; do not split one connected change across many coders.
4. Use `@tester` after implementation for focused tests, failures, typecheck/lint/build interpretation, and regression gaps.
5. Use `@reviewer` before final response when changes touch protected APIs, auth, settings/storage, runtime/job/process behavior, Windows service behavior, or broad UI refactors.
6. Use `@docs` for README-heavy phases when docs would otherwise bloat the main context.
7. Use `@e2e` only for bounded browser smoke checks with guaranteed cleanup; do not leave dev servers or browser sessions running.

Subagent handoffs should be narrow and token-efficient. Ask for file paths, relevant symbols, risks, commands, and recommended next steps. Avoid full-file dumps, long logs, and broad diffs in handoff responses.

Do not use subagents for tiny single-file edits, obvious copy changes, or small fixes where the handoff costs more than direct work.

## Git

Use the global Conventional Commit rules. Prefer project scopes such as `service`, `web`, `shared`, `scripts`, `docs`, `config`, or `opencode`.

Examples:

- `feat(service): add job system foundation`
- `fix(web): handle auth setup failure`
- `refactor(shared): simplify settings defaults`
- `docs(readme): clarify service mode setup`
- `chore(config): update opencode rules`

Do not commit or push unless explicitly asked.
