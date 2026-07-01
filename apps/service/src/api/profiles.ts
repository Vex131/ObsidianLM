import type { FastifyInstance, FastifyReply } from "fastify";
import type { ExportProfilesResponse, RuntimeProfile } from "@obsidianlm/shared";
import { buildLlamaCppServerCommand } from "../runtime/command.js";
import {
  buildProfileSnippets,
  createManualProfile,
  deleteManualProfile,
  duplicateManualProfile,
  getProfile,
  importManualProfiles,
  isLlamaCppServerProfile,
  listProfiles,
  updateManualProfile,
  validateProfile
} from "../runtime/profiles.js";
import type { RuntimeManager } from "../runtime/manager.js";

function storageError(error: unknown): { error: string; message: string } | null {
  if (error instanceof SyntaxError) {
    return { error: "invalid_storage_json", message: "data/profiles.json is invalid JSON. Fix the file before editing profiles." };
  }
  return null;
}

function isActiveProfile(runtimeManager: RuntimeManager, profileId: string): boolean {
  const state = runtimeManager.getState();
  return state.activeProfileId === profileId && ["starting", "running", "stopping"].includes(state.status);
}

function isFastifyReply(value: unknown): value is FastifyReply {
  return typeof value === "object" && value !== null && "sent" in value && "status" in value;
}

async function withProfileStorage<T>(reply: FastifyReply, action: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await action();
  } catch (error) {
    const jsonError = storageError(error);
    if (jsonError) {
      return reply.status(500).send(jsonError);
    }
    throw error;
  }
}

export async function registerProfileRoutes(app: FastifyInstance, runtimeManager: RuntimeManager): Promise<void> {
  app.get("/api/profiles", async (request, reply) => withProfileStorage(reply, async () => ({ profiles: await listProfiles() })));

  app.post<{ Body: Partial<RuntimeProfile> }>("/api/profiles", async (request, reply) =>
    withProfileStorage(reply, async () => {
      const result = await createManualProfile(request.body ?? {});
      if (!result.validation.valid) {
        return reply.status(400).send(result);
      }
      return reply.status(201).send(result);
    })
  );

  app.get("/api/profiles/export", async (request, reply) =>
    withProfileStorage(reply, async () => {
      const response: ExportProfilesResponse = {
        exportVersion: 1,
        exportedAt: new Date().toISOString(),
        profiles: await listProfiles()
      };
      return response;
    })
  );

  app.post<{ Body: { profiles?: RuntimeProfile[]; rejectConflicts?: boolean } | RuntimeProfile[] }>("/api/profiles/import", async (request, reply) =>
    withProfileStorage(reply, async () => {
      const isValidPayload = Array.isArray(request.body) || (request.body && typeof request.body === "object" && Array.isArray(request.body.profiles));
      if (!isValidPayload) {
        return reply.status(400).send({ error: "invalid_import_payload", message: "Import body must be a profiles array or an object with a profiles array." });
      }
      const rejectConflicts = !Array.isArray(request.body) && request.body?.rejectConflicts === true;
      return importManualProfiles(request.body, rejectConflicts);
    })
  );

  app.get<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
    const profile = await withProfileStorage(reply, async () => getProfile(request.params.id));
    if (isFastifyReply(profile)) {
      return profile;
    }
    if (!profile) {
      return reply.status(404).send({ error: "not_found", message: "Profile not found." });
    }

    return { profile };
  });

  app.patch<{ Params: { id: string }; Body: Partial<RuntimeProfile> }>("/api/profiles/:id", async (request, reply) =>
    withProfileStorage(reply, async () => {
      if (request.body?.runtimeType && request.body.runtimeType !== "llama.cpp") {
        return reply.status(400).send({ error: "unsupported_profile", message: "Only llama.cpp profiles can be edited in Phase 5." });
      }
      if (request.body?.providerKind && request.body.providerKind !== "server") {
        return reply.status(400).send({ error: "unsupported_profile", message: "Only llama.cpp server profiles can be edited in Phase 5." });
      }

      const result = await updateManualProfile(request.params.id, request.body ?? {});
      if (!result) {
        return reply.status(404).send({ error: "not_found", message: "Profile not found." });
      }
      if (!result.validation.valid) {
        return reply.status(400).send(result);
      }
      const warnings = isActiveProfile(runtimeManager, request.params.id) ? ["This profile is currently running. Changes apply the next time it is started.", ...(result.warnings ?? [])] : result.warnings;
      return { ...result, warnings };
    })
  );

  app.post<{ Params: { id: string }; Body: { id?: string; name?: string } }>("/api/profiles/:id/duplicate", async (request, reply) =>
    withProfileStorage(reply, async () => {
      const result = await duplicateManualProfile(request.params.id, request.body ?? {});
      if (!result) {
        return reply.status(404).send({ error: "not_found", message: "Profile not found." });
      }
      if (!result.validation.valid) {
        return reply.status(409).send(result);
      }
      return reply.status(201).send(result);
    })
  );

  app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) =>
    withProfileStorage(reply, async () => {
      if (isActiveProfile(runtimeManager, request.params.id)) {
        return reply.status(409).send({ error: "profile_running", message: "Cannot delete the active managed profile. Stop the runtime first; ObsidianLM will not stop it automatically." });
      }
      const deleted = await deleteManualProfile(request.params.id, () => !isActiveProfile(runtimeManager, request.params.id));
      if (deleted === "blocked") {
        return reply.status(409).send({ error: "profile_running", message: "Cannot delete the active managed profile. Stop the runtime first; ObsidianLM will not stop it automatically." });
      }
      if (deleted === "not_found") {
        return reply.status(404).send({ error: "not_found", message: "Profile not found." });
      }
      return { deletedProfileId: request.params.id };
    })
  );

  app.post<{ Params: { id: string } }>("/api/profiles/:id/validate", async (request, reply) => {
    const profile = await withProfileStorage(reply, async () => getProfile(request.params.id));
    if (isFastifyReply(profile)) {
      return profile;
    }
    if (!profile) {
      return reply.status(404).send({ valid: false, errors: ["Profile not found."], warnings: [] });
    }

    return validateProfile(profile, { strictPaths: false, checkPort: true });
  });

  app.get<{ Params: { id: string } }>("/api/profiles/:id/command", async (request, reply) => {
    const profile = await withProfileStorage(reply, async () => getProfile(request.params.id));
    if (isFastifyReply(profile)) {
      return profile;
    }
    if (!profile) {
      return reply.status(404).send({ error: "not_found", message: "Profile not found." });
    }

    if (!isLlamaCppServerProfile(profile)) {
      return reply.status(400).send({ error: "unsupported_profile", message: "Phase 1 only supports llama.cpp server profiles." });
    }

    return { command: buildLlamaCppServerCommand(profile) };
  });

  app.get<{ Params: { id: string } }>("/api/profiles/:id/snippets", async (request, reply) => {
    const profile = await withProfileStorage(reply, async () => getProfile(request.params.id));
    if (isFastifyReply(profile)) {
      return profile;
    }
    if (!profile) {
      return reply.status(404).send({ error: "not_found", message: "Profile not found." });
    }

    if (!isLlamaCppServerProfile(profile)) {
      return reply.status(400).send({ error: "unsupported_profile", message: "Only llama.cpp server profiles have snippets in Phase 5." });
    }

    return buildProfileSnippets(profile);
  });

  app.post<{ Params: { id: string } }>("/api/profiles/:id/start", async (request, reply) => {
    const result = await runtimeManager.start(request.params.id);
    return reply.status(result.ok ? 200 : result.error === "port_conflict" ? 409 : 400).send(result);
  });
}
