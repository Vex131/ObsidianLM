# Local Real-Use Validation

Phase 13 separates three validation layers.

## Unit and Service Tests

Run:

```bash
npm run test
```

These tests exercise TypeScript service behavior with temp directories and mocked processes. They do not require real GGUF files, llama.cpp builds, GPU access, Tailscale, or a running llama-server.

## Browser Smoke Tests

Run:

```bash
npm run test:e2e
```

Browser smoke uses Playwright, starts ObsidianLM on `127.0.0.1:18090`, and isolates runtime files under `.tmp/e2e-data` and `.tmp/e2e-logs`.

Browser smoke verifies first-run setup, admin login, dashboard loading, status/readiness/jobs/settings/diagnostics panels, empty discovery states, safe llama-bench and llama-perplexity controls with no discoveries, no initial dashboard console errors, and one mobile viewport.

Browser smoke intentionally does not use or modify committed/local `data/*.json`, `logs/`, runtime state, model paths, build paths, or dataset paths. It does not require real GGUF files, llama.cpp tools, GPU, Tailscale, llama-server, llama-bench, or llama-perplexity.

## Real Local Validation

Real local validation uses your machine-specific model/build/input folders. Keep those paths and generated data/logs out of commits.

Checklist:

1. Configure `modelFolders`.
2. Configure `llamaCppFolders`.
3. Configure `toolInputFolders`.
4. Rescan models, builds, and tool inputs.
5. Confirm readiness counts for GGUF models, server builds, llama-bench, llama-perplexity, tool inputs, and profiles.
6. Create or select a profile.
7. Run a tiny `llama-bench` job.
8. Run a tiny `llama-perplexity` job with a small local input file.
9. Start a `llama-server` profile.
10. Check runtime health.
11. Run diagnostic test chat.
12. Stop the runtime.
13. Confirm no local data, logs, paths, profiles, jobs, runtime state, model paths, build paths, or dataset paths were committed.

If any readiness discovery count is zero, do not treat real validation as complete. Configure the corresponding folder or tool first, then rescan and repeat the relevant checklist item.
