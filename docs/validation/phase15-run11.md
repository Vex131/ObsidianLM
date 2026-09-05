# Phase 15 Run 11 — Real-Machine Certification

Run 11 validates Build/router lifecycle, model and Build switching, process/GPU/log awareness, and deployment behavior on real hardware. Automated tests cover contracts; this checklist covers what only real machines can prove.

**Run 11 status (2026-09-05, ID-reconciled 2026-09-05):** Track 0 green. Track A complete with A13 Defer, A7 N/A, A15 Skip. Track B remapped from personal evidence (`notes/run11-evidence.md`, gitignored): B1/B2/B4/B7/B9 Pass; **B5 Partial** (small-model `models-max=1` only — full VRAM pressure not exercised); **B6 N/A** (no mmproj); **B8 N/A** (SSH tunnel not exercised; Tailscale B7 certified instead); **B10 Skip** (WinSW absent); **B3 and B11 not recorded under correct matrix IDs** — do not treat as Pass. Personal evidence originally used shifted B-check numbers; this summary uses the matrix definitions below.

For page-level smoke without re-running full certification, see [local-real-smoke.md](./local-real-smoke.md).

## Machine roles

| Role | Typical hardware | ObsidianLM runs |
|------|------------------|-----------------|
| **Laptop (Track A)** | CPU llama.cpp, no NVIDIA | Locally on laptop |
| **Home PC (Track B)** | GPU llama.cpp, NVIDIA | Locally on home PC |
| **Laptop operator (Track B remote)** | SSH + Tailscale to home PC | Browser/curl via tunnel or Tailscale only |

Track B remote access uses SSH port forwarding or Tailscale for admin/certification. It is **not** Phase 16 Controller/Node management.

## Local setup example (do not commit machine paths)

Example laptop layout:

- Models: `D:\Models\unsloth\` (e.g. Qwen3-1.7B, Qwen2.5-Coder-3B GGUF trees)
- Build: `D:\llama.cpp-builds\llama-b9859-bin-win-cpu-x64\llama-server.exe`
- Ports: UI/API `8090`, managed llama.cpp `8085`

Configure via uncommitted `data/settings.json` from [settings.example.json](../../data/settings.example.json).

## Evidence log

Maintain a personal log (e.g. `notes/run11-evidence.md`, gitignored) with:

`Check ID | Machine | Date | Pass/Fail/Defer/N/A | Notes | Ref`

## Track 0 — Automated baseline

| ID | Check | Laptop | Home | Pass signal |
|----|-------|--------|------|-------------|
| T0-1 | `npm run typecheck` | Run | Run | Exit 0 |
| T0-2 | `npm run lint` | Run | Run | Exit 0 |
| T0-3 | `npm run test` | Run | Run | Exit 0 |
| T0-4 | `npm run test:e2e` | Run | Run | Exit 0 |

## Track A — Laptop CPU subset

| ID | Check | Machine | Defer | Pass signal |
|----|-------|---------|-------|-------------|
| A1 | Discovery folders + rescan | Laptop | | Models and Builds cataloged; readiness clear except optional “no router” |
| A2 | Build router validation | Laptop | | `POST /api/builds/:id/validate-router` → eligible |
| A3 | Preset + launch contract | Laptop | | Generated INI has all enabled models; argv has preset, `--models-max 1`, autoload flag; no `--model`/`--models-dir` |
| A4 | Router start/stop/restart | Laptop | | `router-runtime-state.json` authoritative; `/health` healthy when running |
| A5 | Runtime health + test chat | Laptop | | `GET /api/runtime/health`, `POST /api/runtime/test-chat` succeed |
| A6 | Same-build switch-model | Laptop | | Same PID/runtime ID; target loaded in `/models` |
| A7 | Profile compatibility start/switch | Laptop | | Profile start loads model; same-build profile switches in place |
| A8 | Port conflict | Laptop | | Start blocked; no kill of external owner |
| A9 | Unmanaged process warning | Laptop | | Manual `llama-server` classified unmanaged |
| A10 | Jobs independence | Laptop | | Bench/perplexity jobs do not start router |
| A11 | Logs SSE + origin metadata | Laptop | | Reconnect without Authorization; router/child prefixes when loaded |
| A12 | Dashboard ↔ Runtime parity | Laptop | | Active build/model summary matches Runtime |
| A13 | GPU telemetry | Laptop | **Defer → B4** | `nvidia_smi_missing` or empty — not a laptop failure |
| A14 | Direct `/v1` client | Laptop | | `curl localhost:8085/v1/models` and chat completion work |
| A15 | Windows service smoke | Laptop | Skip if no WinSW | Service labels in `/api/status`; start/stop/restart |

## Track B — Home PC (GPU + deployment)

Run ObsidianLM **on the home PC**. Operate UI from laptop via Tailscale (`http://<tailscale-ip>:8090`) or SSH tunnel (`localhost:18090` / `18085`).

