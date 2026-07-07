import type { FastifyInstance } from "fastify";
import { loadSettings } from "../config/storage.js";
import { extractBearerToken, verifyAdminTokenHash } from "./admin-token.js";

const publicApiRoutes = new Set([
  "GET /api/status",
  "GET /api/auth/status",
  "POST /api/auth/setup",
  "POST /api/auth/verify",
  "POST /api/auth/logout"
]);

const authDisabled = process.env.DISABLE_AUTH === "true";

export async function registerAdminAuthProtection(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", async (request, reply) => {
    const path = request.routeOptions.url ?? request.url.split("?")[0] ?? request.url;
    if (!path.startsWith("/api/") || publicApiRoutes.has(`${request.method} ${path}`)) {
      return;
    }

    if (authDisabled) {
      return;
    }

    const settings = await loadSettings();
    if (!settings.adminTokenHash) {
      return;
    }

    const token = extractBearerToken(request);
    const ok = await verifyAdminTokenHash(token, settings.adminTokenHash);
    if (!ok) {
      return reply.status(401).send({ error: "unauthorized", message: "A valid admin bearer token is required." });
    }
  });
}
