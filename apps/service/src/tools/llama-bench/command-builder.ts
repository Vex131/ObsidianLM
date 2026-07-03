import type { LlamaBenchArgs, LlamaBenchRequest } from "@obsidianlm/shared";

export interface LlamaBenchCommandSpec {
  executable: string;
  args: string[];
  cwd: string | null;
}

type NumericOption = {
  key: keyof LlamaBenchArgs;
  flag: string;
  min: number;
};

const numericOptions: NumericOption[] = [
  { key: "threads", flag: "--threads", min: 1 },
  { key: "batchSize", flag: "--batch-size", min: 1 },
  { key: "ubatchSize", flag: "--ubatch-size", min: 1 },
  { key: "nGpuLayers", flag: "--n-gpu-layers", min: 0 },
  { key: "promptTokens", flag: "--n-prompt", min: 1 },
  { key: "generationTokens", flag: "--n-gen", min: 1 },
  { key: "repetitions", flag: "--repetitions", min: 1 }
];

const ignoredNumericOptions: Array<{ key: keyof LlamaBenchArgs; min: number }> = [{ key: "ctxSize", min: 1 }];
const allowedRequestKeys = new Set([
  "buildId",
  "benchPath",
  "modelPath",
  "args",
  "threads",
  "ctxSize",
  "batchSize",
  "ubatchSize",
  "nGpuLayers",
  "gpuLayers",
  "promptTokens",
  "generationTokens",
  "genTokens",
  "repetitions"
]);
const allowedArgKeys = new Set(["threads", "ctxSize", "batchSize", "ubatchSize", "nGpuLayers", "promptTokens", "generationTokens", "repetitions"]);

function getBenchArgs(request: LlamaBenchRequest): LlamaBenchArgs {
  return {
    threads: request.args?.threads ?? request.threads,
    ctxSize: request.args?.ctxSize ?? request.ctxSize,
    batchSize: request.args?.batchSize ?? request.batchSize,
    ubatchSize: request.args?.ubatchSize ?? request.ubatchSize,
    nGpuLayers: request.args?.nGpuLayers ?? request.nGpuLayers ?? request.gpuLayers,
    promptTokens: request.args?.promptTokens ?? request.promptTokens,
    generationTokens: request.args?.generationTokens ?? request.generationTokens ?? request.genTokens,
    repetitions: request.args?.repetitions ?? request.repetitions
  };
}

export function buildLlamaBenchCommand(request: LlamaBenchRequest, benchPath: string, modelPath: string): LlamaBenchCommandSpec {
  const args = ["--model", modelPath];
  const benchArgs = getBenchArgs(request);

  for (const option of numericOptions) {
    const value = benchArgs[option.key];
    if (typeof value === "number" && Number.isInteger(value) && value >= option.min) {
      args.push(option.flag, String(value));
    }
  }

  return {
    executable: benchPath,
    args,
    cwd: null
  };
}

export function validateLlamaBenchRequestShape(request: LlamaBenchRequest): string[] {
  const errors: string[] = [];
  const rawRequest = request as Record<string, unknown>;
  const rawArgs = rawRequest.args && typeof rawRequest.args === "object" ? rawRequest.args as Record<string, unknown> : null;
  for (const key of Object.keys(rawRequest)) {
    if (!allowedRequestKeys.has(key)) {
      errors.push(`${key} is not supported by llama-bench requests.`);
    }
  }
  if (rawArgs) {
    for (const key of Object.keys(rawArgs)) {
      if (!allowedArgKeys.has(key)) {
        errors.push(`args.${key} is not supported by llama-bench requests.`);
      }
    }
  }
  if (rawRequest.threadsBatch !== undefined || rawArgs?.threadsBatch !== undefined) {
    errors.push("threadsBatch is not supported by llama-bench and will not be executed; remove it from the request.");
  }
  const benchArgs = getBenchArgs(request);
  for (const option of [...numericOptions, ...ignoredNumericOptions]) {
    const value = benchArgs[option.key];
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value < option.min) {
      errors.push(`${String(option.key)} must be an integer greater than or equal to ${option.min}.`);
    }
  }
  return errors;
}
