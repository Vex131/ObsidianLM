import { existsSync } from "node:fs";
import fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { registerStatusRoutes } from "./api/status.js";
import { registerProfileRoutes } from "./api/profiles.js";
import { registerRuntimeRoutes } from "./api/runtime.js";
import { registerDiscoveryRoutes } from "./api/discovery.js";
import { registerMonitoringRoutes } from "./api/monitoring.js";
import { registerProcessRoutes } from "./api/processes.js";
import { registerSettingsRoutes } from "./api/settings.js";
import { registerJobRoutes } from "./api/jobs.js";
import { ensureStorageFiles } from "./config/storage.js";
import { ensureAppDirectories, webDistDir } from "./config/paths.js";
import type { GpuMonitorOptions } from "./monitoring/gpu-monitor.js";
import { RuntimeManager } from "./runtime/manager.js";
import { JobManager } from "./jobs/manager.js";

export interface CreateServerOptions {
  gpuMonitorOptions?: GpuMonitorOptions;
}

export async function createServer(options: CreateServerOptions = {}): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info"
    }
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, "request failed");
    reply.status(500).send({
      error: "internal_server_error",
      message: "ObsidianLM service encountered an unexpected error."
    });
  });

  await ensureAppDirectories();
  await ensureStorageFiles();
  const runtimeManager = new RuntimeManager();
  const jobManager = new JobManager();
  await runtimeManager.initialize();
  await jobManager.initialize();
  app.addHook("onClose", async () => {
    await jobManager.shutdown();
    await runtimeManager.shutdown();
  });

  await registerStatusRoutes(app, runtimeManager, options.gpuMonitorOptions);
  await registerSettingsRoutes(app);
  await registerProfileRoutes(app, runtimeManager);
  await registerRuntimeRoutes(app, runtimeManager);
  await registerDiscoveryRoutes(app);
  await registerProcessRoutes(app);
  await registerMonitoringRoutes(app, runtimeManager, options.gpuMonitorOptions);
  await registerJobRoutes(app, jobManager);

  if (existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/"
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.raw.method === "GET" && !request.raw.url?.startsWith("/api/")) {
        return reply.sendFile("index.html");
      }

      return reply.status(404).send({ error: "not_found" });
    });
  }

  return app;
}
