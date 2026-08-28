import type { FastifyInstance } from "fastify";
import type { CreateProfileFromDiscoveryRequest } from "@obsidianlm/shared";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { getLlamaBuildCapabilities } from "../discovery/llama-build-capabilities.js";
import { discoverModels } from "../discovery/models.js";
import { discoverToolInputs } from "../discovery/tool-inputs.js";
import { createProfileFromDiscovery, validateCreateProfileRequest } from "../discovery/profile-factory.js";

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/discovery/models", async () => discoverModels());

  app.post("/api/discovery/models/rescan", async () => discoverModels());

  app.get("/api/discovery/llama-builds", async () => discoverLlamaBuilds());

  app.post("/api/discovery/llama-builds/rescan", async () => discoverLlamaBuilds());

  app.get<{ Params: { id: string } }>("/api/discovery/llama-builds/:id/capabilities", async (request, reply) => {
    const discovery = await discoverLlamaBuilds();
    const build = discovery.builds.find((item) => item.id === request.params.id);
    if (!build) {
      return reply.status(404).send({ error: "not_found", message: "Discovered llama.cpp build not found." });
    }
    return getLlamaBuildCapabilities(build);
  });

  app.get("/api/discovery/tool-inputs", async () => discoverToolInputs());

  app.post("/api/discovery/tool-inputs/rescan", async () => discoverToolInputs());

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
