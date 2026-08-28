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
7. Review the static router assessment and each required router flag; do not treat this as functional router validation.
8. Select a custom build and confirm unknown/new flags remain visible in **Detected flags**.
9. Confirm Official, Custom, and Unknown origin hints remain conservative and show their evidence.
10. Confirm profile dependencies and the active current-runtime build marker match saved Profiles and `activeProfileId`.
11. Use **Use in Profiles** and confirm a new unsaved draft opens with Build selected and Model empty.
12. Confirm inspection did not start a listener, load a model, run bench/perplexity, or materially change GPU VRAM.
13. Do not claim router startup, `/health`, or `/models` validation; those remain Phase 15 work.
