# ObsidianLM

ObsidianLM is a lightweight local AI runtime manager. It is a control plane for configuring, monitoring, and eventually managing local AI runtimes while tools such as OpenCode and Illustria connect directly to the runtime API.

## Package Manager

This project uses npm only with npm workspaces. Commit `package-lock.json` and do not use pnpm, Yarn, Bun, Docker, Electron, or Next.js for this project foundation.

## Setup

```bash
npm install
npm run dev
```

Build and run the compiled service/UI:

```bash
npm run build
npm run start
```

## Default Ports

- ObsidianLM UI/API: `8090`
- llama.cpp API: `8085`
- External tools such as OpenCode and Illustria should connect directly to llama.cpp, for example `http://localhost:8085/v1`.

## Phase 0 Status

Phase 0 provides the npm monorepo foundation, a Fastify TypeScript service, a Vite + Svelte dashboard shell, shared TypeScript types/constants, JSON storage defaults, and `GET /api/status`.

## Phase 1 Status

Phase 1 adds the first safe llama.cpp runtime-management layer for one manually configured server profile.

Implemented:

- Load profiles from `data/profiles.json`.
- Validate one `llama.cpp` `server` profile without starting a process.
- Generate a copyable `llama-server.exe` command preview.
- Start one selected profile as a managed child process.
- Stop or restart only the current in-memory child process started by this running ObsidianLM service instance.
- Capture stdout/stderr logs in memory and write runtime log files under `logs/runtimes/`.
- Show runtime status, controls, command preview, warnings, and logs in the Svelte dashboard.

Not implemented in Phase 1: model/build scanning, GPU monitoring, stale process adoption, stale process cleanup, process discovery, Windows service installation, `llama-bench`, `llama-perplexity`, Docker, Electron, or a database.

## Phase 2 Status

Phase 2 adds read-only discovery for configured model folders and llama.cpp build folders.

Implemented:

- Configure discovery folders through the UI or `data/settings.json`.
- Scan configured `modelFolders` for `.gguf` model files.
- Scan configured `llamaCppFolders` for llama.cpp builds that contain `llama-server`.
- Detect companion llama.cpp tools when present: `llama-cli`, `llama-bench`, and `llama-perplexity`.
- Show discovery warnings for missing, unreadable, symlinked, or invalid configured folders.
- Create a Phase 1-compatible `llama.cpp` server profile from a selected discovered model and build.

Not implemented in Phase 2: GPU monitoring, stale process adoption/cleanup, unknown process cleanup, Windows service installation, running `llama-bench`/`llama-perplexity` jobs, Docker, Electron, or a database.

## Configure Discovery Folders

Discovery is controlled by `modelFolders` and `llamaCppFolders` in `data/settings.json`. Fresh installs default both lists to empty. Use `data/settings.example.json` as a safe template, then replace the placeholder paths with your local folders.

Example shape:

```json
{
  "uiPort": 8090,
  "managedLlamaPort": 8085,
  "startupMode": "service_only",
  "staleProcessPolicy": "auto_stop_previous_managed_only",
  "modelFolders": ["C:\\path\\to\\models"],
  "llamaCppFolders": ["C:\\path\\to\\llama.cpp-builds"]
}
```

You can also edit these folders from the dashboard under **Discovery folders**. Enter one folder per line, then click **Save discovery folders**.

### Discovery Behavior and Safety

- Discovery scans only the configured folders. It does not search the whole machine.
- Model discovery reads directory entries and file metadata; it does not load model contents.
- Build discovery detects executable file names; it does not execute detected tools.
- Symlinked configured folders and symlinked entries are skipped.
- Missing or unreadable folders are kept in settings and reported as warnings instead of crashing the service.
- Model scans stop below depth 8 and after 1000 `.gguf` files.
- Build scans check the configured folder and one nested level below it.
- Creating a profile appends to `data/profiles.json`, validates the profile, and does not start llama.cpp.

Supported model files in Phase 2:

- `.gguf`

Supported detected llama.cpp files in Phase 2:

- `llama-server.exe` / `llama-server` — runtime provider, required for a discovered build to appear.
- `llama-cli.exe` / `llama-cli` — detected companion tool.
- `llama-bench.exe` / `llama-bench` — detected companion tool only; jobs are planned later.
- `llama-perplexity.exe` / `llama-perplexity` — detected companion tool only; jobs are planned later.

## Configure a llama.cpp Profile

`data/profiles.json` is intentionally safe to edit manually and defaults to an empty list. Use `data/profiles.example.json` as a template, then replace the example paths with your local files.

Example profile shape:

```json
[
  {
    "id": "example-local-llama-server",
    "name": "Example local llama.cpp server",
    "runtimeType": "llama.cpp",
    "providerKind": "server",
    "buildPath": "C:\\path\\to\\llama-server.exe",
    "modelPath": "C:\\path\\to\\model.gguf",
    "host": "0.0.0.0",
    "port": 8085,
    "llamaArgs": {
      "ctxSize": 8192,
      "gpuLayers": 0,
      "devices": [],
      "splitMode": "layer",
      "tensorSplit": "1",
      "cacheTypeK": "q8_0",
      "cacheTypeV": "q8_0",
      "flashAttention": true,
      "batchSize": 512,
      "ubatchSize": 128,
      "parallel": 1,
      "threads": 4,
      "threadsBatch": 4,
      "contBatching": true,
      "metrics": true,
      "webui": true
    },
    "extraArgs": ["--timeout", "3600"]
  }
]
```

## Create a Profile from Discovery

1. Start ObsidianLM with `npm run dev` or `npm run build` then `npm run start`.
2. Open the dashboard.
3. Add one or more model folders and llama.cpp build folders under **Discovery folders**.
4. Click **Rescan models** and **Rescan builds**.
5. Select one discovered `.gguf` model and one discovered build.
6. Review the profile fields, then click **Create profile**.
7. Validate or start the new profile from the normal runtime controls.

The created profile uses the selected model path and selected `llama-server` path, then stores the result in `data/profiles.json`.

## Run ObsidianLM

Development mode:

```bash
npm install
npm run dev
```

Open the Vite dev UI at `http://localhost:5173`. The service API runs at `http://localhost:8090`.

Built mode:

```bash
npm run build
npm run start
```

Open the built UI/API at `http://localhost:8090`.

From the UI:

1. Select a profile from `data/profiles.json`.
2. Review the generated command preview.
3. Run validation.
4. Start the profile.
5. Connect external tools directly to llama.cpp at `http://localhost:8085/v1` unless your profile uses a different port.

## Safety Notes

ObsidianLM only manages the child process started by the current ObsidianLM service run. It never kills unknown processes and never kills a process just because it is named `llama-server.exe`.

If `data/runtime-state.json` says a previous runtime was running, ObsidianLM marks it as `unknown_previous_runtime`, shows a warning, and does not adopt or clean it up. Stale process detection, adoption, and cleanup are planned for Phase 3.

## Project Plan

See [docs/ObsidianLM_Project_Plan.md](docs/ObsidianLM_Project_Plan.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
