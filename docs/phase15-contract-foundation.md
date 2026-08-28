# Phase 15 Contract Foundation

Builder Runs 1-3 add the versioned domain contract, storage, legacy Profile migration, and persistent model/build foundations. Run 3 implements the foundation only: it does not generate presets, launch a router, or change `RuntimeManager`.

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
- Legacy Profile IDs and `host`/`port` are retained. `RuntimeManager` remains model-bound and `activeProfileId` is unchanged.

## Identity

Artifact, Configured Model, Build, router alias, and runtime IDs are distinct types. New persisted identities are opaque generated IDs; deterministic seeds are supported for repeatable legacy migration. A stored ID does not change when a display name or resource locator changes. Legacy migration may deduplicate artifact/build records by its normalized source reference, but each legacy Profile receives its own Configured Model ID, so duplicate GGUF configurations and duplicate names remain distinct.

Router aliases use the conservative lowercase subset `[a-z0-9._-]`, begin and end with alphanumeric characters, and are at most 64 characters. Initial aliases derive deterministically from display text. A deterministic Configured Model ID suffix resolves collisions. The resulting alias is stored and does not track later display-name changes. This subset is intentionally narrower than potentially build-specific upstream behavior until functional validation proves otherwise.

Resource references include an owner scope. Run 1 uses local ownership but permits a future Node identity without changing artifact, build, configuration, or generated-artifact identity. It does not implement Phase 16 APIs or remote behavior.

## Persistent artifacts and builds

- Persistent Model Artifacts and stable Builds are distinct from Phase 14 discovery results. Registration/reconciliation is explicit; IDs remain stable, dependent deletion is protected, and discovery candidates are never auto-selected.
- Configured Model CRUD, duplication, and revalidation are explicit operations. Projector associations are explicit and projected separately; candidates are never paired or selected automatically.

## Build eligibility

Static Phase 14 evidence and bounded functional router evidence are separate contracts. Classification or visible CLI flags never establish eligibility. Normal managed inference requires successful functional evidence for preset acceptance, `/health`, `/models`, and required router behavior. Run 3 leaves eligibility `not_validated`; a failed build remains visible and may support independent Jobs, but is ineligible for normal managed inference. There is no automatic model-bound fallback.

## Router boundaries

Run 3 adds no router probes, lifecycle management, generated presets, or UI. The foundation route families are `/api/model-artifacts`, `/api/configured-models`, and `/api/builds`; discovery endpoints remain evidence-producing and non-authoritative.

- `GET /health` supplies bounded router/server health evidence.
- `GET /models` supplies the router catalog and model load state.
- `/v1/*` remains inference compatibility and bounded diagnostic inference, not the router control-plane catalog.

Catalog entries are discriminated by ownership. A managed entry requires an explicitly reconciled Configured Model ID. External or unknown entries cannot carry one; path equality is not proof of management. Normal initial residency policy is represented as `models-max = 1` with autoload enabled, without launch implementation.

Router launch previews and generated model-preset previews are separate contracts. Router runtime state is also separate from the current Profile-era `RuntimeState`; current `activeProfileId` and model-bound `RuntimeManager` behavior remain unchanged. Profile APIs now project/translate through the domain after cutover.

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
