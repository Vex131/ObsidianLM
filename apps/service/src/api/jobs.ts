import type { FastifyInstance } from "fastify";
import type { JobActionResponse, JobDetailResponse, JobListResponse, JobLogsResponse } from "@obsidianlm/shared";
import { JobManager, redactLocalPaths, sanitizeJobForApi } from "../jobs/manager.js";

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
