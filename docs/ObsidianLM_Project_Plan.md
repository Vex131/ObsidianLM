# ObsidianLM Project Plan

## 1. Purpose and Status

ObsidianLM is a lightweight local AI runtime manager. It is the control plane for configuring, validating, starting, stopping, monitoring, and switching local AI runtimes. External inference clients continue to use the runtime's API directly.

This document separates three things that earlier revisions mixed together:

- **Completed foundation/history:** Phases 0-13 are implemented. Their original single-model runtime architecture was valid for those phases.
- **Completed UI restructure:** Phase 14 provides focused Dashboard, Runtime, Profiles, Models, Builds, Jobs, Logs, Telemetry, Settings, and System pages. Its discovery view reports static router CLI evidence.
- **Phase 15 foundation:** Builder Run 6 adds Build/router lifecycle integration to Run 5's deterministic exact-Build production preset and launch previews. Phase 15 remains incomplete; Phase 16 later adds Remote Nodes / Controller Mode.

The legacy compatibility surface still stores a model-bound launch profile:

```text
one ObsidianLM profile
        ↓
one llama-server executable
        +
one GGUF model
        +
that model's llama.cpp arguments
        ↓
one managed llama-server process
```

The shared contract preserves this history with `buildPath`, `modelPath`, `llamaArgs`, `host`, and `port` in one Profile projection. Current runtime lifecycle state is Build/router based and is stored in `router-runtime-state.json`; `runtime-state.json` remains legacy evidence.

## 2. Control Plane and Data Plane

The control-plane/data-plane boundary remains a project principle.

```text
Control plane

Browser
   │
   ▼
ObsidianLM UI/API :8090
   │
   ├── stores authoritative configuration
   ├── selects and validates a llama.cpp build
   ├── generates router presets
   └── manages the router lifecycle


Data plane

OpenCode / Illustria / local clients
   │
   ▼
llama.cpp :8085/v1
```

ObsidianLM must not become a general inference proxy merely to support router mode. Its diagnostic health and test-chat calls remain bounded control-plane diagnostics, not a replacement inference API. Phase 15 uses `GET /health` for bounded router/server health and `GET /models` for the router catalog and model load state. Relevant OpenAI-compatible `/v1/*` routes remain for direct inference clients and bounded inference validation, not as the primary router catalog/control surface.

## 3. Phase 15 Deployment and Remote Access

This is the approved same-host service deployment for Phase 15 and remains valid for Standalone/Node operation. Phase 16 adds the separate laptop Controller deployment described later; it does not invalidate direct browser access to a Node when intentionally configured.

```text
Main/home Windows PC
  ├── ObsidianLM Windows service
  ├── llama.cpp build folders
  ├── model folders on one or more drives
  ├── NVIDIA GPUs
  └── one managed llama.cpp router

Laptop
  ├── browser accesses ObsidianLM over Tailscale
  └── development/inference clients may access llama.cpp over Tailscale
```

Planned Phase 15 deployed operation is:

```text
Laptop browser
   │
   │ Tailscale
   ▼
ObsidianLM UI/API on home PC :8090
   │
   ▼
Managed llama.cpp router on home PC :8085
```

The runtime executables, generated presets, and model files remain on the home PC. Once ObsidianLM is installed as a Windows service, the managed router/build lifecycle must be controlled through ObsidianLM. The active llama.cpp router may load, unload, autoload, and evict same-build models according to its configured residency policy. A laptop batch file that opens SSH, copies or creates a launcher, starts one model, and keeps the SSH session alive is not the target deployed workflow.

SSH remains useful for administration, recovery, diagnostics, service installation/maintenance, and emergency manual access. Manual launch and SSH workflows may also remain useful during development. They are not required for the normal managed router/build lifecycle and must be presented as unmanaged/manual alternatives when they coexist with service mode.

Default endpoints remain stable:

```text
ObsidianLM UI/API: 8090
llama.cpp API:     8085
```

Clients should normally use `http://<home-pc>:8085/v1`. Tailscale connectivity does not replace ObsidianLM's admin-token authentication.

## 4. llama.cpp Router Decision

Current upstream llama.cpp supports a router mode in `llama-server`. The relevant controls include:

```text
--models-dir
--models-preset
--models-max
--models-autoload / --no-models-autoload
```

The router can enumerate presets, route POST requests using the request body's `model` field, autoload an unloaded requested model, and expose model availability/status through its model endpoints. A preset section name is a model identifier; non-conflicting configured aliases can also resolve to that model. Preset sections accept supported llama.cpp arguments without leading dashes; model-specific values override global preset values, while router command-line values have higher precedence.

Router endpoint responsibilities for Phase 15 are:

```text
GET /health
    bounded router/server health

GET /models
    router model catalog and load state

GET /models/sse
    optional future live model-state events; not required initially

relevant /v1 endpoints
    inference/client compatibility and bounded diagnostic inference
```

The catalog contract must accommodate states conceptually including `unloaded`, `loading`, `loaded`, `sleeping`, and failure/unavailable state where applicable. Current upstream can represent a failed child as unloaded with a nonzero exit code, so ObsidianLM must not freeze incidental field names or assume failure is always a separate status string.

For ObsidianLM, **generated model presets are preferred over directory-only inference**. Models on this machine can require different context, GPU placement, cache, multimodal, template, reasoning, or speculative settings. Directory scanning remains useful for discovery, but it must not become the authoritative configuration mechanism.

The upstream behavior summarized here was verified on 2026-08-28 against llama.cpp's current [`tools/server/README.md`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md), [`common/preset.cpp`](https://github.com/ggml-org/llama.cpp/blob/master/common/preset.cpp), [`tools/server/server.cpp`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server.cpp), [`tools/server/server-models.h`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server-models.h), and [`tools/server/server-models.cpp`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/server-models.cpp). Because llama.cpp evolves quickly, Phase 15 implementation must validate the selected local build's actual help, launch behavior, and API support rather than assuming every old or custom build supports the same keys.

