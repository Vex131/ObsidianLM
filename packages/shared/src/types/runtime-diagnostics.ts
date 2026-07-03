import type { RuntimeStatus } from "./runtime-state.js";

export type RuntimeHealthStatus = "healthy" | "unhealthy" | "not_configured";

export interface RuntimeDiagnosticProfile {
  id: string | null;
  name: string | null;
  host: string | null;
  port: number | null;
  runtimeStatus: RuntimeStatus;
}

export interface RuntimeHealthResponse {
  ok: boolean;
  status: RuntimeHealthStatus;
  checkedAt: string;
  latencyMs: number | null;
  endpoint: string | null;
  profile: RuntimeDiagnosticProfile | null;
  modelsCount?: number;
  error?: string;
  message: string;
}

export interface RuntimeTestChatRequest {
  prompt?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface RuntimeTestChatResponse {
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  endpoint: string | null;
  profile: RuntimeDiagnosticProfile | null;
  promptLength: number;
  maxTokens: number;
  responsePreview: string | null;
  error?: string;
  message: string;
}
