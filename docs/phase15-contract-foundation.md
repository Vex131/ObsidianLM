# Phase 15 Contract Foundation

Builder Run 1 adds versioned, additive shared contracts only. It does not migrate Profile data, generate presets, launch a router, or change `RuntimeManager`.

## Terms and authority

- **Model Artifact** is a discovered or stored physical resource. Discovery does not make it runnable.
- **Configured Model** is the ObsidianLM-authoritative runnable configuration linking one artifact, one llama.cpp build, a stable router alias, settings, and optional explicit projector.
- **llama.cpp Build** is a stable ObsidianLM record distinct from Phase 14's ephemeral discovery result.
- ObsidianLM structured configuration is authoritative. Generated router INI files are versioned, derived, disposable artifacts.

## Identity

Artifact, Configured Model, Build, router alias, and runtime IDs are distinct types. New persisted identities are opaque generated IDs; deterministic seeds are supported for repeatable legacy migration. A stored ID does not change when a display name or resource locator changes. Legacy migration may deduplicate artifact/build records by its normalized source reference, but each legacy Profile receives its own Configured Model ID, so duplicate GGUF configurations and duplicate names remain distinct.

Router aliases use the conservative lowercase subset `[a-z0-9._-]`, begin and end with alphanumeric characters, and are at most 64 characters. Initial aliases derive deterministically from display text. A deterministic Configured Model ID suffix resolves collisions. The resulting alias is stored and does not track later display-name changes. This subset is intentionally narrower than potentially build-specific upstream behavior until functional validation proves otherwise.

Resource references include an owner scope. Run 1 uses local ownership but permits a future Node identity without changing artifact, build, configuration, or generated-artifact identity. It does not implement Phase 16 APIs or remote behavior.

## Build eligibility

Static Phase 14 evidence and bounded functional router evidence are separate contracts. Classification or visible CLI flags never establish eligibility. Normal managed inference requires successful functional evidence for preset acceptance, `/health`, `/models`, and required router behavior. A failed build remains visible and may support independent Jobs, but is ineligible for normal managed inference. There is no automatic model-bound fallback.

## Router boundaries

- `GET /health` supplies bounded router/server health evidence.
- `GET /models` supplies the router catalog and model load state.
- `/v1/*` remains inference compatibility and bounded diagnostic inference, not the router control-plane catalog.

Catalog entries are discriminated by ownership. A managed entry requires an explicitly reconciled Configured Model ID. External or unknown entries cannot carry one; path equality is not proof of management. Normal initial residency policy is represented as `models-max = 1` with autoload enabled, without launch implementation.

Router launch previews and generated model-preset previews are separate contracts. Router runtime state is also separate from the current Profile-era `RuntimeState`; current `activeProfileId`, Profile APIs, imports/exports, discovery creation, previews, storage, and `RuntimeManager` behavior remain unchanged until a later migration/runtime run.

## Migration

Migration contracts record source and target versions, source revision, status, backup evidence, deterministic mappings, invalid references, warnings/errors, and recoverability. Completed-source metadata supports repeat detection; `in_progress` and `interrupted` states support later recovery handling. Missing model, build, or projector references remain explicit invalid records rather than being discarded. Test fixtures use only `/fixtures/...` paths and perform no writes.