### Router model-source isolation

Current upstream router construction combines models from the llama.cpp cache, an optional `--models-dir`, and `--models-preset`. Therefore, generated ObsidianLM presets alone do not prove that every router-visible model is an ObsidianLM-managed configuration.

The managed router uses a controlled per-Build cache/environment. Initial external or unknown catalog entries block startup; they never silently become managed/autoloadable models. No legacy adoption or kill is performed.

## 5. Phase 15 Target Runtime Architecture

```text
Laptop
  │ browser / control access over Tailscale
  ▼
ObsidianLM service on home PC
  │ controls build and managed router lifecycle
  ▼
ONE active llama.cpp router
  │ built-in model routing/loading
  ├── configured model preset A
  ├── configured model preset B
  ├── configured model preset C
  └── ...
```

The conservative single-managed-runtime rule remains:

```text
ObsidianLM
    ↓
selects/manages llama.cpp BUILD + router lifecycle

llama.cpp router
    ↓
selects/loads MODELS assigned to that active build
```

Only one managed router/build owns the normal `:8085` endpoint at a time. Initial router integration must not run several permanent routers or add a new inference gateway. This avoids competing GPU residency, multiple API ports, proxying, and unnecessary process complexity.

### Build-family limitation

The router resolves its own executable path and uses that executable when spawning model instances. One stock router therefore uses one llama.cpp executable/build family for all child model instances. A preset does not choose another `llama-server.exe`.

This is not a supported single-router topology:

```text
one router
├── Model A → latest official llama.cpp
├── Model B → custom MAX_COPIES=1 llama.cpp
└── Model C → older compatibility llama.cpp
```

Conceptual build families may include:

```text
Latest Official
Custom MAX_COPIES=1
Legacy/Compatibility Build
Experimental Build
```

ObsidianLM remains necessary because it chooses which build family is active and safely replaces the router when that choice changes.

### Builds without required router capability

Phase 15 must explicitly decide what happens when a discovered build fails required router capability validation:

- **Option A - router-only managed inference:** the build remains visible as a discovered build/toolchain but cannot become the active managed router.
- **Option B - legacy compatibility mode:** a separate one-model-per-server path remains only for builds with concrete user value that genuinely cannot support router mode.

Router-capable builds are the normal/default architecture. Option B must not be selected automatically to preserve old behavior; the decision must consider actual required legacy/custom builds, router feature support, maintenance cost, migration complexity, and user value. Version numbers alone are insufficient evidence. Validation should use actual executable help, launch behavior, and API support where practical.

## 6. Model Switching Semantics

### Same-build model switch

Same-build model switching is not yet implemented. Profile start is a temporary Build-selection hint and loads no model; clients must not infer switching support from the current lifecycle contract.

The target machine default is conceptually:

```text
models-max = 1
models-autoload = enabled
```

This preserves single-large-model residency on constrained VRAM. A request for another available preset under the active build can cause llama.cpp to unload/evict as required and load the requested model. Later real-machine testing may justify a different policy, but it must be an explicit decision.

### Cross-build model switch

When a requested configuration requires another build, the current router cannot satisfy it internally. ObsidianLM must perform a controlled lifecycle transition:

```text
stop current managed router
        ↓
verify shutdown and port release
        ↓
select and validate required llama.cpp build
        ↓
generate/use that build's preset
        ↓
start replacement router on :8085
        ↓
validate router health and model availability
```

The client endpoint remains `http://<home-pc>:8085/v1` after the replacement starts. The cross-build change is initiated through ObsidianLM.

An arbitrary inference request cannot transparently change build families while ObsidianLM remains outside the data path. Doing so would require a future inference-aware gateway/proxy or another intentional mechanism and is outside Phase 15.

## 7. Planned Domain Boundaries

Phase 15 must separate concepts without prematurely freezing exact TypeScript interfaces.

### Model artifact

A discovered local file, currently a GGUF file. It records file identity and metadata such as path, size, modification time, and safe format hints. Discovery does not imply a launch configuration.

### Configured model / model preset

An ObsidianLM-owned configuration with a stable unique identity and unique router-facing name or alias. It may include:

```text
model identity and GGUF reference
optional mmproj reference
display name and router alias
chat template / Jinja settings
context and parallelism
device, split mode, tensor split, main GPU, and GPU layers
KV cache, prompt cache, batch, and ubatch settings
reasoning settings
MTP/speculative settings
other model-specific supported llama.cpp flags
preferred or required llama.cpp build reference
preserved custom/unknown arguments where safe
```

This list is not exhaustive. ObsidianLM's structured configuration is authoritative; the generated llama.cpp INI is derived.

One GGUF can have several valid configured models. For example, official-build and custom-build configurations, different tensor splits, or vision-enabled and text-only configurations are distinct ObsidianLM identities even when they reference the same artifact. Discovery identity must never be used as the configured-model identity.

### llama.cpp build

A discovered and configured toolchain with a stable ObsidianLM build ID. It may record:

```text
friendly name
llama-server path
llama-bench path when available
llama-perplexity path when available
llama-cli path when available
version/build metadata when detectable
explicit official/custom/experimental/compatibility classification
router capability/flag validation
last validation state
```

Latest official is the preferred default only after validation. Custom builds are first-class. Older builds are compatibility exceptions rather than a permanent default. Replacing or upgrading a discovered build must not silently retarget every configured model; affected dependencies must be visible and validated first.

### Managed runtime

The managed runtime becomes the active router process, not a permanently model-bound server. It conceptually tracks:

```text
active build
router PID
host and port
generated router preset artifact
runtime state
available configured models
router catalog/load state when safely detectable
proven router child processes when safely detectable
```

### One-shot job

