# ObsidianLM Project Plan

## 1. Project Summary

**ObsidianLM** is a lightweight local AI runtime manager.

Its first target runtime is:

```text
llama.cpp / llama-server.exe
```

The goal is not to replace llama.cpp or become the main inference server. Instead, ObsidianLM acts as a **control plane** for starting, stopping, configuring, monitoring, and switching llama.cpp builds, models, and profiles.

The actual consumers of the model will usually be external tools such as:

```text
OpenCode
Illustria
local scripts
future agents
```

These tools should communicate directly with the running llama.cpp server through its OpenAI-compatible API.

ObsidianLM should also be designed modularly so future support can be added for:

```text
llama-bench
llama-perplexity
ComfyUI
Stable Diffusion WebUI / Forge
Ollama
other local AI runtimes
```

---

## 2. Core Design Principle

ObsidianLM should separate the **control plane** from the **data plane**.

```text
Control Plane:
ObsidianLM UI + Service
        ↓
starts / stops / configures / monitors
        ↓
llama.cpp process


Data Plane:
OpenCode / Illustria / agents
        ↓
send prompts directly
        ↓
llama.cpp OpenAI-compatible API
```

ObsidianLM should not sit between OpenCode/Illustria and llama.cpp unless routing/proxy features are intentionally added later.

---

## 3. Target Deployment

The frontend/service will run on the main PC and be accessed from the laptop through Tailscale.

```text
Laptop browser over Tailscale
        ↓
http://100.84.76.75:8090
        ↓
ObsidianLM service on main PC
        ↓
llama-server.exe on main PC
```

OpenCode and Illustria will continue using the llama.cpp endpoint directly:

```text
http://100.84.76.75:8085/v1
```

Recommended ports:

```text
ObsidianLM UI/API: 8090
llama.cpp API:     8085
```

---

## 4. Chosen Technology Stack

### Frontend

Use:

```text
Vite + Svelte SPA
```

Reasoning:

- Lighter than Next.js.
- No SSR required.
- Suitable for a fast local dashboard.
- Can still look modern, polished, and interactive.
- Easy to serve as static files from the backend service.

Avoid for v1:

```text
Next.js
Electron
heavy charting libraries
large animation libraries
```

### Backend / Service

Use:

```text
Node.js + TypeScript + Fastify
```

Reasoning:

- Lightweight API server.
- Good process management support.
- Good TypeScript support.
- Easy to stream logs/status with SSE or WebSocket.
- Easy to serve the compiled Svelte SPA.
- Simple JSON-based config handling.

### Storage

Use JSON files for v1:

```text
settings.json
profiles.json
runtime-state.json
jobs.json
```

A database is unnecessary for v1.

### Service Mode

Development:

```text
npm run dev
```

Early real use:

```text
npm run build
npm run start
```

Later:

```text
WinSW or similar Windows service wrapper
```

The installed service should:

- Start on Windows startup.
- Auto-restart if ObsidianLM crashes.
- Ensure only one ObsidianLM service instance is active.

---

## 5. High-Level Architecture

```text
Main PC / FAMILYPC
│
├─ ObsidianLM Service
│  ├─ Fastify API
│  ├─ Static Svelte UI server
│  ├─ Auth layer
│  ├─ Process manager
│  ├─ Runtime adapter system
│  ├─ Tool/job adapter system
│  ├─ Profile manager
│  ├─ Folder/model scanner
│  ├─ GPU monitor
│  ├─ Port monitor
│  └─ Log manager
│
├─ llama.cpp builds
│  ├─ official CUDA build
│  ├─ turboquant build
│  └─ experimental builds
│
├─ model folders
│  └─ D:\Models\...
│
└─ managed runtime process
   └─ llama-server.exe
```

---

## 6. Single-Instance Rules

ObsidianLM must enforce:

```text
Only one ObsidianLM service instance
Only one active managed llama.cpp runtime
Future support for multiple runtime types
```

