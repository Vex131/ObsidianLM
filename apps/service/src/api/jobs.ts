import type { FastifyInstance } from "fastify";
import path from "node:path";
import type { DiscoveredLlamaCppBuild, DiscoveredLlamaCppTool, DiscoveredModel, JobActionResponse, JobDetailResponse, JobListResponse, JobLogsResponse, LlamaBenchRequest } from "@obsidianlm/shared";
import { JobManager, redactLocalPaths, sanitizeJobForApi } from "../jobs/manager.js";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { discoverModels } from "../discovery/models.js";
import { buildLlamaBenchCommand, validateLlamaBenchRequestShape } from "../tools/llama-bench/command-builder.js";
import { parseLlamaBenchOutput } from "../tools/llama-bench/result-parser.js";

function normalizePathForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function findBenchTool(request: LlamaBenchRequest, builds: DiscoveredLlamaCppBuild[]): { tool: DiscoveredLlamaCppTool; build: DiscoveredLlamaCppBuild } | { error: string; statusCode: number } {
  const candidates = builds.flatMap((build) => build.tools.filter((tool) => tool.kind === "bench" && tool.exists).map((tool) => ({ build, tool })));
  if (!candidates.length) {
    return { error: "no_discovered_llama_bench", statusCode: 409 };
  }

  const requestedBenchPath = typeof request.benchPath === "string" && request.benchPath.trim() ? normalizePathForCompare(request.benchPath) : null;
  const requestedBuildId = typeof request.buildId === "string" && request.buildId.trim() ? request.buildId : null;
  const matches = candidates.filter(({ build, tool }) => {
    if (requestedBuildId && build.id !== requestedBuildId) {
      return false;
    }
    if (requestedBenchPath && normalizePathForCompare(tool.path) !== requestedBenchPath) {
      return false;
    }
    return true;
  });

  if (!requestedBenchPath && !requestedBuildId) {
    return { error: "llama_bench_selection_required", statusCode: 400 };
  }
  if (!matches.length) {
    return { error: "llama_bench_not_discovered", statusCode: 400 };
  }

  return matches[0];
}

function findModel(request: LlamaBenchRequest, models: DiscoveredModel[]): DiscoveredModel | { error: string; statusCode: number } {
  if (!models.length) {
    return { error: "no_discovered_gguf_model", statusCode: 409 };
  }
  if (typeof request.modelPath !== "string" || !request.modelPath.trim()) {
    return { error: "model_selection_required", statusCode: 400 };
  }

  const requestedModelPath = normalizePathForCompare(request.modelPath);
  const model = models.find((candidate) => normalizePathForCompare(candidate.path) === requestedModelPath && candidate.extension.toLowerCase() === ".gguf");
  return model ?? { error: "model_not_discovered", statusCode: 400 };
}

function errorMessageForCode(code: string): string {
  switch (code) {
    case "no_discovered_llama_bench":
      return "No configured discovered llama-bench tool is available. Configure llama.cpp folders and rescan before starting a bench job.";
    case "llama_bench_selection_required":
      return "A discovered llama-bench buildId or benchPath selection is required.";
    case "llama_bench_not_discovered":
      return "The requested llama-bench executable is not one of the configured discovered build tools.";
    case "no_discovered_gguf_model":
      return "No configured discovered GGUF model is available. Configure model folders and rescan before starting a bench job.";
    case "model_selection_required":
      return "A discovered GGUF modelPath selection is required.";
    case "model_not_discovered":
      return "The requested modelPath is not one of the configured discovered GGUF models.";
    default:
      return "The llama-bench job request is invalid.";
  }
}

export async function registerJobRoutes(app: FastifyInstance, jobManager: JobManager): Promise<void> {
  app.get("/api/jobs", async (): Promise<JobListResponse> => ({
    jobs: jobManager.listJobs().map(sanitizeJobForApi)
  }));

  app.get<{ Params: { id: string } }>("/api/jobs/:id", async (request, reply): Promise<JobDetailResponse | void> => {
    const job = jobManager.getJob(request.params.id);
    if (!job) {
      reply.status(404).send({ error: "job_not_found", message: "Job not found." });
      return;
    }
    return { job: sanitizeJobForApi(job) };
  });

  app.post("/api/jobs/test", async (request, reply): Promise<JobActionResponse> => {
    const result = await jobManager.startJob({
      type: "test",
      executable: process.execPath,
      args: ["-e", "console.log('ObsidianLM test job started'); setTimeout(() => console.log('ObsidianLM test job completed'), 25);"]
    });
    if (!result.ok) {
      reply.status(409);
    }
    return { ...result, job: result.job ? sanitizeJobForApi(result.job) : null };
  });

  app.post<{ Body: LlamaBenchRequest }>("/api/jobs/llama-bench", async (request, reply): Promise<JobActionResponse> => {
    const body: LlamaBenchRequest = request.body && typeof request.body === "object" ? request.body : {};
    const shapeErrors = validateLlamaBenchRequestShape(body);
    if (shapeErrors.length) {
      reply.status(400);
      return { ok: false, error: "invalid_llama_bench_request", message: shapeErrors.join(" "), job: null };
    }

    const [buildDiscovery, modelDiscovery] = await Promise.all([discoverLlamaBuilds(), discoverModels()]);
    const bench = findBenchTool(body, buildDiscovery.builds);
    if ("error" in bench) {
      reply.status(bench.statusCode);
      return { ok: false, error: bench.error, message: errorMessageForCode(bench.error), job: null };
    }

    const model = findModel(body, modelDiscovery.models);
    if ("error" in model) {
      reply.status(model.statusCode);
      return { ok: false, error: model.error, message: errorMessageForCode(model.error), job: null };
    }

    const command = buildLlamaBenchCommand(body, bench.tool.path, model.path);
    const result = await jobManager.startJob({
      type: "llama-bench",
      executable: command.executable,
      args: command.args,
      cwd: command.cwd,
      resultParser: parseLlamaBenchOutput
    });
    if (!result.ok) {
      reply.status(409);
    }
    return { ...result, job: result.job ? sanitizeJobForApi(result.job) : null };
  });

  app.post<{ Params: { id: string } }>("/api/jobs/:id/cancel", async (request, reply): Promise<JobActionResponse> => {
    const result = await jobManager.cancelJob(request.params.id);
    if (!result.ok) {
      reply.status(result.job ? 409 : 404);
    }
    return { ...result, job: result.job ? sanitizeJobForApi(result.job) : null };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>("/api/jobs/:id/logs", async (request, reply): Promise<JobLogsResponse | void> => {
    const job = jobManager.getJob(request.params.id);
    if (!job) {
      reply.status(404).send({ error: "job_not_found", message: "Job not found." });
      return;
    }
    const limit = request.query.limit ? Math.max(1, Math.min(500, Number(request.query.limit))) : 100;
    const logs = (await jobManager.getLogs(job.id, Number.isFinite(limit) ? limit : 100)).map(redactLocalPaths);
    return { job: sanitizeJobForApi(jobManager.getJob(job.id) ?? job), logs };
  });
}