`llama-bench`, `llama-perplexity`, and future `llama-cli` tasks remain one-shot jobs. A job may independently choose a model artifact, a build/tool executable, and job-specific options. Jobs do not become router model instances and do not pass through the inference router unless a future feature explicitly requires it.

## 8. Multimodal and mmproj Configuration

Configured models must support an optional explicit `mmproj` association. A multimodal-capable GGUF can have both vision-enabled and text-only configurations, and more than one candidate projector may exist.

Future implementation must:

- preserve model-specific multimodal enable/disable choices;
- validate the selected model, projector, and build together;
- allow the user to choose among multiple projector files;
- avoid pairing a projector solely because it shares a directory unless the match is sufficiently reliable or user-confirmed;
- report missing or incompatible projector references as validation failures/warnings without deleting configuration.

No pairing heuristic is selected in this documentation phase.

## 9. Generated Router Presets

ObsidianLM will own a generated configuration area under the resolved data directory:

```text
<resolved ObsidianLM data directory>/generated/llama-router/<build-id>.ini
```

This follows existing path resolution: project-local `data/` in development unless overridden, and the service data directory under `%PROGRAMDATA%\ObsidianLM\data` in installed service mode unless overridden.

Generated preset requirements:

- Generate atomically using the same loss-resistant storage principles as current JSON state.
- Produce deterministic output from authoritative stored configuration.
- Be safe to delete and regenerate, but never silently substitute stale output for current configuration.
- Contain no admin tokens or other user secrets.
- Validate the selected build's supported router flags and preset keys before start.
- Escape and encode Windows paths correctly.
- Include multiple configured models assigned to the same build.
- Remain previewable and copyable from the UI.
- Never require users to maintain duplicate handwritten INI and ObsidianLM configuration.

Command preview becomes two related views:

```text
Router launch command
llama-server --models-preset <generated.ini> --models-max 1 --models-autoload --host 0.0.0.0 --port 8085

Model preset configuration
the generated INI sections and model-specific settings
```

These views must not be conflated. The exact accepted keys remain build-version-sensitive.

## 10. RuntimeManager Evolution

The production `RuntimeManager` has evolved to the Build/router lifecycle; legacy Profile projection remains for compatibility.

```text
Historical compatibility
RuntimeManager → one model-bound llama-server

Current
RuntimeManager → one router for selected build
               → strict `/health` and `/models` startup reconciliation
```

Remaining work includes:

- same-build model switching and cross-build stop/release/replacement transitions (Run 7);
- optional later `/models/sse` integration only if polling proves insufficient;
- separate bounded inference validation through relevant `/v1` endpoints;
- GPU child/log attribution and router/model-child process awareness (Run 8), without unsafe ownership inference.

The safety rule remains absolute:

> ObsidianLM only controls processes it can safely prove it owns.

## 11. Process, GPU, and Log Awareness

Router mode introduces a process tree:

```text
ObsidianLM
   ↓
managed router llama-server process
   ↓
router-created llama-server model child process
```

Process detection must evolve to distinguish:

```text
managed router
managed router child
previous managed router candidate
previous managed router child candidate
manual/unmanaged llama-server
unknown process
port conflict
```

Parent/child linkage, saved state, command evidence, and platform capabilities must be evaluated conservatively. Managing a router never implies ownership of every `llama-server.exe`. If ownership cannot be proved, warn rather than kill. Previous-process adoption and automatic cleanup remain future safety work, not assumptions.

GPU monitoring must not assume the router parent owns the model VRAM. The loaded child may perform inference and hold most VRAM. Future monitoring should associate only proven router children with the managed runtime. Unknown GPU processes remain read-only warnings; GPU process killing is not introduced.

Logging must keep these sources understandable:

```text
ObsidianLM service logs
router lifecycle logs
router/model-child output
one-shot job logs
```

Current upstream router source combines each child's stdout/stderr and forwards it through the router log with a child port prefix. Phase 15 must validate this behavior on selected Windows builds and preserve useful source/model context in ObsidianLM's runtime logs without tailing or adopting unmanaged processes.

## 12. Discovery Evolution

Existing discovery remains valuable but its outputs must no longer collapse directly into an opaque launcher.

```text
Model discovery → model artifacts
Build discovery → llama.cpp builds/toolchains
Configuration  → links artifacts and builds into configured models
```

Model discovery continues across multiple configured roots/drives and remains metadata-only. Build discovery should eventually capture stable build IDs, tool paths, metadata, classification, and router capability validation. Configuration creates the many-to-many relationship needed for one artifact to have several configurations and for one build to serve several presets.

Portable examples must use placeholders rather than committed machine-specific model/build paths.

## 13. Existing Profile Migration and Compatibility

`profiles.json` is implemented and has real behavior: create, edit, duplicate, delete, import/export, discovery-created profiles, validation, command preview, and runtime-state references. Phase 15 must not simply declare it obsolete.

Migration design and implementation must address:

- whether the existing profile evolves into a `ModelProfile`/configured-model type or maps into a new type;
- deterministic mapping of each old single-model profile to one configured model and one build record;
- conversion of `buildPath` into a stable build reference without merging distinct custom builds accidentally;
- distinct configured identities and router aliases for duplicate model paths or configurations;
- preservation of known `llamaArgs` and safe unknown/custom `extraArgs`;
- legacy export import with explicit version detection and non-destructive conversion;
- runtime-state conversion from active profile/process to active build/router state;
- backups of old data files before any mutation;
- missing build/model references represented as disabled or invalid configuration, not deleted data;
- validation before committing converted data;
- atomic writes, failure rollback, and a documented recovery path;
- idempotent or otherwise safely detectable migration so interrupted startup cannot duplicate records;
- preservation of the old files/backups long enough to make migration reversible.

Migration must be designed and tested before changing schemas. This documentation task performs no migration.

## 14. UI and UX Direction

The visual system remains defined by `DESIGN.md`; router work changes terminology and state presentation, not the visual language.

