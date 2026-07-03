export type StartupMode = "service_only";

export type StaleProcessPolicy = "auto_stop_previous_managed_only";

export interface AppSettings {
  uiPort: number;
  managedLlamaPort: number;
  startupMode: StartupMode;
  staleProcessPolicy: StaleProcessPolicy;
  modelFolders: string[];
  llamaCppFolders: string[];
  toolInputFolders: string[];
  adminTokenHash: string | null;
}