For v1:

```text
One active llama.cpp runtime only
```

But the internal data model should use generic terms such as:

```text
runtime
provider
profile
tool job
```

rather than hardcoding every part as llama-specific.

---

## 7. Startup Behavior

Chosen behavior:

```text
A. Start only the ObsidianLM dashboard/service.
```

On Windows startup:

```text
1. ObsidianLM service starts.
2. It does not automatically launch llama.cpp.
3. It scans for existing llama.cpp processes.
4. It checks the managed llama.cpp port.
5. It checks previous runtime state.
6. It shows warnings/status in the UI.
7. User manually starts the desired profile.
```

Optional future settings:

```text
Start default profile on boot
Start last used profile on boot
```

---

## 8. Stale Process Handling

Chosen policy:

```text
Auto-kill only stale processes previously started by ObsidianLM.
Show UI warning for everything else.
```

Startup process detection should classify running processes as:

| Category | Meaning | Default Action |
|---|---|---|
| Current managed process | Matches saved state and appears healthy | Adopt |
| Previous managed stale process | Started by ObsidianLM before but stale/unhealthy | Auto-stop if safe |
| Unmanaged llama.cpp process | Started manually or by old launcher | Warn in UI |
| Port conflict | Something is using the managed llama.cpp port | Warn and block launch |
| Unknown GPU process | Uses VRAM but is not managed | Show only |

Important rule:

```text
Never silently kill unknown processes.
```

Unknown processes may include:

```text
manual llama.cpp tests
llama-bench
llama-perplexity
Python scripts
ComfyUI
Stable Diffusion
other GPU tools
```

---

## 9. Folder Configuration

ObsidianLM should allow configuring multiple folders.

### Model Folders

Example:

```json
{
  "modelFolders": [
    "D:\\Models",
    "E:\\AI\\Models"
  ]
}
```

For v1, scan:

```text
.gguf
```

Future:

```text
.safetensors
.ckpt
.onnx
other model formats
```

### llama.cpp Build Folders

Example:

```json
{
  "llamaCppFolders": [
    "C:\\Users\\ahmed\\Downloads\\llama.cpp-cu13-official",
    "C:\\Users\\ahmed\\Downloads\\llama.cpp-turboquant"
  ]
}
```

The scanner should detect:

```text
llama-server.exe
llama-cli.exe
llama-bench.exe
llama-perplexity.exe
```

The UI should display builds in a friendly way, such as:

```text
Official CUDA 13 build
TurboQuant build
Experimental build
```

---

## 10. Runtime Providers vs Runtime Tools

This is important for future support of llama-bench and llama-perplexity.

Do not treat every executable as a long-running runtime.

### Runtime Providers

Long-running services that expose APIs:

```text
llama-server.exe
ComfyUI later
Stable Diffusion WebUI later
Ollama later
```

### Runtime Tools

One-shot or batch jobs:

```text
llama-bench.exe
llama-perplexity.exe
llama-cli.exe test prompts
GGUF metadata scanner
```

This keeps the architecture clean.

---

## 11. Adapter Structure

Suggested internal structure:

```text
runtimes/
  shared/
    runtime-types.ts
    runtime-adapter.ts
    command-spec.ts

  llama-cpp/
    provider.ts
    server-command-builder.ts
    process-detector.ts
    model-scanner.ts
    build-scanner.ts
    health-check.ts
    log-parser.ts

tools/
  shared/
    job-types.ts
    job-runner.ts
    job-result.ts

  llama-bench/
    job-runner.ts
    command-builder.ts
    result-parser.ts

  llama-perplexity/
    job-runner.ts
    command-builder.ts
    result-parser.ts
```

A future diffusion adapter should be able to live beside the llama.cpp adapter without rewriting the core service.

---

## 12. Suggested Repository Structure