Future pages must make these concepts legible:

```text
Service
Managed router
Active llama.cpp build
Router endpoint
Available configured models
Currently loaded model, if known
Model configuration/preset
Build requirement
Restart/build-switch requirement
```

The UI must distinguish:

```text
Switch model
```

for a configured model available under the active build, from:

```text
Switch build & restart router
```

for a configuration requiring another executable. It must neither imply that every model change restarts llama.cpp nor that every model can switch without a restart.

The Models page should distinguish discovered artifacts from configured models. The Builds page should show dependent configured models before a build is changed or removed. The Runtime page should focus on router/build state and model availability. The existing Profiles page remains a historical/current configuration editor until migration design determines its target name and compatibility behavior.

## 15. Completed Phase History

The concise status below preserves history without duplicating the detailed README status log.

| Phase | Status | Historical delivery |
|---|---|---|
| 0 | Completed | npm workspaces, Fastify service, Svelte/Vite shell, shared contracts, JSON storage, status API. Authentication was completed later in Phase 9, not retroactively in Phase 0. |
| 1 | Completed | One validated model-bound llama.cpp profile, command preview, one managed child, stop/restart, logs, and dashboard controls. |
| 2 | Completed | Read-only model/build discovery from configured folders and discovery-created Phase 1 profiles. |
| 3 | Completed | Conservative startup detection and port-conflict warnings. It did not adopt or automatically kill unknown/previous candidate processes. |
| 4 | Completed | Read-only NVIDIA GPU monitoring and conservative process classification. |
| 5 | Completed | Profile create/edit/duplicate/delete/import/export, validation, and client/command snippets. |
| 6 | Completed | Generic serialized one-shot job foundation, separate from long-running runtimes. |
| 7 | Completed | Windows service scripts, path resolution, service-mode data/log locations, and service metadata. |
| 8 | Completed | Persisted runtime logs and SSE live runtime log streaming for managed processes. |
| 9 | Completed | First-run admin token setup, hashing, bearer protection, and settings sanitization. |
| 10 | Completed | Setup-required API blocking and initial `llama-bench` jobs. |
| 11 | Completed | Runtime health/test-chat diagnostics, storage hardening, and initial dashboard refactoring. |
| 12 | Completed | `llama-perplexity` jobs and configured tool-input discovery. |
| 13 | Completed | Readiness API/UI, isolated Playwright smoke infrastructure, and real-machine validation guidance. |

The historical runtime model in Phases 1-13 remains truthful. Router adoption is an architectural evolution after that work, not a rewrite of it.

## 16. Phase 14 - Operator Console Restructure

**Status:** Complete.

The approved operator-console shell and all ten focused pages are implemented. The `DESIGN.md` acceptance checklist is complete, including responsive navigation, fixture-backed E2E coverage, and current-source Jobs, Logs, Telemetry, Settings, and System behavior.

Phase 14 remains a UI restructuring phase. It does not implement the router, migrate profiles, or change runtime semantics.

## 17. Phase 15 - llama.cpp Router Integration

**Status:** Foundation and Build/router lifecycle implemented through Builder Run 6. Phase 15 is not complete.

### Goal

Evolve the one-profile/one-server runtime into one ObsidianLM-managed llama.cpp router for one selected build, with generated per-model presets and safe cross-build replacement on the stable `:8085` endpoint.

Run 5 added deterministic exact-executable, capability-aware production presets, atomic derived-artifact generation, freshness evaluation, and separate read-only preset/launch previews. Run 6 adds production launch through a Build/router `RuntimeManager`, controlled cache/environment, managed port preflight/ownership, and strict `/health`/`/models` reconciliation. It does not claim Phase 15 completion.

### Forward-compatible ownership constraint

Phase 15 abstractions must not bake in unnecessary same-host assumptions. Build selection, router lifecycle, generated presets, and cross-build replacement belong to ObsidianLM; same-build loading, unloading, autoload, residency, and eviction belong to llama.cpp. Paths, PIDs, ports, model identities, and build identities should be representable as Node-scoped resources later, without prematurely freezing remote APIs or TypeScript names. Phase 15 remains local in implementation, but its ownership boundaries must not make a future Controller/Node split unsafe or require interpreting every resource as belonging to the Controller host.

### Dependencies

- Existing Phases 0-13 foundation.
- Phase 14 UI restructuring is complete; Runs 3-6 deliver the Phase 15 domain, validation, preset, and Build/router lifecycle contracts.
- A current official build and representative custom/compatibility Windows builds for capability testing.
- Real local GGUF configurations, including multimodal and duplicate-artifact cases, kept outside committed defaults/tests.

### Work sequence

1. **Architecture and contracts:** **Implemented through Run 3.** Domain schema v2, canonical revisions, stable IDs, authority boundaries, route families, and explicit artifact/build/configured-model operations are established.
2. **Compatibility and migration:** **Implemented through Run 3.** Strict v1-to-v2 backup/atomic upgrade and legacy Profile compatibility/recovery behavior are verified. `profiles.json` is not rewritten after cutover.
3. **Build capability and catalog safety:** **Implemented in Run 4.** Exact local executables receive bounded static and functional control-plane validation on an isolated temporary loopback router. Current fingerprint evidence and explicit alias reconciliation are required for eligibility; unexpected catalog entries never become managed.
4. **Preset generation:** **Implemented in Run 5.** Deterministic atomic production INI generation per Build, Windows path handling, capability-aware validation, and separate launch/preset previews.
5. **RuntimeManager router support:** **Implemented in Run 6.** Launch one router, validate `/health` and strictly reconcile `/models`, stop safely, recover startup state, and retain managed port ownership rules.
6. **Build switching:** Run 7. Add explicit cross-build stop/release/start/validate transitions; same-build model switching also remains Run 7.
7. **Models/builds/runtime UI:** Run 7. Expose artifact versus configuration, active build, available/loaded model status, and switching actions.
8. **Process/GPU/log awareness:** Run 8. Classify proven router children, attribute GPU use conservatively, preserve useful router/child logs, and warn on uncertain ownership.
9. **Real-machine validation:** Validate official, custom, and compatibility builds; same-build autoload/eviction; cross-build restart; multimodal/text-only configurations; service restart; failure recovery; and direct client access.

