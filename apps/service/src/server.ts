import { existsSync } from "node:fs";
import fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { registerStatusRoutes } from "./api/status.js";
import { registerProfileRoutes } from "./api/profiles.js";
import { registerRuntimeRoutes } from "./api/runtime.js";
import { ensureStorageFiles } from "./config/storage.js";
import { webDistDir } from "./config/paths.js";
import { RuntimeManager } from "./runtime/manager.js";

export async function createServer(): Promise<FastifyInstance> {
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

  await ensureStorageFiles();
  const runtimeManager = new RuntimeManager();
  await runtimeManager.initialize();
  app.addHook("onClose", async () => {
    await runtimeManager.shutdown();
  });

  await registerStatusRoutes(app, runtimeManager);
  await registerProfileRoutes(app, runtimeManager);
  await registerRuntimeRoutes(app, runtimeManager);

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
