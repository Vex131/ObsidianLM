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
