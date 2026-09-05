# Phase 15 Contract Foundation

Builder Runs 1-10 add the versioned domain contract, storage, legacy Profile migration, persistent model/build foundations, bounded functional Build validation, the production derived-preset pipeline, Build/router lifecycle integration, explicit model/Build switching, conservative process/GPU/log awareness, the configuration-facing operator console, and direct Runtime/Dashboard integration. Phase 15 product foundation is complete through Run 10, and Run 11 real-machine certification is complete. Track B retains documented non-blocking B5 Partial, B6/B8 N/A, and B10 Skip outcomes; B3 and B11 passed under their correct matrix IDs — see `docs/validation/phase15-run11.md`.

## Terms and authority

- **Model Artifact** is a discovered or stored physical resource. Discovery does not make it runnable.
- **Configured Model** is the ObsidianLM-authoritative runnable configuration linking one artifact, one llama.cpp build, a stable router alias, settings, and optional explicit projector.
- **llama.cpp Build** is a stable ObsidianLM record distinct from Phase 14's ephemeral discovery result.
- **LegacyProfileCompatibilityBinding** preserves the legacy Profile/API relationship after cutover; it is separate from immutable migration history.
- ObsidianLM structured configuration is authoritative. Generated router INI files are versioned, derived, disposable artifacts.

## Domain schema and authority

- `phase15-domain.json` is the authoritative schema-v2 configuration. Its canonical revision changes only when stored authoritative content changes; equivalent reads and no-op writes do not create a new revision.
- The strict v1-to-v2 upgrade path was verified with a backup and atomic replacement. A valid v2 file ignores `profiles.json` changes.
- `profiles.json` remains legacy migration/recovery material. After cutover, the Profile API projects from the domain and translates writes into one domain transaction; it never rewrites `profiles.json`.
- Legacy Profile IDs and `host`/`port` are retained. Profile start starts and loads its mapped model when stopped or selects it in place under the same active Build. It returns `build_switch_required` rather than hiding a cross-Build replacement; `activeProfileId` and `/api/profiles` remain compatibility only, not lifecycle or loaded-model authority.

## Identity

Artifact, Configured Model, Build, router alias, and runtime IDs are distinct types. New persisted identities are opaque generated IDs; deterministic seeds are supported for repeatable legacy migration. A stored ID does not change when a display name or resource locator changes. Legacy migration may deduplicate artifact/build records by its normalized source reference, but each legacy Profile receives its own Configured Model ID, so duplicate GGUF configurations and duplicate names remain distinct.

Router aliases use the conservative lowercase subset `[a-z0-9._-]`, begin and end with alphanumeric characters, and are at most 64 characters. Initial aliases derive deterministically from display text. A deterministic Configured Model ID suffix resolves collisions. The resulting alias is stored and does not track later display-name changes. This subset is intentionally narrower than potentially build-specific upstream behavior until functional validation proves otherwise.

Resource references include an owner scope. Run 1 uses local ownership but permits a future Node identity without changing artifact, build, configuration, or generated-artifact identity. It does not implement Phase 16 APIs or remote behavior.

## Persistent artifacts and builds

- Persistent Model Artifacts and stable Builds are distinct from Phase 14 discovery results. Configured folders synchronize automatically into the catalog; IDs remain stable, dependent deletion is protected, and discovery candidates are never auto-selected.
- Configured Model CRUD, duplication, and revalidation are explicit operations. Projector associations are explicit and projected separately; candidates are never paired or selected automatically.

Runtime and readiness authority:

- App shell, Runtime, and Dashboard consume `RouterRuntimeState` directly rather than deriving lifecycle from an active Profile.
- Runtime owns managed router lifecycle, active router configuration, actual router launch command, and the Configured Model drawer. Same-Build selection uses `switch-model` without restart; cross-Build selection uses backend `switch-build`/restart on the same endpoint and has no automatic rollback.
- Dashboard presents a high-level active Build, loaded model, and resource summary. Run 8 GPU/process/log attribution is integrated read-only.
- Readiness counts/checks are authoritative for Configured Models, stable cataloged Builds, and router-eligible Builds. Discovery remains evidence and does not establish readiness or eligibility.

## Build eligibility

