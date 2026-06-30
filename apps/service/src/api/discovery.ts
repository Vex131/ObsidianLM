import type { FastifyInstance } from "fastify";
import type { CreateProfileFromDiscoveryRequest } from "@obsidianlm/shared";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { discoverModels } from "../discovery/models.js";
import { createProfileFromDiscovery, validateCreateProfileRequest } from "../discovery/profile-factory.js";

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/discovery/models", async () => discoverModels());

  app.post("/api/discovery/models/rescan", async () => discoverModels());

  app.get("/api/discovery/llama-builds", async () => discoverLlamaBuilds());

  app.post("/api/discovery/llama-builds/rescan", async () => discoverLlamaBuilds());

  app.post<{ Body: CreateProfileFromDiscoveryRequest }>("/api/discovery/profiles", async (request, reply) => {
    const requestErrors = validateCreateProfileRequest(request.body);
    if (requestErrors.length) {
      return reply.status(400).send({
        error: "invalid_profile_request",
        message: "Profile creation request is invalid.",
        validation: { valid: false, errors: requestErrors, warnings: [] }
      });
    }

    const result = await createProfileFromDiscovery(request.body);
    if (!result.validation.valid) {
      return reply.status(400).send(result);
    }

    return reply.status(201).send(result);
  });
}
