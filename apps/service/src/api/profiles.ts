import type { FastifyInstance } from "fastify";
import { buildLlamaCppServerCommand } from "../runtime/command.js";
import { getProfile, isLlamaCppServerProfile, listProfiles, validateProfile } from "../runtime/profiles.js";
import type { RuntimeManager } from "../runtime/manager.js";

export async function registerProfileRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/profiles", async () => ({ profiles: await listProfiles() }));

  app.get<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const profile = await getProfile(request.params.id);
    if (!profile) {
      return reply.status(404).send({ error: "not_found", message: "Profile not found." });
    }

    return { profile };
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/validate", async (request, reply) => {
    const profile = await getProfile(request.params.id);
    if (!profile) {
      return reply.status(404).send({ valid: false, errors: ["Profile not found."], warnings: [] });
    }

    return validateProfile(profile);
  });

  app.get<{ Params: { id: string } }>("/api/profiles/:id/command", async (request, reply) => {
    const profile = await getProfile(request.params.id);
    if (!profile) {
      return reply.status(404).send({ error: "not_found", message: "Profile not found." });
    }

    if (!isLlamaCppServerProfile(profile)) {
      return reply.status(400).send({ error: "unsupported_profile", message: "Phase 1 only supports llama.cpp server profiles." });
    }

    return { command: buildLlamaCppServerCommand(profile) };
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/start", async (request, reply) => {
    const result = await runtimeManager.start(request.params.id);
    return reply.status(result.ok ? 200 : result.error === "port_conflict" ? 409 : 400).send(result);
  });
}
