# Local Real-Machine Validation

## Models Page

1. Configure one or more model folders without recording machine-specific paths in committed files.
2. Open **Models**, rescan, and confirm GGUF artifacts from nested folders appear.
3. Confirm quantization variants remain separate physical artifact rows.
4. Select a known model and compare its name, architecture, context, layer, and expert metadata with the source model.
5. Select a known `mmproj` GGUF and confirm it appears as a Projector rather than a primary Model.
6. Confirm any related projector/model result is labeled as a candidate, not a validated association.
7. Confirm Profile usage matches saved Profiles and the active marker only follows the current runtime's `activeProfileId`.
8. Choose **Configure in Profiles** and confirm a new unsaved draft opens with the model selected and Build empty.
9. Confirm no Profile is created until **Save profile** is used.
10. Confirm inspection does not start `llama-server` or `llama-cli`, load the model, reserve VRAM, change GPU usage, or modify the GGUF file.

## Builds Page

1. Configure the real llama.cpp build root without recording machine-specific paths in committed files.
2. Open **Builds**, rescan, and confirm a root-level or packaged official build appears.
3. Confirm a deeply nested custom `build/bin/Release` toolchain appears with a useful build name rather than `Release`.
4. Select the current official build and inspect its version, help-derived flags, and `--list-devices` output.
5. Compare detected server, CLI, bench, and perplexity paths with the files on disk.
6. Confirm accelerator/backend labels reflect executable output rather than folder naming.
7. Review the static router assessment and each required router flag; functional Build validation is separate and required before managed launch.
8. Select a custom build and confirm unknown/new flags remain visible in **Detected flags**.
9. Confirm Official, Custom, and Unknown origin hints remain conservative and show their evidence.
10. Confirm configured-model dependencies and the active Build marker match the authoritative domain; any Profile marker is legacy compatibility projection only.
11. Use **Use in Profiles** and confirm a new unsaved draft opens with Build selected and Model empty.
12. Confirm inspection did not start a listener, load a model, run bench/perplexity, or materially change GPU VRAM.
13. For an eligible Build, start through the managed Runtime controls and record the exact Run 5 argv: resolved/available server executable, `--host 0.0.0.0`, managed `--port`, generated `--models-preset`, `--models-max 1`, and the positive autoload flag proven by Build help. Confirm no `--model` or `--models-dir` is passed.
14. Confirm the router uses the controlled per-Build cache/environment, preflights the managed port, and never kills or adopts an external/unknown owner.
15. Confirm startup requires healthy `/health` and strict `/models` reconciliation; initial external or unknown catalog entries block startup.
16. Confirm `router-runtime-state.json` is current lifecycle authority and `runtime-state.json` remains preserved legacy evidence. Profile start is a temporary Build-selection hint and loads no model; restart reuses the same Build.
17. Do not claim same-build model switching or cross-Build/model switching (Run 7), GPU child/log attribution (Run 8), or Phase 15 completion.

## Jobs Page

1. Select a discovered `llama-bench` tool and primary GGUF model, run a small bounded benchmark, and compare the parsed rows with the persisted job log.
2. Select a discovered `llama-perplexity` tool, primary model, and configured input file; confirm final PPL, uncertainty, warnings, and logs match the tool output.
3. Cancel only the current managed one-shot job where safe and confirm no unrelated process is stopped.
4. Confirm projector, adapter, importance-matrix, and other confidently non-model GGUF artifacts cannot be selected as primary models.

## Logs Page

1. Start a managed runtime and confirm historical stdout, stderr, and system entries appear.
2. Interrupt and restore the browser connection; confirm SSE reconnects without an Authorization header or duplicate unbounded history.
3. In Windows service mode, confirm bounded wrapper files appear under Service without exposing arbitrary paths.
4. Confirm **Clear visible** only clears the browser buffer and a refresh can restore persisted history.

## Telemetry Page

1. Compare reported GPU devices, utilization, VRAM, temperature, and power with `nvidia-smi` where available.
2. Confirm the managed runtime GPU PID is classified as managed only when its PID matches current owned state.
3. Start a separate llama.cpp process and confirm it remains external/unmanaged with no kill or adopt action.
4. Confirm the managed port observation and owner PID match the current machine state without inferring an unavailable owner.

## Settings Page

1. Update model, llama.cpp build, and tool-input folders; save, then confirm Models, Builds, and Jobs discover the intended machine-local resources.
2. While the managed runtime is stopped, change the managed port to a valid free port and confirm the saved setting and current port observation.
3. While the runtime is active, confirm changing the managed port is blocked and unrelated folder settings remain editable.
4. Confirm Settings is immediately usable and requires no credential or bootstrap step.

## System Page

1. In development and Windows service modes, compare running/service mode, UI port, managed port, and project/ProgramData storage modes with the actual deployment.
2. Refresh readiness and confirm blocking checks, warnings, counts, and next actions match the configured real resources.
3. Copy diagnostics and confirm no admin token, token hash, authorization header, or unnecessary private path is included.
