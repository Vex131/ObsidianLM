import { stat } from "node:fs/promises";
import type { ConfiguredModel, LlamaBuildCapabilitiesManifest, LlamaCppBuild, LlamaCppBuildFunctionalEvidence, RouterCatalogSnapshot } from "@obsidianlm/shared";
import { loadPhase15Domain, mutatePhase15Domain, reconcileBuildFingerprintInSnapshot, type Phase15DomainSnapshot } from "../config/phase15-domain.js";
import { loadSettingsReadOnly } from "../config/storage.js";
import { getLlamaBuildCapabilitiesForServer } from "../discovery/llama-build-capabilities.js";
import { reconcileRouterCatalog, catalogHasDisallowedEntries } from "./catalog.js";
import { fingerprintServerExecutable } from "./fingerprint.js";
import { runRouterProbe, type RouterProbeInput, type RouterProbeResult } from "./probe-runner.js";
import { routerAutoloadArgument } from "./autoload-policy.js";

export type RouterValidationErrorCode = "not_found" | "invalid_payload" | "conflict" | "prerequisite" | "validation_in_progress";

export class RouterValidationError extends Error {
  constructor(public readonly code: RouterValidationErrorCode, message: string) { super(message); }
}

export interface FunctionalRouterValidationResult {
  outcome: "eligible" | "ineligible" | "failed" | "not_validated" | "stale";
  build: LlamaCppBuild;
  catalog?: RouterCatalogSnapshot;
}

export interface FunctionalRouterValidatorDependencies {
  load?: () => Promise<Phase15DomainSnapshot>;
  mutate?: <T>(mutator: (snapshot: Phase15DomainSnapshot) => T | Promise<T>) => Promise<{ snapshot: Phase15DomainSnapshot; result: T }>;
  fingerprint?: (locator: string) => Promise<string>;
  staticProbe?: (build: LlamaCppBuild) => Promise<LlamaBuildCapabilitiesManifest>;
  probe?: (input: RouterProbeInput) => Promise<RouterProbeResult>;
  resourceAvailable?: (locator: string) => Promise<boolean>;
  managedPort?: () => Promise<number>;
  now?: () => Date;
}

const validatingBuilds = new Set<string>();
export const isRouterValidationRunning = (buildId: string): boolean => validatingBuilds.has(buildId);

const available = async (locator: string): Promise<boolean> => { try { await stat(locator); return true; } catch { return false; } };

function staticEvidence(build: LlamaCppBuild, manifest: LlamaBuildCapabilitiesManifest, fingerprint: string): LlamaCppBuild["staticEvidence"] {
  return { kind: "static", assessedAt: manifest.inspectedAt, discoveredTools: structuredClone(build.tools), ...(manifest.versionInfo ? { versionInfo: structuredClone(manifest.versionInfo) } : {}), routerFlags: structuredClone(manifest.router), serverFingerprint: fingerprint, warnings: manifest.warnings.map((warning) => warning.message) };
}

function evidence(state: LlamaCppBuildFunctionalEvidence["state"], fingerprint: string, now: string, values: Partial<LlamaCppBuildFunctionalEvidence>): LlamaCppBuildFunctionalEvidence {
  return { kind: "functional", state, validationProtocolVersion: 1, serverFingerprint: fingerprint, attemptedAt: now, completedAt: now, launchAttempted: false, presetAccepted: false, healthVerified: false, modelsVerified: false, catalogBoundaryVerified: false, requiredBehaviorVerified: false, warnings: [], failures: [], ...values };
}