```text
obsidianlm/
│
├─ apps/
│  ├─ web/
│  │  ├─ src/
│  │  ├─ index.html
│  │  ├─ vite.config.ts
│  │  └─ package.json
│  │
│  └─ service/
│     ├─ src/
│     │  ├─ api/
│     │  ├─ auth/
│     │  ├─ config/
│     │  ├─ logs/
│     │  ├─ monitoring/
│     │  ├─ process/
│     │  ├─ runtimes/
│     │  │  ├─ shared/
│     │  │  └─ llama-cpp/
│     │  ├─ tools/
│     │  │  ├─ shared/
│     │  │  ├─ llama-bench/
│     │  │  └─ llama-perplexity/
│     │  └─ main.ts
│     │
│     └─ package.json
│
├─ packages/
│  └─ shared/
│     ├─ src/
│     │  ├─ schemas/
│     │  ├─ types/
│     │  └─ constants/
│     └─ package.json
│
├─ data/
│  ├─ settings.json
│  ├─ profiles.json
│  ├─ runtime-state.json
│  └─ jobs.json
│
├─ logs/
│  ├─ obsidianlm.log
│  └─ runtimes/
│
└─ README.md
```

---

## 13. Settings Schema Draft

`settings.json`

```json
{
  "uiPort": 8090,
  "adminTokenHash": "stored-hash",
  "modelFolders": [
    "D:\\Models"
  ],
  "llamaCppFolders": [
    "C:\\Users\\ahmed\\Downloads\\llama.cpp-cu13-official",
    "C:\\Users\\ahmed\\Downloads\\llama.cpp-turboquant"
  ],
  "managedLlamaPort": 8085,
  "startupMode": "service_only",
  "staleProcessPolicy": "auto_stop_previous_managed_only"
}
```

---

## 14. Profile Schema Draft

`profiles.json`

```json
[
  {
    "id": "qwen35b-262k-official",
    "name": "Qwen 35B 262K Official",
    "runtimeType": "llama.cpp",
    "providerKind": "server",
    "buildPath": "C:\\Users\\ahmed\\Downloads\\llama.cpp-cu13-official\\llama-server.exe",
    "modelPath": "D:\\Models\\llmfan46\\Qwen3.6-35B-A3B-uncensored-heretic-GGUF\\Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_S.gguf",
    "host": "0.0.0.0",
    "port": 8085,
    "llamaArgs": {
      "ctxSize": 262144,
      "gpuLayers": "all",
      "devices": ["CUDA0", "CUDA1"],
      "splitMode": "layer",
      "tensorSplit": "5,3",
      "cacheTypeK": "q8_0",
      "cacheTypeV": "q8_0",
      "flashAttention": true,
      "batchSize": 4096,
      "ubatchSize": 1024,
      "parallel": 1,
      "threads": 8,
      "threadsBatch": 16,
      "metrics": true,
      "webui": true
    },
    "extraArgs": [
      "--timeout",
      "3600"
    ]
  }
]
```

---

## 15. Runtime State Schema Draft

`runtime-state.json`

```json
{
  "activeRuntimeId": "llama.cpp",
  "activeProfileId": "qwen35b-262k-official",
  "pid": 37204,
  "port": 8085,
  "startedByObsidianLM": true,
  "startedAt": "2026-06-28T00:00:00.000Z",
  "commandHash": "abc123",
  "status": "running"
}
```

---

## 16. Jobs Schema Draft

`jobs.json`

```json
[
  {
    "id": "job_001",
    "type": "llama-bench",
    "status": "completed",
    "createdAt": "2026-06-28T00:00:00.000Z",
    "startedAt": "2026-06-28T00:01:00.000Z",
    "finishedAt": "2026-06-28T00:10:00.000Z",
    "command": "llama-bench.exe ...",
    "exitCode": 0,
    "logPath": "logs/jobs/job_001.log",
    "resultPath": "data/jobs/job_001-result.json"
  }
]
```

---

## 17. API Design Draft

### Status

```text
GET /api/status
```