### Safety requirements

- Keep one active managed router and one normal `:8085` owner.
- Never kill, adopt, or attribute an unknown process based only on its executable name.
- Verify router shutdown and port release before replacement.
- Validate generated configuration and selected build capability before launch.
- Prevent cache-, directory-, or environment-visible models outside the configured catalog from silently becoming normal managed models.
- Back up existing data before migration and fail without partial destructive conversion.
- Keep secrets out of presets, command previews, logs, and API responses.
- Preserve direct-client data-plane access and ObsidianLM admin authentication.
- Keep one-shot jobs independent from router lifecycle.

### Explicit non-goals

- No general inference proxy in ObsidianLM.
- No transparent cross-build routing based solely on inference requests.
- No multiple permanently active llama.cpp routers initially.
- No new gateway/proxy or multiple normal client endpoint configurations.
- No automatic downloading or updating of llama.cpp builds.
- No automatic deletion of legacy builds.
- No automatic killing of unknown llama.cpp or GPU processes.
- No model-format expansion beyond the formats explicitly supported by the phase.
- No replacement of the existing job system.
- No Docker or Electron requirement.
- No rewrite of the Windows service architecture.

### Acceptance criteria

- Existing compatible profiles migrate or import without silent loss, with backups and actionable invalid-reference states. The verified strict v1-to-v2 upgrade is backup-protected and atomic; `profiles.json` remains legacy migration/recovery material and is not rewritten by Profile API after cutover.
- One GGUF can back multiple stable configured-model identities and unique router aliases.
- Configured models can explicitly enable/disable/select `mmproj` and validate model/projector/build compatibility.
- ObsidianLM deterministically generates a validated preset containing all enabled configured models for one build.
- The UI can preview/copy both router launch command and generated preset.
- One managed router starts on the configured managed port, reports available models, and is the only normal managed runtime.
- Bounded router health uses `/health`; router catalog/load state uses `/models` rather than treating `/v1/models` as the control-plane catalog; diagnostic inference remains a separate check.
- ObsidianLM owns the managed build/router start, stop, restart, replacement, generated configuration, and endpoint lifecycle; llama.cpp owns same-build model loading, unloading, autoload, residency limits, and eviction.
- Router-visible models outside ObsidianLM's configured catalog are isolated, rejected, or clearly distinguished as external/unmanaged and cannot silently become normal managed/autoloadable models.
- The selected build is verified by actual capability evidence to provide required router behavior; unsupported builds have an explicitly designed safe ineligible or legacy-compatibility behavior.
- Same-build model selection and cross-Build/model switching remain Run 7; Run 6 does not claim either behavior.
- Process, GPU, and log views distinguish the router, proven children, unmanaged processes, and uncertainty without unsafe cleanup.
- `llama-bench` and `llama-perplexity` continue to run as independent one-shot jobs.
- OpenCode, Illustria, and local clients continue direct access through `http://<home-pc>:8085/v1`.

### Real-use validation

Automated tests may use fake executables and disposable data for contracts, migration, generation, and lifecycle failure handling. Completion also requires intentional validation on the home Windows PC with:

- at least two configured models under one current official build;
- a second custom or compatibility build;
- a duplicated GGUF configuration with a distinct build or GPU setup;
- one multimodal-enabled and one text-only configuration where available;
- `models-max=1` and autoload behavior under realistic VRAM pressure;
- service-mode start/stop/restart and recovery after a failed router start;
- direct inference clients over the stable endpoint/Tailscale path;
- confirmation that unknown/manual llama.cpp processes are warned about and left untouched;
- confirmation that cache- or environment-visible models outside the configured catalog do not silently become managed presets;
- confirmation of the designed behavior for at least one build that fails a required router capability check.

Do not claim Phase 15 complete from schema/unit tests alone.

## 18. Phase 16 - Remote Nodes / Controller Mode

**Status:** Future planning only. Unimplemented and not part of the current Phase 14/15 delivery.

Phase 16 extends the local control plane to multiple explicitly identified machines without changing the data-plane rule. It must preserve a useful single-machine Standalone mode while allowing a laptop Controller to operate a Home PC Node through an authenticated Node API. The initial target is one laptop Controller and one Home PC Node; this is Node-aware architecture, not a scheduler.

Phase 16 depends on Phase 15's build, configured-model, router-runtime, generated-preset, process-ownership, log, and job boundaries. It exposes those capabilities through a Node boundary rather than redesigning them. Phase 15 must therefore remain router-focused and Node-aware enough that Phase 16 can reuse it without moving machine-local operations into the Controller.

### 16.1 Modes and deployment shape

- **Standalone:** one ObsidianLM instance owns local configuration, filesystem, builds, processes, ports, GPUs, logs, jobs, generated presets, and runtime state.
- **Controller-only:** the laptop browser talks only to the laptop ObsidianLM backend. That backend mediates authenticated requests to selected Nodes and owns known connections, active selection, credential references, and UI preferences. It does not automatically manage the laptop as a Local Node.
- **Controller with Local Node:** an optional/future configuration may explicitly enable the same installation to manage its own machine alongside remote Nodes. This dual-role UX is not required for the first Phase 16 implementation if it materially increases scope.
- **Node:** an ObsidianLM instance owns one machine's resources and exposes a bounded, versioned Node API. The Node performs local discovery and local build/router operations.

