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

## Commands

- Run backend commands from `apps/service`.
- Run frontend commands from `apps/web`.
- Run shared/package commands from the relevant package folder.
- Use the existing package manager and scripts already present in the repo.
- Do not run long-running dev servers, service processes, watchers, or queue workers in the foreground unless explicitly asked.

## Verification

Use focused verification for the files changed. Prefer the repo’s existing tests, typechecks, lint/build scripts, or targeted service/web checks when available.

Only claim commands passed if they were actually run.

## Git

Use scoped Conventional Commit messages such as:

- `feat(service): add job system foundation`
- `fix(web): handle auth setup failure`
- `refactor(shared): simplify settings defaults`
- `docs(readme): clarify service mode setup`
- `chore(config): update opencode rules`

Do not commit or push unless explicitly asked.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, invoke the `skill` tool with `skill: "graphify"` before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
