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
    "modelPath": "D:\\Models\\path\\to\\model.gguf",
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

## Run Phase 1

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

Phase 1 only manages the child process started by the current ObsidianLM service run. It never kills unknown processes and never kills a process just because it is named `llama-server.exe`.

If `data/runtime-state.json` says a previous runtime was running, ObsidianLM marks it as `unknown_previous_runtime`, shows a warning, and does not adopt or clean it up. Stale process detection, adoption, and cleanup are planned for Phase 3.

## Project Plan

See [docs/ObsidianLM_Project_Plan.md](docs/ObsidianLM_Project_Plan.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