Returns:

```json
{
  "service": "running",
  "activeRuntime": {
    "type": "llama.cpp",
    "status": "running",
    "pid": 37204,
    "profileName": "Qwen 35B 262K Official",
    "apiUrl": "http://100.84.76.75:8085/v1"
  },
  "warnings": [
    {
      "type": "unmanaged_llama_process",
      "pid": 1234,
      "message": "Unmanaged llama-server.exe detected"
    }
  ]
}
```

### Profiles

```text
GET    /api/profiles
POST   /api/profiles
PATCH  /api/profiles/:id
DELETE /api/profiles/:id
POST   /api/profiles/:id/start
POST   /api/profiles/:id/validate
```

### Current Runtime

```text
POST /api/runtime/stop
POST /api/runtime/restart
GET  /api/runtime/logs/stream
GET  /api/runtime/command
GET  /api/runtime/health
```

### Discovery

```text
GET  /api/discovery/models
POST /api/discovery/models/rescan

GET  /api/discovery/llama-builds
POST /api/discovery/llama-builds/rescan
```

### Processes

```text
GET  /api/processes/llama
POST /api/processes/:pid/adopt
POST /api/processes/:pid/stop
POST /api/processes/:pid/ignore
```

### Monitoring

```text
GET /api/monitoring/gpu
GET /api/monitoring/system
GET /api/monitoring/ports
```

### Future Jobs

```text
GET  /api/jobs
POST /api/jobs/llama-bench
POST /api/jobs/llama-perplexity
GET  /api/jobs/:id
POST /api/jobs/:id/cancel
GET  /api/jobs/:id/logs/stream
```

---

## 18. UI Design

Frontend:

```text
Vite + Svelte SPA
Tailwind CSS or equivalent lightweight styling
dark-first UI
modern interactive controls
no heavy UI framework required
```

Main screens:

```text
Dashboard
Profiles
Models
Builds
Processes
GPU Monitor
Logs
Test Chat
Settings
Jobs later
```

### Dashboard Contents

```text
Current Runtime
- Status: Running / Stopped / Error / Warning
- Runtime: llama.cpp
- Profile: Qwen 35B 262K Official
- Model: Qwen3.6...
- Build: official CUDA 13
- PID
- API URL
- Health

Actions:
- Start profile
- Stop
- Restart
- Open llama.cpp WebUI
- Copy API URL
- Copy OpenCode config
- Copy generated command
```

### Warnings Panel

Should show:

```text
Unmanaged llama-server.exe detected
Port 8085 is already in use
Previous managed process was stale and stopped
GPU memory is being used by unknown processes
Configured model path is missing
Configured build path is missing
```

### GPU Monitor

Should show:

```text
GPU name
VRAM used/free
running GPU processes
llama.cpp process usage when available
unknown processes using VRAM
```

For v1, use:

```text
nvidia-smi
```

Later, NVML can be added.

### Logs

Should support:

```text
live log stream
search
copy
download
clear
view generated command
```

---

## 19. Authentication

Since ObsidianLM can start/stop executables, it should have basic access control even over Tailscale.

Use:

```text
single admin token
```

No user accounts in v1.

The UI should require the token before allowing control actions.

---

## 20. Development Phases

### Phase 0 — Skeleton

Goal:

```text
Create the basic app shell.
```

Tasks:

```text
Create monorepo
Create Fastify service
Create Svelte SPA
Serve SPA from Fastify
Add token auth
Add /api/status
Add settings JSON
```

Success condition:

```text
ObsidianLM opens at http://localhost:8090
and through Tailscale at http://100.84.76.75:8090
```

---

### Phase 1 — Basic llama.cpp Manager

Goal:

```text
Start and stop one configured llama.cpp profile.
```

Tasks:

```text
Add llama.cpp runtime adapter
Add profile JSON
Start selected profile
Stop managed process
Stream logs
Show generated command
Show running status
```