Static Phase 14 evidence and bounded functional router evidence are separate contracts. Classification or visible CLI flags never establish eligibility. `POST /api/builds/:id/validate-router` executes the exact resolved/available local server after static preflight, using a temporary loopback port, a disposable one-model probe preset, and a sanitized environment with an empty controlled `LLAMA_CACHE`. The probe calls only `/health` and `/models`; it does not load a model or perform inference. Eligibility requires launch, preset, health, catalog, catalog-boundary, protocol-version, and current executable-fingerprint evidence. Replacing or removing the available server invalidates functional eligibility. Missing local model prerequisites and Node-owned resources remain `not_validated`; deterministic unsupported behavior is `ineligible`, while inconclusive operational failure is `failed`.

Functional validation certifies the required router controls and control-plane behavior only. It does not certify real autoload, eviction, GPU residency, or `models-max=1` behavior under load. Those remain later runtime and real-machine validation work. An ineligible Build remains cataloged and may still support independent Jobs; there is no automatic model-bound fallback.

## Router boundaries

Run 4 adds a validation-only router probe. Run 5 adds read-only preset and launch previews plus explicit preset generation under the `/api/builds` route family. Run 6 adds production launch. Run 7 adds `POST /api/runtime/switch-model` and `POST /api/runtime/switch-build`; discovery endpoints remain evidence-producing and non-authoritative. Local UI/API/SSE operations use no admin token, credential bootstrap, or Authorization header.

- `GET /health` supplies bounded router/server health evidence.
- `GET /models` supplies the router catalog and model load state.
- `/v1/*` remains inference compatibility and bounded diagnostic inference, not the router control-plane catalog.

Catalog entries are normalized and deterministically discriminated by ownership. A managed entry requires the exact expected router alias-to-Configured-Model relationship. Identifiable unexpected entries are external; malformed, duplicate, or ambiguous identifiers are unknown/mismatched. External or unknown entries cannot carry a Configured Model ID. Path, filename, metadata, source hints, or cache visibility are never management proof. The controlled one-model probe fails catalog-boundary verification if anything unexpected appears. This parser and isolation environment are reusable by the later managed router.

## Production preset pipeline

Run 5 derives `<data>/generated/llama-router/<build-id>.ini` from one eligible local Build and all enabled Configured Models assigned to it. The exact preset is `version = 1`, followed by one `[router-alias]` section per configured model with `model = <absolute-local-model>` and only validated model options; an explicit projector emits `mmproj`/`mmproj-file`. `phase15-domain.json` remains authoritative; generated files have `authority: "derived"`, are disposable, are never imported, and can be regenerated. Generator semantics are identified by `llama-router-preset-v1`. A deterministic per-Build SHA-256 source revision includes only generation-relevant Build fingerprint, exact capability evidence, enabled model configuration, and referenced model/projector resources. The content hash is SHA-256 of the exact UTF-8, LF-only INI bytes.

The exact executable is fingerprinted around capability acquisition and again before atomic commit. Structured settings resolve through that Build's parsed flag manifest. Unsupported model behavior, unsafe INI values, duplicate effective keys, unsafe router-owned overrides, unrepresentable raw arguments, and secret-bearing options invalidate generation rather than disappearing. Only explicit projectors emit `mmproj`; candidates are not selected. Legacy `metrics` and `webui` values produce bounded warnings because they are router-global, not model-child settings.

`GET /api/builds/:id/router-preset/preview` and `GET /api/builds/:id/router-launch/preview` are read-only. `POST /api/builds/:id/router-preset/generate` performs the loss-resistant temporary-write, byte/hash verification, source recheck, and rename. Freshness compares bounded existing bytes with expected bytes: matching is `current`, differing is `stale`, and missing is `unknown`. A failed regeneration leaves an older stale file intact. The current Run 5 launch argv is `[resolved/available server executable, "--host", "0.0.0.0", "--port", <managed-port>, "--models-preset", <data>/generated/llama-router/<build-id>.ini, "--models-max", "1", <positive autoload flag>]`; the final flag is the exact positive flag proven by Build help. It does not include `--model` or `--models-dir`.