async function selectModel(snapshot: Phase15DomainSnapshot, build: LlamaCppBuild, requestedId: string | undefined, resourceAvailable: (locator: string) => Promise<boolean>): Promise<{ model: ConfiguredModel; path: string }> {
  const assigned = snapshot.configuredModels.filter((model) => model.buildId === build.id);
  if (requestedId !== undefined) {
    const requested = snapshot.configuredModels.find((model) => model.id === requestedId);
    if (!requested) throw new RouterValidationError("not_found", "Configured model not found.");
    if (requested.buildId !== build.id) throw new RouterValidationError("conflict", "Configured model belongs to another Build.");
  }
  const candidates = (requestedId ? assigned.filter((model) => model.id === requestedId) : assigned)
    .map((model) => ({ model, artifact: snapshot.artifacts.find((artifact) => artifact.id === model.artifactId) }))
    .filter((item) => item.artifact?.resource.owner.scope === "local" && item.artifact.kind === "model" && item.artifact.referenceStatus === "available")
    .sort((left, right) => left.model.routerAlias.localeCompare(right.model.routerAlias) || left.model.id.localeCompare(right.model.id));
  for (const selected of candidates) {
    if (selected.artifact && await resourceAvailable(selected.artifact.resource.locator)) return { model: selected.model, path: selected.artifact.resource.locator };
  }
  throw new RouterValidationError("prerequisite", "A local available model Artifact assigned to this Build is required for router validation.");
}

export async function validateFunctionalRouterBuild(buildId: string, configuredModelId?: string, dependencies: FunctionalRouterValidatorDependencies = {}): Promise<FunctionalRouterValidationResult> {
  if (validatingBuilds.has(buildId)) throw new RouterValidationError("validation_in_progress", "Router validation is already running for this Build.");
  validatingBuilds.add(buildId);
  const load = dependencies.load ?? (() => loadPhase15Domain());
  const mutate = dependencies.mutate ?? ((mutator) => mutatePhase15Domain(mutator));
  const fingerprint = dependencies.fingerprint ?? fingerprintServerExecutable;
  const probeStatic = dependencies.staticProbe ?? ((build) => getLlamaBuildCapabilitiesForServer(build.server.locator, build.id, build.tools));
  const probe = dependencies.probe ?? ((input) => runRouterProbe(input));
  const resourceAvailable = dependencies.resourceAvailable ?? available;
  const managedPort = dependencies.managedPort ?? (async () => (await loadSettingsReadOnly()).managedLlamaPort);
  const now = dependencies.now ?? (() => new Date());
  try {
    const initial = await load();
    const build = initial.builds.find((entry) => entry.id === buildId);
    if (!build) throw new RouterValidationError("not_found", "Build not found.");
    if (build.server.owner.scope !== "local") throw new RouterValidationError("prerequisite", "Router validation is only supported for Builds owned by the local Node.");
    const locator = build.server.locator;
    let probeFingerprint: string;
    try { probeFingerprint = await fingerprint(locator); } catch {
      const committed = await mutate((snapshot) => reconcileBuildFingerprintInSnapshot(snapshot, build.id, undefined, "Router validation was invalidated because the resolved server executable is missing."));
      throw new RouterValidationError("prerequisite", `The resolved llama-server executable is unavailable; Build ${committed.result.id} remains not validated.`);
    }
    const manifest = await probeStatic(build);
    const postStaticFingerprint = await fingerprint(locator).catch(() => undefined);
    if (postStaticFingerprint !== probeFingerprint) {
      await mutate((snapshot) => reconcileBuildFingerprintInSnapshot(snapshot, build.id, postStaticFingerprint, "Router validation was interrupted because the resolved server executable changed during static preflight."));
      throw new RouterValidationError("conflict", "Build executable changed during static preflight.");
    }
    await mutate((snapshot) => {
      const latest = snapshot.builds.find((entry) => entry.id === build.id);
      if (!latest) throw new RouterValidationError("not_found", "Build not found.");
      if (latest.server.owner.scope !== "local" || latest.server.locator !== locator) throw new RouterValidationError("conflict", "Build executable changed before validation started.");
      reconcileBuildFingerprintInSnapshot(snapshot, build.id, probeFingerprint);
      latest.staticEvidence = staticEvidence(latest, manifest, probeFingerprint);
      if (manifest.versionInfo) latest.versionInfo = structuredClone(manifest.versionInfo);
    });
    const attemptedAt = now().toISOString();
    if (["partial", "unsupported"].includes(manifest.router.status) && manifest.router.missingRequiredFlags.length > 0) {
      const reason = `Required router controls are absent: ${manifest.router.missingRequiredFlags.join(", ")}.`;
      const finalEvidence = evidence("ineligible", probeFingerprint, attemptedAt, { reason, failures: [reason] });
      const result = await commitResult(build.id, locator, probeFingerprint, finalEvidence, mutate, fingerprint);
      return { outcome: result.stale ? "stale" : "ineligible", build: result.build };
    }
    let selected: { model: ConfiguredModel; path: string };
    try { selected = await selectModel(await load(), build, configuredModelId, resourceAvailable); }
    catch (error) {
      if (error instanceof RouterValidationError && error.code === "prerequisite") {
        await mutate((snapshot) => {
          const latest = snapshot.builds.find((entry) => entry.id === build.id);
          if (!latest) return;
          latest.managedInferenceEligibility = "not_validated";
          delete latest.functionalEvidence;
          delete latest.validatedAt;
        });
      }
      throw error;
    }
    const autoloadFlag = routerAutoloadArgument(manifest);
    const probeResult = await probe({ executable: locator, modelPath: selected.path, routerAlias: selected.model.routerAlias, autoloadFlag, forbiddenPorts: [await managedPort()] });
    const catalog = probeResult.models === undefined ? undefined : reconcileRouterCatalog(probeResult.models, [{ routerAlias: selected.model.routerAlias, configuredModelId: selected.model.id }], now().toISOString());
    const expected = catalog?.entries.find((entry) => entry.ownership === "managed" && entry.configuredModelId === selected.model.id);
    const modelsVerified = probeResult.modelsVerified && expected !== undefined;
    const managedCount = catalog?.entries.filter((entry) => entry.ownership === "managed").length ?? 0;
    const catalogBoundaryVerified = catalog?.reconciliationState === "reconciled" && !catalogHasDisallowedEntries(catalog.entries) && managedCount === 1 && expected?.state === "unloaded";
    const requiredBehaviorVerified = probeResult.classification === "eligible" && probeResult.presetAccepted && probeResult.healthVerified && modelsVerified && catalogBoundaryVerified;
    const state = requiredBehaviorVerified ? "eligible" : probeResult.classification === "failed" ? "failed" : "ineligible";
    const finalEvidence = evidence(state, probeFingerprint, attemptedAt, {
      launchAttempted: probeResult.launchAttempted,
      presetAccepted: probeResult.presetAccepted,
      healthVerified: probeResult.healthVerified,
      modelsVerified,
      catalogBoundaryVerified,
      requiredBehaviorVerified,
      reason: catalog && !catalogBoundaryVerified ? "Controlled router catalog did not match the single expected validation model." : probeResult.reason,
      warnings: [...probeResult.warnings, ...(catalog?.warnings ?? [])],
      failures: probeResult.failures
    });
    const result = await commitResult(build.id, locator, probeFingerprint, finalEvidence, mutate, fingerprint);
    return { outcome: result.stale ? "stale" : state, build: result.build, ...(catalog ? { catalog } : {}) };
  } finally {
    validatingBuilds.delete(buildId);
  }
}

