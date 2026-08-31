import type { FastifyInstance } from "fastify";
import type { CreateProfileFromDiscoveryRequest } from "@obsidianlm/shared";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { getLlamaBuildCapabilities } from "../discovery/llama-build-capabilities.js";
import { discoverModels } from "../discovery/models.js";
import { inspectGgufMetadata } from "../discovery/gguf-metadata.js";
import { discoverToolInputs } from "../discovery/tool-inputs.js";
import { createProfileFromDiscovery, validateCreateProfileRequest } from "../discovery/profile-factory.js";
import { normalizePathForCompare } from "../discovery/helpers.js";
import { synchronizeDiscoveryCatalog } from "../discovery/catalog-sync.js";
import { listProfiles } from "../runtime/profiles.js";

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/discovery/models", async () => discoverModels());

  app.post("/api/discovery/models/rescan", async () => synchronizeDiscoveryCatalog());

  app.get("/api/discovery/models/usage", async () => {
    const [discovery, profiles] = await Promise.all([discoverModels(), listProfiles()]);
    const byPath = new Map(discovery.models.map((model) => [normalizePathForCompare(model.path), model.id]));
    const usage = new Map<string, string[]>();
    const missingProfileIds: string[] = [];
    for (const profile of profiles) {
      const artifactId = byPath.get(normalizePathForCompare(profile.modelPath));
      if (!artifactId) {
        missingProfileIds.push(profile.id);
        continue;
      }
      usage.set(artifactId, [...(usage.get(artifactId) ?? []), profile.id]);
    }
    return { usage: [...usage].map(([artifactId, profileIds]) => ({ artifactId, profileIds })), missingProfileIds };
  });

  app.get<{ Params: { id: string } }>("/api/discovery/models/:id/metadata", async (request, reply) => {
    const discovery = await discoverModels();
    const model = discovery.models.find((item) => item.id === request.params.id);
    if (!model) return reply.status(404).send({ error: "not_found", message: "Discovered GGUF model not found." });
    return inspectGgufMetadata(model.path, model.id);
  });

  app.get("/api/discovery/llama-builds", async () => discoverLlamaBuilds());

  app.post("/api/discovery/llama-builds/rescan", async () => synchronizeDiscoveryCatalog());

  app.get("/api/discovery/llama-builds/usage", async () => {
    const [discovery, profiles] = await Promise.all([discoverLlamaBuilds(), listProfiles()]);
    const byPath = new Map(discovery.builds.map((build) => [normalizePathForCompare(build.serverPath), build.id]));
    const usage = new Map<string, string[]>();
    const missingProfileIds: string[] = [];
    for (const profile of profiles) {
      const buildId = byPath.get(normalizePathForCompare(profile.buildPath));
      if (!buildId) {
        missingProfileIds.push(profile.id);
        continue;
      }
      usage.set(buildId, [...(usage.get(buildId) ?? []), profile.id]);
    }
    return { usage: [...usage].map(([buildId, profileIds]) => ({ buildId, profileIds })), missingProfileIds };
  });

  app.get<{ Params: { id: string } }>("/api/discovery/llama-builds/:id/capabilities", async (request, reply) => {
    const discovery = await discoverLlamaBuilds();
    const build = discovery.builds.find((item) => item.id === request.params.id);
    if (!build) {
      return reply.status(404).send({ error: "not_found", message: "Discovered llama.cpp build not found." });
    }
    if (!build.serverPath) return reply.status(409).send({ error: "unavailable", message: "Discovered build has no llama-server executable." });
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
