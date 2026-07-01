import type { FastifyInstance } from "fastify";
import type { AdminTokenRequest, AuthLogoutResponse, AuthSetupResponse, AuthStatusResponse, AuthVerifyResponse } from "@obsidianlm/shared";
import { hashAdminToken, validateAdminTokenStrength, verifyAdminTokenHash } from "../auth/admin-token.js";
import { loadSettings, saveSettings } from "../config/storage.js";

let setupLock: Promise<void> = Promise.resolve();

function getRequestToken(body: unknown): unknown {
  return body && typeof body === "object" && "token" in body ? (body as AdminTokenRequest).token : undefined;
}

async function withSetupLock<T>(action: () => Promise<T>): Promise<T> {
  const previous = setupLock;
  let release = (): void => {};
  setupLock = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await action();
  } finally {
    release();
  }
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/auth/status", async (): Promise<AuthStatusResponse> => {
    const settings = await loadSettings();
    const configured = Boolean(settings.adminTokenHash);
    return { configured, authRequired: configured };
  });

  app.post<{ Body: AdminTokenRequest }>("/api/auth/setup", async (request, reply) => {
    const token = getRequestToken(request.body);
    const strengthError = validateAdminTokenStrength(token);
    if (strengthError || typeof token !== "string") {
      return reply.status(400).send({ error: "weak_admin_token", message: strengthError ?? "Admin token is invalid." });
    }

    const setupResult = await withSetupLock(async () => {
      const settings = await loadSettings();
      if (settings.adminTokenHash) {
        return "already_configured" as const;
      }

      const adminTokenHash = await hashAdminToken(token);
      const latestSettings = await loadSettings();
      if (latestSettings.adminTokenHash) {
        return "already_configured" as const;
      }

      await saveSettings({ ...latestSettings, adminTokenHash });
      return "configured" as const;
    });

    if (setupResult === "already_configured") {
      return reply.status(409).send({ error: "auth_already_configured", message: "Admin token authentication is already configured." });
    }

    const response: AuthSetupResponse = { ok: true, configured: true };
    return reply.status(201).send(response);
  });

  app.post<{ Body: AdminTokenRequest }>("/api/auth/verify", async (request, reply) => {
    const settings = await loadSettings();
    if (!settings.adminTokenHash) {
      return reply.status(409).send({ ok: false, error: "auth_not_configured", message: "Admin token authentication is not configured." });
    }

    const token = getRequestToken(request.body);
    if (typeof token !== "string" || token.length === 0) {
      return reply.status(400).send({ ok: false, error: "missing_admin_token", message: "Admin token is required." });
    }

    const ok = await verifyAdminTokenHash(token, settings.adminTokenHash);
    const response: AuthVerifyResponse = { ok };
    return ok ? response : reply.status(401).send({ ...response, error: "invalid_admin_token", message: "Admin token is invalid." });
  });

  app.post("/api/auth/logout", async (): Promise<AuthLogoutResponse> => ({ ok: true }));
}
