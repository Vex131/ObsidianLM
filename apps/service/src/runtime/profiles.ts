import { access } from "node:fs/promises";
import type { LlamaCppProfile, RuntimeProfile } from "@obsidianlm/shared";
import { loadProfiles } from "../config/storage.js";

export interface ProfileValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateOptionalNumber(container: Record<string, unknown>, key: string, errors: string[]): void {
  const value = container[key];
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    errors.push(`llamaArgs.${key} must be a number when provided.`);
  }
}

function validateOptionalString(container: Record<string, unknown>, key: string, errors: string[]): void {
  const value = container[key];
  if (value !== undefined && typeof value !== "string") {
    errors.push(`llamaArgs.${key} must be a string when provided.`);
  }
}

function validateOptionalBoolean(container: Record<string, unknown>, key: string, errors: string[]): void {
  const value = container[key];
  if (value !== undefined && typeof value !== "boolean") {
    errors.push(`llamaArgs.${key} must be a boolean when provided.`);
  }
}

export async function listProfiles(): Promise<RuntimeProfile[]> {
  const profiles = await loadProfiles();
  return Array.isArray(profiles) ? profiles : [];
}

export async function getProfile(profileId: string): Promise<RuntimeProfile | null> {
  const profiles = await listProfiles();
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

export function isLlamaCppServerProfile(profile: RuntimeProfile): profile is LlamaCppProfile {
  return profile.runtimeType === "llama.cpp" && profile.providerKind === "server";
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function validateProfile(profile: unknown): Promise<ProfileValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(profile)) {
    return {
      valid: false,
      errors: ["Unsupported profile shape: profile must be an object."],
      warnings
    };
  }

  if (!hasString(profile.id)) {
    errors.push("Profile id is required.");
  }

  if (profile.runtimeType !== "llama.cpp") {
    errors.push("Unsupported runtimeType. Phase 1 only supports llama.cpp.");
  }

  if (profile.providerKind !== "server") {
    errors.push("Unsupported providerKind. Phase 1 only supports server profiles.");
  }

  if (!hasString(profile.buildPath)) {
    errors.push("buildPath is required.");
  }

  if (!hasString(profile.modelPath)) {
    errors.push("modelPath is required.");
  }

  if (!hasString(profile.host)) {
    errors.push("host is required.");
  }

  if (typeof profile.port !== "number" || !Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65535) {
    errors.push("port must be a valid number between 1 and 65535.");
  }

  if (profile.extraArgs !== undefined && (!Array.isArray(profile.extraArgs) || !profile.extraArgs.every((arg) => typeof arg === "string"))) {
    errors.push("extraArgs must be an array of strings.");
  }

  if (isRecord(profile.llamaArgs)) {
    validateOptionalNumber(profile.llamaArgs, "ctxSize", errors);
    const gpuLayers = profile.llamaArgs.gpuLayers;
    if (gpuLayers !== undefined && gpuLayers !== "all" && (typeof gpuLayers !== "number" || !Number.isFinite(gpuLayers))) {
      errors.push("llamaArgs.gpuLayers must be a number or 'all' when provided.");
    }

    const devices = profile.llamaArgs.devices;
    if (devices !== undefined && (!Array.isArray(devices) || !devices.every((device) => typeof device === "string"))) {
      errors.push("llamaArgs.devices must be an array of strings.");
    }

    validateOptionalString(profile.llamaArgs, "splitMode", errors);
    validateOptionalString(profile.llamaArgs, "tensorSplit", errors);
    validateOptionalString(profile.llamaArgs, "cacheTypeK", errors);
    validateOptionalString(profile.llamaArgs, "cacheTypeV", errors);
    validateOptionalBoolean(profile.llamaArgs, "flashAttention", errors);
    validateOptionalNumber(profile.llamaArgs, "batchSize", errors);
    validateOptionalNumber(profile.llamaArgs, "ubatchSize", errors);
    validateOptionalNumber(profile.llamaArgs, "parallel", errors);
    validateOptionalNumber(profile.llamaArgs, "threads", errors);
    validateOptionalNumber(profile.llamaArgs, "threadsBatch", errors);
    validateOptionalBoolean(profile.llamaArgs, "contBatching", errors);
    validateOptionalBoolean(profile.llamaArgs, "metrics", errors);
    validateOptionalBoolean(profile.llamaArgs, "webui", errors);
  } else if (profile.llamaArgs !== undefined) {
    errors.push("llamaArgs must be an object when provided.");
  }

  if (hasString(profile.buildPath) && !(await pathExists(profile.buildPath))) {
    errors.push("buildPath does not exist on disk.");
  }

  if (hasString(profile.modelPath) && !(await pathExists(profile.modelPath))) {
    errors.push("modelPath does not exist on disk.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
