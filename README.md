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

## Admin Token Authentication

Phase 9 adds local admin token authentication for ObsidianLM's protected UI/API controls.

### First-run setup

On a fresh install, `adminTokenHash` is unset in `data/settings.json`. The first browser session that opens ObsidianLM sees a setup screen and creates the admin token. The raw token is accepted only during setup, hashed by the service, and then stored as `adminTokenHash`; do not store raw tokens in settings files, docs, scripts, or URLs.

The token must be at least 12 characters and cannot contain whitespace. After setup, the dashboard saves the token in that browser's `localStorage` for v1 convenience and sends it to protected API routes as a bearer token. Use **Logout** to clear the saved browser token. Logging out does not remove or rotate the server-side token hash.

### Public and protected endpoints

These API routes remain public so the UI can check auth state, complete first-run setup, verify a submitted token, or clear local login state:

- `GET /api/status`
- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/verify`
- `POST /api/auth/logout`

Before first setup, all other `/api/*` routes are blocked with `423 setup_required`. After `adminTokenHash` is set, all other `/api/*` routes require the configured admin token. This applies on localhost and over Tailscale; Tailscale connectivity is not treated as authentication. External tools should still connect directly to llama.cpp at its OpenAI-compatible `/v1` endpoint rather than through ObsidianLM.

### Where the token hash is stored

Development/built local mode stores the hash in:

```text
data/settings.json
```

Installed Windows Service Mode stores the hash in the service data directory unless overridden:

```text
%PROGRAMDATA%\ObsidianLM\data\settings.json
```

The stored value is a `scrypt:v1` hash. API responses sanitize settings and should not return the hash value.

### Manual reset

Use manual reset only if the admin token is lost or you intentionally want to force first-run setup again. Stop ObsidianLM first so the service cannot rewrite settings while you edit them.

Local/dev mode:

1. Stop the running `npm run dev` or `npm run start` process.
2. Back up `data/settings.json`.
3. Edit `data/settings.json` and set `adminTokenHash` to `null`, or remove only the `adminTokenHash` property.
4. Start ObsidianLM again and complete the setup screen from a trusted browser.

Windows Service Mode:

1. Stop the service, for example with the existing service stop script/command.
2. Back up `%PROGRAMDATA%\ObsidianLM\data\settings.json`.
3. Edit that file and set `adminTokenHash` to `null`, or remove only the `adminTokenHash` property.
4. Start the service again and complete setup from a trusted browser.

Do not delete unrelated settings unless you intend to reset them. While `adminTokenHash` is unset, only the public setup/status/auth routes listed above are usable; all other `/api/*` routes return `423 setup_required` until setup is completed. Complete setup from a trusted browser before exposing the UI/API to other machines.

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

## Phase 5 Status

Phase 5 adds a better profile editor for creating, editing, duplicating, deleting, importing/exporting, and copying starter configuration snippets for llama.cpp server profiles.

Implemented:

- Create new manual profiles from the dashboard without starting llama.cpp.
- Edit existing profiles from the dashboard; saved edits apply the next time that profile is started.
- Validate profile drafts with blocking errors separated from non-blocking warnings.
- Duplicate profiles into a new unique profile ID without overwriting the source.
- Delete stopped profiles while blocking deletion of the currently running managed profile.
- Export profiles as portable JSON without runtime state or logs.
- Import profile arrays or exported profile objects with append/merge behavior.
- Copy the generated `llama.cpp` command, an OpenCode starter snippet, and an Illustria starter snippet for the selected profile.

Not implemented in Phase 5: running `llama-bench`/`llama-perplexity` jobs, Windows service installation, Docker, Electron, or a database.

## Phase 6 Status

Phase 6 adds the generic one-shot job system foundation. It is intentionally separate from long-running llama.cpp server runtime management.

Implemented:

- Shared job types for queued, running, completed, failed, and cancelled jobs.
- `data/jobs.json` storage with atomic writes.
- `logs/jobs/` log files plus a small in-memory log tail for active/recent jobs.
- A generic one-shot job runner that spawns a configured executable with args.
- One active queued/running job at a time.
- Safe cancellation for only the current in-memory managed job child process.
- Startup restoration that marks leftover queued/running jobs as failed/interrupted without adopting or killing unknown processes.
- Safe job API routes: `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/test`, `POST /api/jobs/:id/cancel`, and `GET /api/jobs/:id/logs`.
- A dashboard Jobs panel for running the safe test job, cancelling a running managed job, viewing job status, and previewing logs.

The Phase 6 test job runs a safe cross-platform Node command. It does not run `llama-bench`, `llama-perplexity`, or any discovered llama.cpp tool.

Not implemented in Phase 6: full `llama-bench` integration, full `llama-perplexity` integration, routing jobs through `RuntimeManager`, killing unknown processes, Windows service installation, Docker, Electron, or a database. Full llama.cpp tool integrations are future phases built on this foundation.

## Phase 7 Status

Phase 7 adds Windows Service Mode support for running ObsidianLM itself as a background Windows service.

Implemented:

- Service-mode path resolution with `OBSIDIANLM_SERVICE_MODE=1`.
- Production defaults for service data/logs under `%PROGRAMDATA%\ObsidianLM`.
- Environment overrides: `OBSIDIANLM_DATA_DIR`, `OBSIDIANLM_LOG_DIR`, and the legacy `OBSIDIANLM_LOGS_DIR` alias.
- Windows service npm commands for install, uninstall, start, stop, restart, and status.
- PowerShell scripts under `scripts/windows/` with Windows/admin/build/service-state checks.
- A WinSW-style service template at `scripts/windows/obsidianlm-service.xml`.
- Service-mode labels in `GET /api/status` and the dashboard System panel.

Not implemented in Phase 7: tray app, browser-based service installer buttons, auto-starting llama.cpp on boot, changing the llama.cpp API port behavior, changing `RuntimeManager` semantics, Docker, Electron, or a database.

Windows Service Mode starts only ObsidianLM. On boot, ObsidianLM still scans and warns about existing llama.cpp processes and port conflicts, but it does not start, adopt, stop, or kill unknown llama.cpp processes.

## Phase 8 Status

Phase 8 adds persisted runtime log reading and live runtime log streaming for ObsidianLM-managed runtime processes.

Implemented:

- Runtime stdout/stderr/system entries are written as structured runtime log files.
- The dashboard **Logs** panel shows recent runtime output, live stream status, search, refresh, copy visible, and clear visible actions.
- Runtime log APIs: `GET /api/runtime/logs?limit=300` for recent entries and `GET /api/runtime/logs/stream?limit=100` for SSE live updates.

Live runtime logs are only for the active or most recent llama.cpp process started and tracked by ObsidianLM. ObsidianLM does not tail, adopt, or stream logs from manual/unmanaged `llama-server` processes.

## Phase 9 Status

Phase 9 adds admin token authentication for protected ObsidianLM controls.

Implemented:

- First-run admin token setup in the dashboard.
- Server-side `scrypt:v1` token hashing stored as `adminTokenHash` in settings.
- Login/token verification and logout that clears the browser-saved token.
- Public auth/status routes plus bearer-token protection for other `/api/*` routes once configured.
- Settings sanitization so API responses do not expose the stored token hash.

Not implemented in Phase 9: multi-user accounts, role-based permissions, HTTPS/TLS termination, automatic token rotation, external identity providers, or using Tailscale as a substitute for the admin token.

## Phase 10 Status

Phase 10 adds setup-required API blocking before first-run auth setup and initial `llama-bench` one-shot job support.

Implemented:

- Before an admin token is configured, public auth/status routes remain available, but protected `/api/*` routes return `423 setup_required` instead of running control actions.
- `llama-bench` can be started from the Jobs panel/API as a one-shot tool job using a discovered `llama-bench` executable and a discovered `.gguf` model.
- `llama-bench` jobs run through the job queue and write job logs/results separately from long-running runtime logs.
- `llama-bench`, `llama-perplexity`, and `llama-cli` are not classified as `llama-server` runtimes during process detection.

Important boundaries:

- `llama-bench` is a job/tool, not a runtime provider. Running a bench job does **not** start `llama-server`, expose an OpenAI-compatible API, or change the active runtime profile.
- Real `llama-bench` execution requires both a discovered `llama-bench` executable from `llamaCppFolders` and a configured/discovered `.gguf` model from `modelFolders`.
- CPU build testing is supported for local smoke tests. Actual deployment can use GPU-enabled llama.cpp builds later.

Not implemented in Phase 10: `llama-perplexity` execution, parsed benchmark dashboards beyond stored job results, multi-job concurrency, automatic GPU build installation, Docker, Electron, or a database.

## Phase 11 Status

Phase 11 adds real-use validation support, runtime health diagnostics, diagnostic test chat, storage hardening, and a small dashboard refactor.

Implemented:

- `GET /api/runtime/health` checks the active llama.cpp server profile by calling `/v1/models` with a bounded timeout. Local health checks map profile host `0.0.0.0` to `127.0.0.1`.
- `POST /api/runtime/test-chat` sends one small non-streaming diagnostic request to `/v1/chat/completions` with bounded prompt length, `maxTokens`, and timeout.
- Runtime health and test chat are protected after admin setup like other runtime controls.
- The dashboard includes a runtime diagnostics card for health status, latency, endpoint, errors, and a manual test-chat panel. Test chat does not auto-run on refresh.
- `saveRuntimeState()` now uses the same temp-file plus rename pattern as other JSON writes.
- If `settings.json`, `profiles.json`, `runtime-state.json`, or `jobs.json` contains invalid JSON, startup backs it up as `<name>.invalid-<timestamp>.bak`, recreates a safe default, and surfaces a warning in `GET /api/status`.
- The web dashboard started reducing `App.svelte` risk by extracting API helpers, formatting helpers, runtime diagnostics UI, and Jobs UI.

Runtime diagnostics remain control-plane diagnostics only. ObsidianLM does not proxy general inference, stream chat, store conversations, or replace direct client access to llama.cpp. OpenCode, Illustria, and local tools should continue using llama.cpp directly on `http://localhost:8085/v1` unless you explicitly configured another llama.cpp port.

Not implemented in Phase 11: Docker, Electron, a database, multi-runtime support, multi-job concurrency, `llama-perplexity`, benchmark charts, stale-process adoption, automatic stale-process killing, streaming chat, chat history, or a general inference proxy.

## Phase 12 Status

Phase 12 adds `llama-perplexity` one-shot jobs and configured dataset/tool-input discovery.

Implemented:

- New `toolInputFolders` setting for dataset/tool-input discovery.
- Metadata-only discovery for `.txt`, `.raw`, `.jsonl`, and `.md` files under configured tool input folders.
- Discovery skips symlinks, caps recursion/results, and reports missing or unreadable folders as warnings.
- `POST /api/jobs/llama-perplexity` starts a discovered `llama-perplexity` executable with a discovered `.gguf` model and a discovered tool input file.
- `llama-perplexity` command building uses `-m <modelPath>` and `-f <datasetPath>` plus validated numeric options only: threads, context size, batch size, ubatch size, and GPU layers.
- Job results parse final output like `Final estimate: PPL = 5.4007 +/- 0.67339` and progress fragments like `[1]15.2701,[2]5.4007`.
- The Jobs UI offers both `llama-bench` and `llama-perplexity` controls and displays final PPL, uncertainty, estimate count, and warnings.

Important boundaries:

- ObsidianLM remains a control plane. OpenCode, Illustria, and other local tools should continue talking directly to llama.cpp on port `8085` unless explicitly configured otherwise.
- ObsidianLM UI/API remains on port `8090` unless explicitly overridden.
- `llama-bench`, `llama-perplexity`, and `llama-cli` are one-shot jobs/tools, not runtime providers.
- Running `llama-perplexity` does not start `llama-server`, use `RuntimeManager`, proxy inference, adopt external runtimes, or kill unknown processes.

Not implemented in Phase 12: KL-divergence mode, automatic dataset download, benchmark/perplexity charts, multi-job concurrency, multi-runtime support, runtime adoption, automatic stale-process killing, Docker, Electron, a database, or a general inference proxy.

### Phase 12 Real-use Validation

Automated tests cover tool input discovery, extension filtering, missing-folder warnings, symlink skipping where supported by the OS, command building, request validation, final/progress parser behavior, protected API behavior, undiscovered path rejection, mocked job startup, sanitized API responses, and a `llama-bench` regression.

Real `llama-perplexity` validation requires all of these configured locally and intentionally not committed: a runnable `llama-perplexity` executable, a `.gguf` model, and a small supported input file. If those are present, run a small job from **Jobs** or `POST /api/jobs/llama-perplexity` and confirm the job reaches a terminal status with parsed PPL output. If any discovery count is zero, real execution remains unverified until the corresponding folder is configured.

### Phase 11 Real-use Validation

Current repository validation status:

- Automated service tests cover health success, test-chat validation, safe network errors, auth protection, corrupt JSON backup/recovery, and atomic runtime-state saves.
- Current discovery data returned `modelCount=0`, `buildCount=0`, `benchCount=0`, and `profileCount=0`.
- Real `llama-bench`, server launch, browser smoke, runtime health, and diagnostic test-chat verification are blocked until local discovery folders and a runnable server profile are configured.
- Real local validation should be run with your configured discovery folders so ObsidianLM can find a real `llama-bench` executable, a `.gguf` model, and a runnable `llama-server` profile.

Manual real-use checklist:

1. Configure `modelFolders` and `llamaCppFolders` without committing machine-specific paths.
2. Run a small `llama-bench` job from the Jobs panel.
3. Start a real llama.cpp server profile.
4. Click **Check runtime health** and confirm `/v1/models` responds.
5. Click **Run test chat** with `Say OK in one short sentence.` and confirm a short response preview appears.

### Windows Service Setup

Build before installing:

```bash
npm install
npm run build
```

ObsidianLM uses a wrapper-agnostic script layout with a WinSW-style XML template. The repository does not commit or download a wrapper binary. Place a WinSW-compatible executable here before installing:

```text
%PROGRAMDATA%\ObsidianLM\service\obsidianlm-service.exe
```

The install script creates `%PROGRAMDATA%\ObsidianLM\service`, `%PROGRAMDATA%\ObsidianLM\data`, `%PROGRAMDATA%\ObsidianLM\logs`, `%PROGRAMDATA%\ObsidianLM\logs\runtimes`, `%PROGRAMDATA%\ObsidianLM\logs\jobs`, and `%PROGRAMDATA%\ObsidianLM\logs\service` as needed.

Run install/uninstall from an elevated PowerShell session:

```bash
npm run service:install
npm run service:start
npm run service:status
npm run service:stop
npm run service:restart
npm run service:uninstall
```

`service:install` fails if the project has not been built, if the wrapper executable is missing, or if a different service already uses the stable service name `ObsidianLM`. It does not start llama.cpp.

`service:uninstall` stops the ObsidianLM service first if it is running. It preserves `%PROGRAMDATA%\ObsidianLM\data` by default. Logs are also preserved unless you explicitly run the script directly with `-RemoveLogs`.

### Service Data and Logs

Development mode keeps using project-local paths unless env vars override them:

- Data: `data/`
- Logs: `logs/`
- Runtime logs: `logs/runtimes/`
- Job logs: `logs/jobs/`

Installed service mode defaults to:

- Data: `%PROGRAMDATA%\ObsidianLM\data`
- Logs: `%PROGRAMDATA%\ObsidianLM\logs`
- Runtime logs: `%PROGRAMDATA%\ObsidianLM\logs\runtimes`
- Job logs: `%PROGRAMDATA%\ObsidianLM\logs\jobs`
- Service wrapper logs: `%PROGRAMDATA%\ObsidianLM\logs\service`

Log types are separate:

- Runtime logs are llama.cpp runtime stdout/stderr/system output for ObsidianLM-managed runtime processes.
- Job logs are one-shot job output, such as Phase 6 test jobs and Phase 10 `llama-bench` jobs.
- Service wrapper logs are Windows service wrapper output for starting/stopping ObsidianLM itself; they are not llama.cpp runtime logs.

ObsidianLM does not automatically migrate local project data into `%PROGRAMDATA%`. If you want the service to reuse development profiles or settings, stop ObsidianLM and manually copy the relevant JSON files from `data/` into `%PROGRAMDATA%\ObsidianLM\data` before starting the service.

Tailscale access remains:

- ObsidianLM UI/API: `http://100.84.76.75:8090`
- llama.cpp clients: `http://100.84.76.75:8085/v1`

External tools such as OpenCode and Illustria should still talk directly to llama.cpp, not through ObsidianLM.

## Configure Discovery Folders

Discovery is controlled by `modelFolders`, `llamaCppFolders`, and `toolInputFolders` in `data/settings.json`. Fresh installs default these lists to empty. Use `data/settings.example.json` as a safe template, then replace the placeholder paths with your local folders.

Example shape:

```json
{
  "uiPort": 8090,
  "managedLlamaPort": 8085,
  "startupMode": "service_only",
  "staleProcessPolicy": "auto_stop_previous_managed_only",
  "modelFolders": ["C:\\path\\to\\models"],
  "llamaCppFolders": ["C:\\path\\to\\llama.cpp-builds"],
  "toolInputFolders": ["C:\\path\\to\\tool-inputs"]
}
```

You can also edit these folders from the dashboard under **Discovery folders**. Enter one folder per line, then click **Save discovery folders**.

### Discovery Behavior and Safety

- Discovery scans only the configured folders. It does not search the whole machine.
- Model discovery reads directory entries and file metadata; it does not load model contents.
- Tool input discovery reads directory entries and file metadata only; it does not read dataset contents during discovery.
- Build discovery detects executable file names; it does not execute detected tools.
- Symlinked configured folders and symlinked entries are skipped.
- Missing or unreadable folders are kept in settings and reported as warnings instead of crashing the service.
- Model scans stop below depth 8 and after 1000 `.gguf` files.
- Tool input scans stop below depth 8 and after 1000 supported text-like files.
- Build scans check the configured folder and one nested level below it.
- Creating a profile appends to `data/profiles.json`, validates the profile, and does not start llama.cpp.

Supported model files in Phase 2:

- `.gguf`

Supported detected llama.cpp files in Phase 2:

- `llama-server.exe` / `llama-server` — runtime provider, required for a discovered build to appear.
- `llama-cli.exe` / `llama-cli` — detected companion tool.
- `llama-bench.exe` / `llama-bench` — detected companion tool; Phase 10 can run it as a one-shot job.
- `llama-perplexity.exe` / `llama-perplexity` — detected companion tool; Phase 12 can run it as a one-shot job.

Supported tool input files in Phase 12:

- `.txt`
- `.raw`
- `.jsonl`
- `.md`

### Local manual laptop smoke-test example

For a temporary local CPU smoke test on this laptop only, you can add this llama.cpp build folder in the dashboard **Discovery folders** panel or your local uncommitted `data/settings.json`:

```text
C:\Users\Naavil\Downloads\llama-b9859-bin-win-cpu-x64
```

This path is a local example only. Do not hardcode it into committed defaults, example settings, profiles, scripts, or tests. A real deployment can point `llamaCppFolders` at GPU-enabled llama.cpp builds later.

You still need at least one configured model folder containing a `.gguf` model before `llama-bench` can run.

## Run llama-bench as a One-shot Job

`llama-bench` support uses the Jobs system, not runtime management. It does not start `llama-server` and does not make a model available at `http://localhost:8085/v1`.

Requirements:

1. Configure `llamaCppFolders` with a folder containing a discovered `llama-bench.exe` / `llama-bench` tool.
2. Configure `modelFolders` with a folder containing the `.gguf` model to benchmark.
3. Rescan builds and models from the dashboard.
4. Open **Jobs**, select the discovered GGUF model and `llama-bench` tool, then click **Run llama-bench**.

API route:

```text
POST /api/jobs/llama-bench
```

The request must select a discovered bench tool with `buildId` or `benchPath` and a discovered `modelPath`. If no discovered bench tool or GGUF model is available, the API returns a validation/conflict error instead of guessing paths or starting a runtime.

## Run llama-perplexity as a One-shot Job

`llama-perplexity` support uses the Jobs system, not runtime management. It does not start `llama-server` and does not make a model available at `http://localhost:8085/v1`.

Requirements:

1. Configure `llamaCppFolders` with a folder containing a discovered `llama-perplexity.exe` / `llama-perplexity` tool.
2. Configure `modelFolders` with a folder containing the `.gguf` model to evaluate.
3. Configure `toolInputFolders` with a folder containing a supported `.txt`, `.raw`, `.jsonl`, or `.md` input file.
4. Rescan builds, models, and tool inputs from the dashboard.
5. Open **Jobs**, select the discovered GGUF model, `llama-perplexity` tool, and input file, then click **Run llama-perplexity**.

API route:

```text
POST /api/jobs/llama-perplexity
```

The request must select a discovered perplexity tool with `buildId` or `perplexityPath`, a discovered `modelPath`, and a discovered `datasetPath`. The API rejects arbitrary paths that were not returned by configured discovery.

Perplexity (`PPL`) is a language-model evaluation measure where lower is generally better for the same dataset/tokenizer/evaluation setup. It is not a universal quality score: compare PPL only across similar models, tokenizers, context/options, and input data. Phase 12 does not implement KL-divergence mode, automatic dataset downloads, charts, or multi-job concurrency.

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

## Use the Better Profile Editor

The dashboard includes a Phase 5 **Profile editor** for manual profile setup and maintenance.

- Click **New manual profile**, enter the llama-server path, model path, host/port, and llama.cpp args, then click **Create draft**.
- Select an existing profile, edit its fields, then click **Save profile**. The profile ID is preserved while editing.
- Missing paths are allowed as draft warnings so you can save profiles before the files exist. Starting a runtime remains strict and requires a runnable profile.
- Validation separates **Blocking errors** from **Warnings**. Blocking errors prevent saving/importing; warnings describe non-blocking draft or configuration concerns.
- **Duplicate** creates a copy with a unique ID and does not overwrite the original profile.
- **Delete** removes stopped profiles only. The delete button is disabled for the currently running profile, and the service also rejects deleting the active managed profile.
- **Export profiles** produces portable profile JSON only; runtime state and logs are not included.
- **Import append/merge** accepts an exported object or a profiles array. Existing profiles are not overwritten by default; conflicting IDs receive new unique IDs, and invalid profiles are skipped with errors.

### Copy Runtime Commands and Starter Snippets

For a selected profile, click **Generate snippets** in the **Copyable starter configs** panel.

- **Copy command** copies the generated `llama.cpp` / `llama-server` command preview for the profile.
- **Copy OpenCode** copies a starter OpenAI-compatible provider snippet using the profile endpoint, for example `http://localhost:8085/v1`.
- **Copy Illustria** copies a starter OpenAI-compatible connection snippet using the same `/v1` endpoint.

These snippets are editable starters. OpenCode and Illustria should still connect directly to llama.cpp, not through ObsidianLM.

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

View runtime logs in the dashboard **Logs** panel. It streams live output while a managed runtime is running and can refresh recent persisted runtime logs from disk. The **Jobs** panel shows job logs separately.

## Safety Notes

ObsidianLM only stops the child process started by the current ObsidianLM service run. It never kills unknown processes and never kills a process just because it is named `llama-server.exe`.

Saving, duplicating, deleting, importing, or exporting profiles never starts, restarts, stops, or kills llama.cpp. Edits to a running profile are saved for the next start and do not change the currently running process. Deleting the currently running managed profile is blocked. Imports append/merge by default and do not overwrite existing profiles unless future explicit overwrite behavior is added.

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
