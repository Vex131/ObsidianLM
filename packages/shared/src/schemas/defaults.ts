import { DEFAULT_LLAMA_CPP_PORT, DEFAULT_OBSIDIANLM_PORT } from "../constants/ports.js";
import type { AppSettings } from "../types/settings.js";
import type { ProfileEditorDefaults } from "../types/profile-editor.js";
import type { RuntimeState } from "../types/runtime-state.js";

export const defaultSettings: AppSettings = {
  uiPort: DEFAULT_OBSIDIANLM_PORT,
  managedLlamaPort: DEFAULT_LLAMA_CPP_PORT,
  startupMode: "service_only",
  staleProcessPolicy: "auto_stop_previous_managed_only",
  modelFolders: [],
  llamaCppFolders: [],
  adminTokenHash: null
};

export const defaultRuntimeState: RuntimeState = {
  activeRuntimeId: null,
  activeProfileId: null,
  pid: null,
  port: null,
  startedByObsidianLM: false,
  startedAt: null,
  commandHash: null,
  status: "stopped",
  exitedAt: null,
  exitCode: null,
  signal: null,
  message: null
};

export const defaultProfileEditorDefaults: ProfileEditorDefaults = {
  host: "0.0.0.0",
  port: DEFAULT_LLAMA_CPP_PORT,
  runtimeType: "llama.cpp",
  providerKind: "server",
  llamaArgs: {
    ctxSize: 8192,
    gpuLayers: "all",
    flashAttention: true,
    batchSize: 512,
    ubatchSize: 128,
    parallel: 1,
    threads: 8,
    threadsBatch: 8,
    contBatching: true,
    metrics: true,
    webui: true
  },
  extraArgs: []
};