Generator validation means authoritative inputs, exact-Build mappings, and serialization are coherent. The disposable Run 4 probe INI is not a `GeneratedRouterArtifact`. `router-runtime-state.json` is current lifecycle authority; `runtime-state.json` is preserved legacy evidence and is not rewritten by the router lifecycle. Run 6 uses a controlled per-Build cache/environment, performs managed port preflight/ownership checks, and blocks initial external or unknown catalog leakage. Run 7 serializes refresh and lifecycle operations. Same-Build switching requires the exact launch-time ID/alias map, calls `POST /models/load` once when needed, and polls `/models` until the target is observed loaded. The router PID/runtime identity is unchanged; llama.cpp owns unloading, residency, LRU eviction, and `models-max=1` enforcement. Cross-Build switching prepares the target before source shutdown, verifies exit and port release, revalidates target evidence, starts on the same endpoint, then loads the requested model. It never adopts or kills unknown processes, overlaps production routers, uses an alternate port, proxies inference, or automatically rolls back. A target router remains running if only its requested model fails to load. Run 8 proves a current child only from current in-memory router ownership, direct parent PID, and exact active-Build executable path. Launch-time alias/port evidence may add model/log attribution but never ownership authority. GPU totals include the proven router parent and children; previous and unknown rows remain excluded/read-only. Runtime JSONL and SSE add origin/model metadata while legacy entries remain readable and unknown formats preserve raw output. No child kill, adoption, direct HTTP control, process-tree persistence, or generated logging flags were added. Run 9 makes Profiles the Configured Model editor, Models the configuration/Artifact relationship and router-observation view, and Builds the stable Build readiness/generated-artifact view. Run 10 integrates `RouterRuntimeState` directly into App shell, Runtime, and Dashboard; Runtime owns router lifecycle, active router configuration, actual launch command, and Configured Model drawer, while Dashboard owns the high-level active Build/loaded-model/resource summary. Run 8 GPU/process/log attribution remains read-only. Readiness counts/checks use authoritative Configured Models, stable cataloged Builds, and router-eligible Builds; discovery remains evidence.

## Migration

Migration contracts record source and target versions, source revision, status, backup evidence, deterministic mappings, invalid references, warnings/errors, and recoverability. Completed-source metadata supports repeat detection; `in_progress` and `interrupted` states support later recovery handling. Missing model, build, or projector references remain explicit invalid records rather than being discarded. Test fixtures use only `/fixtures/...` paths and perform no writes.

## Storage and legacy migration

- `phase15-domain.json` is the schema-version-2 atomic snapshot for model artifacts, Configured Models, stable builds, compatibility bindings, and completed migration evidence. It is authoritative after cutover. Its canonical revision changes only when stored authoritative content changes; a valid v2 ignores `profiles.json` changes.
- A SHA-256 hash of canonical, ID-ordered legacy Profile content is the source revision. Stable IDs use normalized local resource keys and legacy Profile IDs; duplicate-name alias allocation follows that deterministic order.
- Startup migrates before forgiving legacy storage recovery. Missing, valid, invalid JSON, unsupported shape, and I/O failure are distinct. Invalid or unsupported Profile bytes receive a migration-specific `profiles.json.phase15-<timestamp>-<hash>.bak` backup and startup fails; they never become a successful empty migration.
- A verified, unique backup of valid original Profile bytes precedes complete in-memory target construction. The target is written to a transaction-owned temporary file and atomically renamed only after validation. Exact completed source revisions are not rewritten; changed valid sources rebuild a complete replacement snapshot. After cutover, Profile API writes do not rewrite `profiles.json`.
- Malformed, unsupported, or structurally inconsistent Phase 15 targets receive a unique `phase15-domain.json.corrupt-phase15-<timestamp>-<hash>.bak` backup and startup fails. They are never reset to an empty authoritative store.
- Missing model/build files remain stored as missing references and disable/invalidate only their Configured Models. Existing resources remain `not_validated`; migration does not infer eligibility or projector relationships.
- Each mapping records the legacy `host`/`port` as `legacyRuntimeEndpoint` and preserves legacy Profile ID to Configured Model ID translation. Endpoints are not copied into Configured Models or settings.
- Legacy Profile imports still accept raw arrays, wrappers without `exportVersion`, and version 1 wrappers. Explicit unsupported versions are rejected. Export remains version 1.
