export type RuntimeType = "llama.cpp";

export type RuntimeProviderKind = "server";

export type RuntimeStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "exited"
  | "failed"
  | "unknown_previous_runtime";

export interface RuntimeWarning {
  code: string;
  message: string;
}

export interface LlamaCppArgs {
  ctxSize?: number;
  gpuLayers?: number | "all";
  devices?: string[];
  splitMode?: string;
  tensorSplit?: string;
  cacheTypeK?: string;
  cacheTypeV?: string;
  flashAttention?: boolean;
  batchSize?: number;
  ubatchSize?: number;
  parallel?: number;
  threads?: number;
  threadsBatch?: number;
  contBatching?: boolean;
  metrics?: boolean;
  webui?: boolean;
}

export interface LlamaCppProfile {
  id: string;
  name: string;
  runtimeType: "llama.cpp";
  providerKind: "server";
  buildPath: string;
  modelPath: string;
  host: string;
  port: number;
  llamaArgs?: LlamaCppArgs;
  extraArgs?: string[];
}

export type RuntimeProfile = LlamaCppProfile;

export interface CommandSpec {
  executable: string;
  args: string[];
  displayCommand: string;
  commandHash: string;
}

export interface RuntimeLogEntry {
  id: number;
  timestamp: string;
  stream: "stdout" | "stderr" | "system";
  message: string;
}

export interface RuntimeActionResult {
  ok: boolean;
  message: string;
  state: RuntimeState;
  error?: string;
  command?: CommandSpec;
  warnings?: string[];
  errors?: string[];
}

export interface RuntimeState {
  activeRuntimeId: string | null;
  activeProfileId: string | null;
  pid: number | null;
  port: number | null;
  startedByObsidianLM: boolean;
  startedAt: string | null;
  commandHash: string | null;
  status: RuntimeStatus;
  exitedAt?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  message?: string | null;
}
