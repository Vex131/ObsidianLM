import type { LlamaPerplexityArgs, LlamaPerplexityRequest } from "@obsidianlm/shared";

export interface LlamaPerplexityCommandSpec {
  executable: string;
  args: string[];
  cwd: string | null;
}

type NumericOption = {
  key: keyof LlamaPerplexityArgs;
  flag: string;
  min: number;
};

const numericOptions: NumericOption[] = [
  { key: "threads", flag: "--threads", min: 1 },
  { key: "ctxSize", flag: "--ctx-size", min: 1 },
  { key: "batchSize", flag: "--batch-size", min: 1 },
  { key: "ubatchSize", flag: "--ubatch-size", min: 1 },
  { key: "nGpuLayers", flag: "--n-gpu-layers", min: 0 }
];

const allowedRequestKeys = new Set(["buildId", "perplexityPath", "modelPath", "datasetPath", "args", "threads", "ctxSize", "batchSize", "ubatchSize", "nGpuLayers"]);
const allowedArgKeys = new Set(["threads", "ctxSize", "batchSize", "ubatchSize", "nGpuLayers"]);

function getPerplexityArgs(request: LlamaPerplexityRequest): LlamaPerplexityArgs {
  return {
    threads: request.args?.threads ?? request.threads,
    ctxSize: request.args?.ctxSize ?? request.ctxSize,
    batchSize: request.args?.batchSize ?? request.batchSize,
    ubatchSize: request.args?.ubatchSize ?? request.ubatchSize,
    nGpuLayers: request.args?.nGpuLayers ?? request.nGpuLayers
  };
}

export function buildLlamaPerplexityCommand(request: LlamaPerplexityRequest, perplexityPath: string, modelPath: string, datasetPath: string): LlamaPerplexityCommandSpec {
  const args = ["-m", modelPath, "-f", datasetPath];
  const perplexityArgs = getPerplexityArgs(request);

  for (const option of numericOptions) {
    const value = perplexityArgs[option.key];
    if (typeof value === "number" && Number.isInteger(value) && value >= option.min) {
      args.push(option.flag, String(value));
    }
  }

  return { executable: perplexityPath, args, cwd: null };
}

export function validateLlamaPerplexityRequestShape(request: LlamaPerplexityRequest): string[] {
  const errors: string[] = [];
  const rawRequest = request as Record<string, unknown>;
  const rawArgs = rawRequest.args && typeof rawRequest.args === "object" ? rawRequest.args as Record<string, unknown> : null;

  for (const key of Object.keys(rawRequest)) {
    if (!allowedRequestKeys.has(key)) {
      errors.push(`${key} is not supported by llama-perplexity requests.`);
    }
  }
  if (rawArgs) {
    for (const key of Object.keys(rawArgs)) {
      if (!allowedArgKeys.has(key)) {
        errors.push(`args.${key} is not supported by llama-perplexity requests.`);
      }
    }
  }

  for (const option of numericOptions) {
    const value = getPerplexityArgs(request)[option.key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < option.min) {
      errors.push(`${String(option.key)} must be an integer greater than or equal to ${option.min}.`);
    }
  }

  return errors;
}
