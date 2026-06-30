import path from "node:path";
import type { CreateProfileFromDiscoveryRequest, CreateProfileFromDiscoveryResponse, LlamaCppArgs, LlamaCppProfile } from "@obsidianlm/shared";
import { loadProfiles, loadSettings, saveProfiles } from "../config/storage.js";
import { discoverLlamaBuilds } from "./llama-builds.js";
import { discoverModels } from "./models.js";
import { buildLlamaCppServerCommand } from "../runtime/command.js";
import { validateProfile } from "../runtime/profiles.js";
import { slugifyProfileId, stableId } from "./helpers.js";

const defaultLlamaArgs: LlamaCppArgs = {
  ctxSize: 8192,
  gpuLayers: "all",
  flashAttention: true,
  batchSize: 512,
  ubatchSize: 128,
  parallel: 1,
  contBatching: true,
  metrics: true,
  webui: true
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureUniqueId(name: string, existingIds: Set<string>): string {
  const baseId = slugifyProfileId(name);
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let id = `${baseId}-${stableId(`${name}:${existingIds.size}`).slice(0, 6)}`;
  let counter = 2;
  while (existingIds.has(id)) {
    id = `${baseId}-${counter}`;
    counter += 1;
  }

  return id;
}

export function validateCreateProfileRequest(body: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(body)) {
    return ["Request body must be an object."];
  }

  for (const key of ["name", "modelPath", "buildPath"] as const) {
    if (typeof body[key] !== "string" || body[key].trim().length === 0) {
      errors.push(`${key} is required.`);
    }
  }

  if (body.host !== undefined && typeof body.host !== "string") {
    errors.push("host must be a string when provided.");
  }

  if (body.port !== undefined && (typeof body.port !== "number" || !Number.isInteger(body.port) || body.port < 1 || body.port > 65535)) {
    errors.push("port must be a valid number between 1 and 65535 when provided.");
  }

  if (body.llamaArgs !== undefined && !isRecord(body.llamaArgs)) {
    errors.push("llamaArgs must be an object when provided.");
  }

  if (body.extraArgs !== undefined && (!Array.isArray(body.extraArgs) || !body.extraArgs.every((arg) => typeof arg === "string"))) {
    errors.push("extraArgs must be an array of strings when provided.");
  }

  return errors;
}

export async function createProfileFromDiscovery(request: CreateProfileFromDiscoveryRequest): Promise<CreateProfileFromDiscoveryResponse> {
  const profiles = await loadProfiles();
  const settings = await loadSettings();
  const profileName = request.name.trim();
  const profile: LlamaCppProfile = {
    id: ensureUniqueId(profileName, new Set(profiles.map((item) => item.id))),
    name: profileName,
    runtimeType: "llama.cpp",
    providerKind: "server",
    buildPath: path.resolve(request.buildPath),
    modelPath: path.resolve(request.modelPath),
    host: request.host?.trim() || "0.0.0.0",
    port: request.port ?? settings.managedLlamaPort,
    llamaArgs: {
      ...defaultLlamaArgs,
      ...(request.llamaArgs ?? {})
    },
    extraArgs: request.extraArgs ?? []
  };

  const [modelDiscovery, buildDiscovery] = await Promise.all([discoverModels(), discoverLlamaBuilds()]);
  const normalizedModelPath = path.resolve(request.modelPath);
  const normalizedBuildPath = path.resolve(request.buildPath);
  const discoveryErrors: string[] = [];

  if (!modelDiscovery.models.some((model) => path.resolve(model.path) === normalizedModelPath)) {
    discoveryErrors.push("modelPath must match a discovered GGUF model from a configured model folder.");
  }

  if (!buildDiscovery.builds.some((build) => path.resolve(build.serverPath) === normalizedBuildPath)) {
    discoveryErrors.push("buildPath must match a discovered llama-server executable from a configured llama.cpp folder.");
  }

  const validation = await validateProfile(profile);
  validation.errors.push(...discoveryErrors);
  validation.warnings.push(...modelDiscovery.warnings.map((warning) => warning.message), ...buildDiscovery.warnings.map((warning) => warning.message));
  validation.valid = validation.errors.length === 0;

  if (!validation.valid) {
    return {
      profile,
      command: buildLlamaCppServerCommand(profile),
      validation
    };
  }

  await saveProfiles([...profiles, profile]);

  return {
    profile,
    command: buildLlamaCppServerCommand(profile),
    validation
  };
}