### B0 — SSH pre-flight inventory

Before home setup, inventory via SSH (read-only):

- `D:\Models`, `E:\Models` GGUF paths
- `llama-server.exe` build paths
- `nvidia-smi` output
- ObsidianLM service status and `GET /api/status` on home PC

### B-Remote — SSH tunnel (optional)

```bat
ssh -N -o BatchMode=yes -o IdentitiesOnly=yes -o ServerAliveInterval=30 ^
  -L 18090:127.0.0.1:8090 -L 18085:127.0.0.1:8085 ^
  -i "%USERPROFILE%\.ssh\familypc_llama_ed25519" ahmed@100.84.76.75
```

| ID | Check | Machine | Defer | Pass signal |
|----|-------|---------|-------|-------------|
| B1 | Multi-build catalog + GPU validation | Home | | Two builds cataloged; GPU build router-eligible |
| B2 | Cross-build switch | Home | | New PID after source stop + port release |
| B3 | Duplicated GGUF configs | Home | | Same artifact, distinct configured models/builds |
| B4 | GPU telemetry attribution | Home | | Matches `nvidia-smi`; proven router + child VRAM |
| B5 | VRAM pressure + models-max=1 | Home | | Eviction/autoload under realistic GPU load |
| B6 | Multimodal + text-only | Home | **N/A if no mmproj** | Preset emits mmproj; router loads vision model |
| B7 | Tailscale client path | Home | | UI `:8090` and data plane `:8085/v1` over Tailscale |
| B8 | SSH tunnel path | Home | | UI `localhost:18090`, inference `localhost:18085/v1` |
| B9 | Ineligible build | Home | | Cataloged but managed start refused |
| B10 | Service recovery | Home | | Failed start recoverable; reboot auto-start if applicable |
| B11 | External catalog boundary | Home | | Cache/env models do not become managed silently |

### Evidence ID reconciliation

Personal evidence originally labeled some Track B rows with shifted IDs. Content remapped to this matrix:

| Evidence label (personal log) | Actual matrix ID | Recorded result |
|-------------------------------|------------------|-----------------|
| B3 (models-max=1 / small models) | **B5** | Partial |
| B5 (no mmproj) | **B6** | N/A |
| B6 (Tailscale UI/v1) | **B7** | Pass |
| B7 (ineligible build refused) | **B9** | Pass |
| B8 (WinSW absent) | **B10** | Skip |
| — | **B3** | Not recorded under correct ID |
| — | **B8** | Not exercised (Tailscale used); treated as N/A |
| — | **B11** | Not recorded under correct ID |

Do not upgrade Partial/N/A/Skip/unrecorded checks to Pass.

## Closure gate

Phase 15 **implementation** (Builder Runs 1–10) is complete independently of Run 11.

Phase 15 **Run 11 certification** is complete when:

1. Track 0 green
2. Track A: all checks Pass (A13 = Defer, not Fail; A7 may be N/A; A15 may be Skip if WinSW absent)
3. Track B: each check is Pass, documented N/A, documented Skip (service/WinSW), or a specifically documented non-blocking exception
4. Personal evidence log complete (gitignored is fine)
5. Status docs updated: README, [ObsidianLM_Project_Plan.md](../ObsidianLM_Project_Plan.md) §17, [phase15-contract-foundation.md](../phase15-contract-foundation.md)

**Non-blocking exception (B5):** Partial is accepted for B5 when `models-max=1` same-build unload/switch is observed on small models but realistic multi-GB VRAM pressure is not exercised. This does **not** authorize renaming Partial to Pass.

**Current certification outcome:** Track 0 + Track A satisfy the gate. Track B does **not** yet satisfy a full Pass/N/A/Skip matrix because **B3** and **B11** lack evidence under correct IDs. Documented residuals that are allowed by policy: B5 Partial (exception above), B6 N/A, B8 N/A, B10 Skip. Therefore **Run 11 full certification remains incomplete**; Phase 15 product foundation remains complete through Run 10 with Run 11 partially evidenced.

Do **not** mark full Run 11 certification complete from unit/e2e tests alone, and do **not** mark it complete while B3/B11 remain unverified.

## SSH inventory script (personal)

Extend your existing key-based script with builds, GPU, and ObsidianLM status. Store connection details outside the repo.