async function commitResult(buildId: string, locator: string, probeFingerprint: string, functionalEvidence: LlamaCppBuildFunctionalEvidence, mutate: NonNullable<FunctionalRouterValidatorDependencies["mutate"]>, fingerprint: (locator: string) => Promise<string>): Promise<{ build: LlamaCppBuild; stale: boolean }> {
  let currentFingerprint: string | undefined;
  try { currentFingerprint = await fingerprint(locator); } catch { currentFingerprint = undefined; }
  return (await mutate((snapshot) => {
    const latest = snapshot.builds.find((entry) => entry.id === buildId);
    if (!latest) throw new RouterValidationError("not_found", "Build not found.");
    if (latest.server.owner.scope !== "local" || latest.server.locator !== locator || currentFingerprint !== probeFingerprint) {
      reconcileBuildFingerprintInSnapshot(snapshot, buildId, currentFingerprint, "Router validation result was discarded because the resolved server executable changed during validation.");
      return { build: snapshot.builds.find((entry) => entry.id === buildId)!, stale: true };
    }
    latest.serverFingerprint = probeFingerprint;
    latest.functionalEvidence = functionalEvidence;
    latest.managedInferenceEligibility = functionalEvidence.state;
    latest.validatedAt = functionalEvidence.completedAt;
    return { build: latest, stale: false };
  })).result;
}
