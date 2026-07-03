export type JobType = "test" | "generic" | "llama-bench" | "llama-perplexity";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface JobRecord {
  id: string;
  type: JobType;
  status: JobStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  command: string;
  executable: string;
  args: string[];
  cwd: string | null;
  exitCode: number | null;
  signal: string | null;
  logPath: string | null;
  resultPath: string | null;
  result?: JobResult | null;
  errorMessage: string | null;
}

export type JobResult = LlamaBenchJobResult | LlamaPerplexityJobResult;

export interface LlamaBenchRequest {
  buildId?: string;
  benchPath?: string;
  modelPath?: string;
  args?: LlamaBenchArgs;

  /** @deprecated Prefer args.threads. */
  threads?: number;
  /** llama-bench does not support ctx-size directly; accepted for UI/profile compatibility but ignored by the command builder. Prefer omitting it. */
  ctxSize?: number;
  /** @deprecated Prefer args.batchSize. */
  batchSize?: number;
  /** @deprecated Prefer args.ubatchSize. */
  ubatchSize?: number;
  /** @deprecated Prefer args.nGpuLayers. */
  nGpuLayers?: number;
  /** @deprecated Prefer args.nGpuLayers. */
  gpuLayers?: number;
  /** @deprecated Prefer args.promptTokens. */
  promptTokens?: number;
  /** @deprecated Prefer args.generationTokens. */
  generationTokens?: number;
  /** @deprecated Prefer args.generationTokens. */
  genTokens?: number;
  /** @deprecated Prefer args.repetitions. */
  repetitions?: number;
}

export interface LlamaBenchArgs {
  threads?: number;
  /** llama-bench does not support ctx-size directly; accepted for UI/profile compatibility but ignored by the command builder. */
  ctxSize?: number;
  batchSize?: number;
  ubatchSize?: number;
  nGpuLayers?: number;
  promptTokens?: number;
  generationTokens?: number;
  repetitions?: number;
}

export interface LlamaBenchResultRow {
  test: string;
  model?: string;
  size?: string;
  params?: string;
  backend?: string;
  threads?: string;
  cpuMask?: string;
  gpuLayers?: string;
  nBatch?: string;
  nUbatch?: string;
  nPrompt?: string;
  nGen?: string;
  testTime?: string;
  tokensPerSecond?: number;
  raw: Record<string, string>;
}

export interface LlamaBenchJobResult {
  type: "llama-bench";
  parsed: boolean;
  rows: LlamaBenchResultRow[];
  warnings: string[];
}

export interface LlamaPerplexityRequest {
  buildId?: string;
  perplexityPath?: string;
  modelPath?: string;
  datasetPath?: string;
  args?: LlamaPerplexityArgs;
  threads?: number;
  ctxSize?: number;
  batchSize?: number;
  ubatchSize?: number;
  nGpuLayers?: number;
}

export interface LlamaPerplexityArgs {
  threads?: number;
  ctxSize?: number;
  batchSize?: number;
  ubatchSize?: number;
  nGpuLayers?: number;
}

export interface LlamaPerplexityEstimate {
  index: number;
  ppl: number;
}

export interface LlamaPerplexityJobResult {
  type: "llama-perplexity";
  parsed: boolean;
  finalPpl: number | null;
  uncertainty: number | null;
  estimates: LlamaPerplexityEstimate[];
  estimateCount: number;
  warnings: string[];
}

export interface JobListResponse {
  jobs: JobRecord[];
}

export interface JobDetailResponse {
  job: JobRecord;
}

export interface JobLogsResponse {
  job: JobRecord;
  logs: string[];
}

export interface JobActionResponse {
  ok: boolean;
  message: string;
  job: JobRecord | null;
  error?: string;
}
