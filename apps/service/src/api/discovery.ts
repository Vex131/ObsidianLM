import type { FastifyInstance } from "fastify";
import { discoverLlamaBuilds } from "../discovery/llama-builds.js";
import { getLlamaBuildCapabilities } from "../discovery/llama-build-capabilities.js";
import { discoverModels } from "../discovery/models.js";
import { inspectGgufMetadata } from "../discovery/gguf-metadata.js";
import { discoverToolInputs } from "../discovery/tool-inputs.js";
import { synchronizeDiscoveryCatalog } from "../discovery/catalog-sync.js";

export async function registerDiscoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/discovery/models", async () => discoverModels());

  app.post("/api/discovery/models/rescan", async () => synchronizeDiscoveryCatalog());

  app.get<{ Params: { id: string } }>("/api/discovery/models/:id/metadata", async (request, reply) => {
    const discovery = await discoverModels();
    const model = discovery.models.find((item) => item.id === request.params.id);
    if (!model) return reply.status(404).send({ error: "not_found", message: "Discovered GGUF model not found." });
    return inspectGgufMetadata(model.path, model.id);
  });

  app.get("/api/discovery/llama-builds", async () => discoverLlamaBuilds());

  app.post("/api/discovery/llama-builds/rescan", async () => synchronizeDiscoveryCatalog());

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

}
