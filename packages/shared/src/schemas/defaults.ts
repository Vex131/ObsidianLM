import { DEFAULT_LLAMA_CPP_PORT, DEFAULT_OBSIDIANLM_PORT } from "../constants/ports.js";
import type { AppSettings } from "../types/settings.js";
import type { RuntimeState } from "../types/runtime-state.js";

export const defaultSettings: AppSettings = {
  uiPort: DEFAULT_OBSIDIANLM_PORT,
  managedLlamaPort: DEFAULT_LLAMA_CPP_PORT,
  startupMode: "service_only",
  staleProcessPolicy: "auto_stop_previous_managed_only",
  modelFolders: [],
  llamaCppFolders: []
};

export const defaultRuntimeState: RuntimeState = {
  activeRuntimeId: null,
  activeProfileId: null,
  pid: null,
  port: null,
  startedByObsidianLM: false,
  startedAt: null,
  commandHash: null,
  status: "stopped"
};