Normal Controller-only startup must not scan laptop model/build folders, inspect laptop GPUs or llama.cpp processes, claim laptop port `:8085`, start a local router, or run other local discovery/runtime side effects. Local Node capability must be explicitly enabled.

Standalone remains the efficient same-machine behavior, conceptually equivalent to Controller plus Local Node within one installation. The exact internal architecture may differ, but remote abstractions must not force unnecessary network calls for local operation.

```text
Standalone Mode                 Controller Mode               Node Mode
ObsidianLM UI/backend           Laptop UI/backend             Home PC Node service
        ↓                               ↓                             ↓
same machine resources          authenticated Node API        local discovery/runtime
        ↓                               ↓                             ↓
models/builds/GPU/llama.cpp     remote Home PC Node           models/builds/GPU/llama.cpp
```

Target deployment:

```text
                         LAPTOP
                ObsidianLM Controller
                    localhost:8090
                           │
             authenticated Node API / Tailscale
                           ▼
                        HOME PC
                ObsidianLM Node Service
              models / builds / GPUs / processes
                   router / logs / jobs
                           │
                           ▼
                  llama.cpp router :8085

OpenCode / Illustria / other client ─────────► Home PC :8085/v1
```

External inference clients connect directly to the Home PC llama.cpp endpoint at `:8085/v1`; they do not pass through the Controller. The browser does not call arbitrary Node commands or directly inspect remote files.

### 16.2 Ownership and conceptual client boundary

The Node owns its filesystem and model artifacts, llama.cpp builds, runtime/router and child processes, ports, GPUs, logs, one-shot jobs, generated router presets, runtime state, and authoritative machine configuration. The Controller owns connection records, active Node selection, UI preferences, and credential references. There must be no split-brain authority for a Node's machine resources.

The Controller may request configured-model or other Node configuration changes only through typed Node APIs. The Node validates each request against its local resources and persists the authoritative result. The Controller must not maintain a competing authoritative remote configuration file.

Introduce a conceptual `NodeClient` boundary with Local and Remote implementations, without freezing those names or exact TypeScript interfaces. Local operations may call the local service boundary; Remote operations call typed Node API operations. Both must preserve Node and resource identity in results. A Controller must never apply local filesystem, process, PID, port, GPU, or `nvidia-smi` assumptions to paths or identifiers reported by a remote Node.

Resource identities for models, builds, runtimes, ports, processes, GPUs, logs, and jobs become Node-scoped. A Node identity is stable independently of hostname, IP address, endpoint, or display name. A saved connection conceptually associates the expected stable Node ID with a display name, editable endpoint, credential reference, and expected protocol/capabilities; exact field names remain subject to the future contract.

### 16.3 Handshake, capability limits, and transport

The Controller and Node need an authenticated capability/version and identity handshake, conceptually similar to `GET /api/node/info`, without freezing that route or response shape now. After pairing, reconnect must establish that the endpoint is bound to the saved expected Node ID before disclosing a reusable saved Node credential or issuing privileged requests; the exact trust/bootstrap mechanism remains open. If an endpoint now identifies as another Node, privileged operations are blocked, credentials are not trusted against the unexpected Node, the UI reports the mismatch clearly, and explicit re-pairing/re-authorization is required. Legitimate hostname, IP, port, or other endpoint edits do not redefine Node identity.

Plain HTTP is acceptable only on localhost or inside an encrypted/authenticated overlay transport such as Tailscale. Tailscale supplies encrypted transport and connectivity, not ObsidianLM authentication; application authentication is still required. Controller-to-Node communication over an ordinary LAN or WAN without such an encrypted overlay requires HTTPS/TLS when carrying bearer tokens or other credentials. Phase 16 does not require product-managed PKI or certificate provisioning. Do not add Tailscale APIs, provisioning, or route-management responsibilities to ObsidianLM.

Version and capability results determine which controls are enabled. Safe read-only compatibility may remain available where explicitly supported, but unsupported controls are disabled with a clear capability/version warning. The Controller must not guess, attempt a dangerous fallback, or translate an unsupported typed action into arbitrary remote execution. Node API operations must be typed router/build/model/discovery/telemetry/job operations, never a general arbitrary-command endpoint.

A Node endpoint is operational configuration, not a credential. An authorized Controller may receive and display endpoints such as `home-node.tailnet-name.ts.net:8090`, `10.x.x.x:8090`, or `https://node.example.internal`. Endpoints should not leak into unauthenticated/public responses, unrelated logs, public diagnostics, or portable exports that should omit deployment-specific details.

Authentication secrets include raw tokens, token hashes, passwords, pairing secrets, private authentication material, and credential-store values. They must never appear in normal API responses, generated presets, command previews, logs, job output, telemetry, portable model/router exports, or committed examples. Remote credentials remain separate from normal Node metadata, model profiles, and router presets. Existing admin-token infrastructure may bootstrap a connection if its security properties remain sound; the design must leave room for later OS-backed secret storage such as Windows Credential Manager. The exact credential storage mechanism remains open.

### 16.4 Discovery and runtime operations

Remote discovery is executed by the selected Node using the same local discovery rules and configured roots it uses in Standalone mode. The Controller receives metadata and validation results; it does not mount drives, use SMB, scan remote paths, or infer access from a shared path string. Generated presets are validated, generated, and persisted locally on the Node after the Node validates model/build references; the Controller does not copy files or use SCP.

Discovery metadata may cover configured model folders, GGUF files, llama.cpp builds, `llama-server`, `llama-bench`, `llama-perplexity`, and tool input files. An authenticated Controller may display and copy paths such as `D:\Models\...`, `E:\Models\...`, or `D:\llama.cpp-builds\...` as operational data. These remain Node-local values and must never enter Controller-local filesystem, process, or executable logic.

The Controller requests typed operations such as select build, validate build, generate preset, start/stop/restart router, switch same-build model, and perform cross-build replacement. ObsidianLM still owns build selection, router lifecycle, generated presets, and cross-build replacement; llama.cpp still owns same-build loading, unloading, autoload, residency, and eviction. Jobs select Node, build, model, and dataset, but normal Controller operation does not transfer large model or dataset files.

