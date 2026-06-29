export interface StatusResponse {
  service: "running";
  app: "ObsidianLM";
  version: string;
  uiPort: number;
  managedLlamaPort: number;
  activeRuntime: null;
  warnings: string[];
}
