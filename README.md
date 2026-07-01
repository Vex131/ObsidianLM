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

## Phase 3 Status

Phase 3 adds conservative startup detection and port-conflict handling for local `llama-server` processes.

Implemented:

- On service startup, inspect previous `data/runtime-state.json`, configured llama.cpp ports, and visible `llama-server`-like processes.
- Detect likely manual or unmanaged `llama-server` processes without adopting or stopping them.
- Detect whether the managed llama.cpp port, normally `8085`, is already listening.
- Block duplicate runtime starts when the selected profile port is already in use.
- Mark stale previous runtime state as stopped when no matching live process is found.
- Show startup detection warnings in the dashboard/runtime status.

Process classification categories:

- `current_managed_process` — the active child process started by this ObsidianLM service session.
- `previous_managed_process_candidate` — a live process that may match previous ObsidianLM runtime state; shown as a warning, not adopted or stopped.
- `previous_managed_stale_state` — previous runtime state said a runtime was active, but no matching process was found; state is marked stopped.
- `previous_managed_stale_process` — reserved for a proven previous ObsidianLM-managed process that is stale/unhealthy; Phase 3 does not auto-stop these because current cross-platform proof is intentionally conservative.
- `unmanaged_llama_process` — a `llama-server`-like process that ObsidianLM did not start in this session.
- `port_conflict` — a checked runtime port is already in use by another process or unknown owner.
- `no_runtime_detected` — no active runtime, matching previous process, unmanaged process, or port conflict was found.

Not implemented in Phase 3: GPU process/VRAM detection, stale process adoption, stale process cleanup, unknown process cleanup, Windows service installation, running `llama-bench`/`llama-perplexity` jobs, Docker, Electron, or a database. GPU process detection is implemented in Phase 4, not Phase 3.

## Phase 4 Status

Phase 4 adds a read-only NVIDIA GPU monitor backed by `nvidia-smi`.

Requirements:

- An NVIDIA GPU driver that provides `nvidia-smi`.
- `nvidia-smi` available on `PATH` for the ObsidianLM service process.

Implemented:

- Query GPU status through `nvidia-smi` without changing GPU settings.
- Show GPU name, driver/CUDA version when available, VRAM used/free/total, utilization, temperature, and power draw/limit.
- Show GPU compute processes with PID, process name, GPU, reported VRAM, and classification.
- Mark the current ObsidianLM-managed runtime when its PID appears in the GPU process list.
- Classify other `llama-server`-like GPU processes as possible llama.cpp runtimes without adopting or stopping them.
- Report unknown GPU processes as warnings/info only.
- Expose GPU status in the dashboard and through `GET /api/monitoring/gpu`; include a compact GPU summary in `GET /api/status`.

Not implemented in Phase 4: running `llama-bench`/`llama-perplexity` jobs, Windows service installation, Docker, Electron, or a database. The job system remains Phase 6, and Windows service mode remains Phase 7.

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

ObsidianLM only stops the child process started by the current ObsidianLM service run. It never kills unknown processes and never kills a process just because it is named `llama-server.exe`.

If `data/runtime-state.json` says a previous runtime was running, ObsidianLM performs conservative startup detection. If no matching live process is found, the stale state is marked stopped. If a possible previous managed process is found, ObsidianLM marks it as `unknown_previous_runtime`, shows a warning, and does not adopt or clean it up.

When a profile port is already in use, ObsidianLM refuses to start another runtime on that port. It does not try to determine intent from the process name alone, and it does not free the port automatically.

GPU monitoring is read-only. ObsidianLM calls `nvidia-smi` to display GPU state, but it never kills GPU processes, adopts GPU processes, changes GPU settings, or treats unknown GPU processes as cleanup targets. Unknown GPU processes are warnings/info only.

## Troubleshooting

### Port `8085` is already in use

Another process is listening on the default llama.cpp API port. ObsidianLM will show a `port_conflict` warning and block starting a duplicate runtime. Stop the other process yourself, or change the profile port in `data/profiles.json` and point external tools to the new `/v1` URL.

### Manual `llama-server` is running

If you started `llama-server.exe` outside ObsidianLM, Phase 3 classifies it as `unmanaged_llama_process`. This is informational/safety behavior: ObsidianLM will not stop, adopt, or restart that process. Stop it manually if you want ObsidianLM to manage the port.

### Previous runtime state warning

If ObsidianLM was closed while a runtime was running, `data/runtime-state.json` may still say a runtime was active. On the next startup, ObsidianLM checks for a matching live process. If none is found, it marks the state stopped; if a possible match is found, it warns and leaves the process alone.

### `nvidia-smi` is missing

Phase 4 GPU monitoring requires the NVIDIA driver tool `nvidia-smi` on `PATH`. If the dashboard reports `nvidia_smi_missing`, install or repair the NVIDIA driver, then open a new terminal and confirm this works before starting ObsidianLM again:

```bash
nvidia-smi
```

On Windows, `nvidia-smi.exe` is commonly installed under `C:\Program Files\NVIDIA Corporation\NVSMI\`. Add that folder to `PATH` if the command works only when called by full path.

### No NVIDIA GPUs detected

If `nvidia-smi` runs but ObsidianLM reports `no_nvidia_gpus_detected`, the service did not receive any GPU rows from the driver. Confirm the machine has a supported NVIDIA GPU, the driver is installed, and `nvidia-smi` shows the GPU in the same user/session used to start ObsidianLM.

### GPU process owner unknown

If ObsidianLM reports `gpu_process_owner_unknown`, the GPU summary query worked but the compute-process query failed. VRAM totals may still be shown, but process ownership may be incomplete. Run `nvidia-smi` manually to compare, update the NVIDIA driver if needed, and treat any listed VRAM use as informational until process rows are available.

### Used VRAM with no listed process

`nvidia-smi` can report used VRAM without returning a matching compute process. This can happen with driver/display allocation, short-lived processes, permission/session limits, or process-query failures. ObsidianLM does not infer ownership from VRAM totals alone and will not kill or clean up anything automatically.

## Project Plan

See [docs/ObsidianLM_Project_Plan.md](docs/ObsidianLM_Project_Plan.md).

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