The remote runtime view may retrieve service health, active build, router running/stopped state, router PID and endpoint, configured and available models, router catalog/load state, GPU usage, classified processes, recent logs, jobs, and warnings. These capabilities may use focused endpoints or streams; Phase 16 does not require one giant status response. All actual inspection and lifecycle work occurs on the Node.

### 16.5 Disconnect and state behavior

Disconnecting a Controller must never stop, unload, or otherwise alter a Node runtime. Reconnection refreshes current Node state and reconciles it with clearly labeled last-known state. Live monitoring and logs use reconnecting/offline states, bounded history, timestamps, and source plus Node labels. A stale last-known runtime is not shown as stopped. SSE or equivalent streams must reconnect safely and use bounded history rather than requiring unbounded replay.

Node-local ownership evidence remains authoritative for process actions. A Controller must not adopt, stop, or attribute an unknown remote process merely because a PID, executable name, port, or GPU row was reported. Unknown-process safety and Node-local proof rules continue to apply after disconnection and reconnect.

### 16.6 Configuration ownership and removal

Node persistence contains authoritative machine configuration, local discovery roots, model/build records, runtime state, generated presets, logs, and jobs. Normal Controller persistence contains known Node connections, expected Node identities, editable endpoints, active Node selection, credential references, and UI preferences. Credential secrets belong in a separate protected storage boundary selected during implementation; they do not belong in normal Node metadata or portable configuration.

Remote configuration mutations must detect stale or conflicting writes rather than silently overwriting newer authoritative Node state. If a Controller loaded revision A and a local Node UI or another authorized editor has already produced revision B, a later save based on revision A must fail safely and report the conflict clearly. The exact optimistic-concurrency mechanism remains open.

Removing a Node from the Controller only removes that Controller connection, associated Controller-held credential, and related local selection metadata. It must not delete Node data, stop processes, uninstall services, remove models/builds, or remotely revoke/reset Node state implicitly. Node-side deletion or reset is a separate explicit local operation.

SSH remains an administrator/recovery/diagnostic path only, never normal Controller-to-Node transport. No SCP-based preset or model workflow is introduced.

### 16.7 Work sequence

1. **Ownership and identity contract:** document Node-scoped resource identity, stable Node identity, Controller/Node persistence, and the Local/Remote client boundary.
2. **Handshake and authentication:** prototype capability/version negotiation, authenticated connection bootstrap, token handling, pairing/rotation direction, and unsupported-action behavior.
3. **Node service boundary:** expose the smallest typed status, discovery, build, model, runtime, log, telemetry, and job operations; reject arbitrary command execution.
4. **Local adapter:** route existing Standalone behavior through the conceptual Node boundary without changing current local semantics or endpoints.
5. **Remote adapter and Controller mediation:** add remote connection lifecycle, active Node selection, timeouts, retries, error translation, and no-local-assumptions enforcement.
6. **Node-aware UI state:** add persistent Node context, capability-limited controls, source/Node labels, remote-path handling, and live versus last-known state treatment.
7. **Monitoring and jobs:** add reconnecting SSE/bounded history, Node-scoped telemetry/logs/jobs, and selected Node/build/model/dataset labels without large-file transfer.
8. **Real deployment validation:** validate laptop-to-Home-PC operation, disconnect independence, reconnect state, auth failures, unsupported capabilities, cross-build replacement, direct `:8085/v1` inference, and safe removal.

### 16.8 Explicit non-goals

- No inference proxy through the Controller.
- No SSH-based normal control transport.
- No SMB or network-drive dependency for discovery.
- No arbitrary remote shell or `run-command` API.
- No automatic model or dataset copying between Nodes.
- No distributed inference, cluster scheduler, or load balancing across Nodes.
- No automatic model replication.
- No remote Windows service installation from the Controller in the first phase.
- No automatic Tailscale provisioning or management API integration.
- No automatic killing, adoption, or cleanup of unmanaged remote processes.
- No multi-Node scheduling, even though identities and contracts must not hard-code one remote machine.

### 16.9 Acceptance criteria

**Controller**

- A laptop ObsidianLM Controller can configure and connect to a Home PC Node.
- A saved Node connection has an expected stable Node identity independent of its endpoint.
- Post-pairing reconnect establishes the expected Node identity before disclosing a reusable saved Node credential or issuing privileged requests.
- Reconnecting to an endpoint that identifies as another Node blocks credential disclosure and privileged operations and requires explicit re-pairing/re-authorization.
- Endpoint updates do not silently redefine Node identity.
- Controller-only Mode does not automatically scan or manage laptop models, builds, GPUs, processes, ports, discovery, or runtimes; Local Node capability is explicit.
- Node identity and capability handshake establish online/offline and supported-action state.
- Protocol/version mismatch allows only explicitly safe compatibility behavior, disables unsupported actions, and reports a clear warning without guessing or dangerous fallback.
- Browser traffic goes to the laptop backend; the browser does not directly call a Node or arbitrary remote command endpoint.
- Controller visibly identifies the active Node and keeps connection metadata, selection, protected credentials, and UI preferences separate from Node machine state.
- Local and Remote NodeClient behavior has one typed semantic boundary without freezing public TypeScript names prematurely.
- Unsupported actions are disabled with an explanation based on capability/protocol state.

**Node**

- Node owns local filesystem, models, builds, processes, ports, GPUs, logs, jobs, generated presets, and runtime state.
- Node identity remains stable across hostname/IP/display-name changes, and all resource identities are Node-scoped.
- Node-local discovery, validation, preset generation, persistence, and process ownership remain authoritative.
- Controller-requested configuration changes are validated and persisted by the Node through typed APIs; no second authoritative Controller copy exists.