Success condition:

```text
User can start Qwen 35B profile from ObsidianLM and OpenCode can connect to port 8085.
```

---

### Phase 2 — Discovery

Goal:

```text
Detect models and llama.cpp builds from configured folders.
```

Tasks:

```text
Configure model folders
Scan GGUF models
Configure llama.cpp folders
Scan llama-server.exe builds
Create profile from detected model + build
Validate profile paths
```

---

### Phase 3 — Stale Process Detection

Goal:

```text
Handle stale llama.cpp launches safely.
```

Tasks:

```text
Scan running llama-server.exe processes
Detect old ObsidianLM-managed process
Auto-stop previous managed stale process
Detect unmanaged llama.cpp process
Detect port conflict
Show warning/action UI
```

---

### Phase 4 — GPU Monitor

Goal:

```text
Show GPU/VRAM state and process usage.
```

Tasks:

```text
Run nvidia-smi
Parse GPU name, VRAM, process list
Show RTX 5080 and RTX 3060 cards
Show llama.cpp VRAM usage where possible
Show unknown GPU processes
```

---

### Phase 5 — Better Profile Editor

Goal:

```text
Make profile creation and editing comfortable.
```

Tasks:

```text
Profile form UI
Advanced args editor
Common presets
Duplicate profile
Export/import profiles
Copy OpenCode config
Copy Illustria config
```

---

### Phase 6 — Job System

Goal:

```text
Support one-shot llama.cpp tools.
```

Future tools:

```text
llama-bench
llama-perplexity
llama-cli test prompt
```

Tasks:

```text
Add jobs model
Add queued/running/completed/failed/cancelled states
Run job command
Store job logs
Store parsed results
Support job cancellation
```

---

### Phase 7 — Windows Service Mode

Goal:

```text
Make ObsidianLM reliable as a background service.
```

Tasks:

```text
Package service
Add install-service command
Add uninstall-service command
Add auto-restart wrapper
Add service logs
Optional tray/helper app later
```

---

## 21. Implementation Rules

These rules should guide the project:

```text
1. ObsidianLM controls llama.cpp; it does not replace llama.cpp.
2. OpenCode and Illustria should continue talking directly to llama-server.
3. The llama.cpp API port should stay stable at 8085.
4. ObsidianLM UI/API should stay separate at 8090.
5. Unknown processes should never be killed silently.
6. Previous ObsidianLM-managed stale processes can be cleaned automatically.
7. Every launch must generate a copyable command.
8. Runtime-specific logic must live inside adapters.
9. llama-bench and llama-perplexity should be modeled as jobs/tools, not server runtimes.
10. The frontend should be static, light, and served by the Fastify service.
11. Use generic runtime/provider/tool abstractions so future non-llama.cpp support is possible.
12. Keep v1 simple and reliable before adding service packaging and advanced plugins.
```

---

## 22. Open Decisions

### UI Style

Possible options:

```text
A. Dark technical dashboard
B. Clean Apple-like control panel
C. Gaming/terminal cyber style
D. Minimal admin panel
```

Recommended:

```text
Dark technical dashboard with Obsidian-inspired polish.
```

### Config Location

Recommended:

```text
Development: ./data
Installed service: %PROGRAMDATA%\ObsidianLM
```

### Future Diffusion Support

Not decided yet.

Possible future adapters:

```text
ComfyUI
Stable Diffusion WebUI / Forge
```

### First Future Tool Support

Likely:

```text
llama-bench
llama-perplexity
```

These should be implemented as jobs, not long-running runtimes.

---

## 23. Recommended Next Step

The next step should be to create a focused builder prompt for:

```text
Phase 0 + Phase 1
```

That should include:

```text
Vite + Svelte SPA
Fastify TypeScript service
JSON config files
single admin token auth
profile start/stop
llama.cpp command builder
log streaming
basic dashboard
stable ports 8090 and 8085
```

Do not attempt all phases at once.