**Discovery**

- Remote discovery runs on the Node using its configured local roots.
- The Controller can browse models from `D:`/`E:`-style roots, remote llama.cpp builds/tools, and tool inputs without direct filesystem access.
- Remote absolute paths are displayed with Node context and are never interpreted as Controller-local paths.
- No mount, SMB scan, SCP transfer, or Controller interpretation of remote paths is required.

**Runtime**

- Typed operations preserve Phase 15 responsibility split: ObsidianLM selects builds and manages router lifecycle; llama.cpp manages same-build model residency.
- The Controller can see router state, active build, configured/available model state, router catalog/load state, and generated preset details.
- The Controller can start, stop, and restart the managed router through typed Node operations.
- Same-build model requests and Node-executed cross-build replacement preserve Phase 15 semantics.
- Presets are generated and persisted on the Node after validation.
- Stale remote configuration mutations cannot silently overwrite newer authoritative Node state; conflicts fail safely and are reported clearly.
- Disconnecting the Controller never stops the Node runtime; reconnect restores current state.
- There is no arbitrary command endpoint, scheduler, or multiple permanent routers introduced by this phase.

**Independence**

- External clients continue direct inference to the selected Node's llama.cpp `:8085/v1` endpoint.
- SSH is admin/recovery only, not normal transport.
- Removing a Node from a Controller does not alter Node resources.

**Monitoring**

- Remote GPU/process data is sanitized structured Node output; unknown processes remain unmanaged.
- Remote service, router/runtime, router-child where supported, and job logs can be viewed with source and Node labels.
- `llama-bench` and `llama-perplexity` jobs can run on the selected Node using Node-local tools, models, and inputs.
- Logs, telemetry, jobs, SSE events, and bounded history include source and Node labels.
- Offline/last-known state is distinct from stopped; reconnect is bounded and does not imply a restart.
- Jobs identify Node, build, model, and dataset without normal large-file transfer.

**Security**

- Node API authentication is mandatory; Tailscale is documented as encrypted connectivity, not application authentication.
- Plain HTTP is limited to localhost or an encrypted/authenticated overlay; credential-bearing remote operation outside such an overlay requires HTTPS/TLS.
- Node endpoints are operational configuration that authorized Controllers may receive/display, not credentials; they remain absent from unrelated public surfaces and portable exports where deployment details do not belong.
- Remote credentials are separate from Node metadata, model/router configuration, and portable exports.
- Raw tokens, token hashes, passwords, pairing secrets, private authentication material, and credential-store values never appear in normal API responses, presets, previews, logs, exports, or telemetry.
- Bootstrap, future token rotation/pairing, and OS secret storage have an explicit design path.

**Safety**

- Controllers never apply local FS/process/PID/port/GPU assumptions to remote reports.
- Unknown-process and ownership evidence rules remain Node-local; no unsafe adoption or cleanup occurs after reconnect.
- Node removal is non-destructive and Controller-side only.

**Real deployment validation**

- A laptop Controller operates a Home PC Node over Tailscale's encrypted transport plus ObsidianLM authentication, or over appropriately configured HTTPS/TLS plus ObsidianLM authentication, using generic placeholder identities and no committed secrets.
- Local discovery on the Home PC finds models/builds without remote mounts; generated presets remain on the Home PC.
- Same-build model loading and cross-build router replacement work on the Node while external clients continue direct `:8085/v1` access.
- Controller disconnect leaves runtime, jobs, logs, and processes running; reconnect shows current state and clearly marked bounded last-known history.
- Auth rejection, capability mismatch, stale/offline state, unknown-process safety, and safe Controller-side Node removal are verified.

Phase 16 remains future/unimplemented until these criteria and real deployment checks are satisfied.

## 19. Later Work

Potential later work remains intentionally separate:

- default/last build startup policy after safe recovery is proven;
- richer build dependency/validation reports;
- additional one-shot `llama-cli` jobs;
- non-llama.cpp runtime adapters;
- an inference-aware gateway only if a concrete future requirement justifies entering the data path.

## 20. Open Decisions for Phase 15 Design

These decisions require contract prototypes and migration fixtures rather than guesses in this documentation run:

- Whether the user-facing/current `profile` term evolves into `ModelProfile`, `ModelConfiguration`, or a versioned new type while retaining legacy import compatibility.
- The exact stable-ID strategy for moved model artifacts and relocated build folders.
- Which custom `extraArgs` can be represented structurally, which can be emitted safely into presets, and how unsupported keys are preserved for older/custom builds.
- Which parent/child process evidence is reliable enough on supported Windows versions for control rather than warning-only attribution.
- The exact router health/status API subset to trust across official, custom, and older supported builds.
- The concrete router model-source isolation strategy for supported builds and how any external catalog entries are represented.
- Whether unsupported builds are ineligible for managed inference or justify a separately maintained legacy compatibility mode.

## 21. Open Decisions for Phase 16

These remain implementation-time design decisions and are not resolved by this corrective pass:

- Exact Controller-to-Node API and protocol shape.
- Node bootstrap and pairing mechanism.
- Stable Node identity mechanism and proof during pairing/reconnect.
- Credential storage backend, including whether and when to use OS-backed storage.
- Detailed Node identity verification and re-authorization flow after endpoint changes.
- Configured-model write authority details within the rule that the Node persists the authoritative state.
- Controller/Node configuration revision and conflict mechanism.
- Protocol/version compatibility policy, including the bounds of safe read-only compatibility.
- Detailed TLS requirements outside encrypted overlay networks and whether product-managed certificate provisioning is ever in scope.
- Whether the first Controller Mode release supports an optional Local Node.
- Whether Local and Remote Nodes use exactly the same internal abstraction in the first implementation.

## 22. Next Step

Phase 14 is complete. Begin Phase 15 with the architecture/contracts and migration-foundation work required before router runtime implementation.
