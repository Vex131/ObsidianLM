import type { DiscoveredLlamaCppBuild, DiscoveredModel, LlamaCppBuild, ModelArtifact } from "@obsidianlm/shared";
import { findOrRegisterLegacyBuildInSnapshot, findOrRegisterLocalArtifactInSnapshot, mutatePhase15Domain, normalizeLocalResourceLocator, reconcileBuildFingerprintInSnapshot, type Phase15DomainSnapshot } from "../config/phase15-domain.js";
import { fingerprintServerExecutable } from "../router/fingerprint.js";
import { inspectGgufMetadata } from "./gguf-metadata.js";
import { discoverLlamaBuilds } from "./llama-builds.js";
import { discoverModels } from "./models.js";

function reconcileConfiguredModel(snapshot: Phase15DomainSnapshot, model: Phase15DomainSnapshot["configuredModels"][number]): void {
  const artifact = snapshot.artifacts.find((entry) => entry.id === model.artifactId)!;
  const build = snapshot.builds.find((entry) => entry.id === model.buildId)!;
  const projector = model.projector && snapshot.artifacts.find((entry) => entry.id === model.projector!.artifactId)!;
  model.referenceStatus = { artifact: artifact.referenceStatus, build: build.tools.some((tool) => tool.kind === "server" && tool.exists) ? "available" : "missing" };
  if (model.projector) model.projector.validationStatus = projector?.referenceStatus === "available" ? "not_validated" : "invalid";
  if (model.referenceStatus.artifact !== "available" || model.referenceStatus.build !== "available" || (projector !== undefined && projector.referenceStatus !== "available")) { model.enabled = false; model.validationStatus = "invalid"; } else model.validationStatus = "not_validated";
}

function reconcileArtifact(snapshot: Phase15DomainSnapshot, found: DiscoveredModel, artifact: ModelArtifact, metadata: ModelArtifact["metadata"]): void {
  const main = snapshot.configuredModels.some((model) => model.artifactId === artifact.id);
  const projector = snapshot.configuredModels.some((model) => model.projector?.artifactId === artifact.id);
  const kind = metadata?.artifactKind === "unknown" ? found.artifactKindGuess ?? "unknown" : metadata?.artifactKind ?? found.artifactKindGuess ?? "unknown";
  Object.assign(artifact, { referenceStatus: "available", discoveryId: found.id, discoveredAt: found.detectedAt, updatedAt: found.detectedAt, metadata: metadata && { ...metadata, artifactId: artifact.id } });
  if (!main && !projector) artifact.kind = kind;
}

function reconcileBuild(snapshot: Phase15DomainSnapshot, found: DiscoveredLlamaCppBuild, fingerprint: string): LlamaCppBuild {
  let build = snapshot.builds.find((entry) => entry.resource.owner.scope === "local" && normalizeLocalResourceLocator(entry.resource.locator) === normalizeLocalResourceLocator(found.folder));
  if (!build) build = snapshot.builds.find((entry) => entry.server.owner.scope === "local" && entry.server.locator === found.serverPath);
  if (!build) {
    const registered = findOrRegisterLegacyBuildInSnapshot(snapshot, found.serverPath!, "available");
    build = snapshot.builds.find((entry) => entry.id === registered.id)!;
  }
  const serverChanged = normalizeLocalResourceLocator(build.server.locator) !== normalizeLocalResourceLocator(found.serverPath!);
  build.resource = { owner: { scope: "local" }, locator: found.folder };
  build.server = { owner: { scope: "local" }, locator: found.serverPath! };
  build.displayName = found.name;
  build.tools = structuredClone(found.tools);
  build.discoveryId = found.id;
  reconcileBuildFingerprintInSnapshot(snapshot, build.id, fingerprint, "Router validation was invalidated because the discovered server executable changed.");
  if (serverChanged && build.staticEvidence) delete build.staticEvidence;
  return build;
}

export async function synchronizeDiscoveryCatalog(dependencies: { fingerprint?: typeof fingerprintServerExecutable } = {}): Promise<{ models: DiscoveredModel[]; builds: DiscoveredLlamaCppBuild[]; brokenBuildCandidates: DiscoveredLlamaCppBuild[] }> {
  const [modelDiscovery, buildDiscovery] = await Promise.all([discoverModels(), discoverLlamaBuilds()]);
  const validBuilds = buildDiscovery.builds.filter((build) => build.status !== "missing" && !!build.serverPath);
  const metadata = await Promise.all(modelDiscovery.models.map(async (model) => [model, await inspectGgufMetadata(model.path, model.id)] as const));
  const fingerprint = dependencies.fingerprint ?? fingerprintServerExecutable;
  const fingerprintResults = await Promise.all(validBuilds.map(async (build) => {
    try { return [build, await fingerprint(build.serverPath)] as const; }
    catch { return [build, undefined] as const; }
  }));
  const availableBuilds = fingerprintResults.filter((entry): entry is readonly [DiscoveredLlamaCppBuild, string] => entry[1] !== undefined).map(([build]) => build);
  const fingerprints = new Map(fingerprintResults.flatMap(([build, value]) => value === undefined ? [] : [[build.id, value] as const]));
  await mutatePhase15Domain((snapshot) => {
    const foundArtifacts = new Set(modelDiscovery.models.map((model) => normalizeLocalResourceLocator(model.path)));
    for (const artifact of snapshot.artifacts.filter((entry) => entry.resource.owner.scope === "local" && !foundArtifacts.has(normalizeLocalResourceLocator(entry.resource.locator)))) artifact.referenceStatus = "missing";
    for (const [model, evidence] of metadata) {
      const artifact = findOrRegisterLocalArtifactInSnapshot(snapshot, model.path, { kind: evidence.artifactKind === "unknown" ? model.artifactKindGuess : evidence.artifactKind, referenceStatus: "available" });
      reconcileArtifact(snapshot, model, snapshot.artifacts.find((entry) => entry.id === artifact.id)!, evidence);
    }
    const foundFolders = new Set(availableBuilds.map((build) => normalizeLocalResourceLocator(build.folder)));
    for (const build of snapshot.builds.filter((entry) => entry.resource.owner.scope === "local" && !foundFolders.has(normalizeLocalResourceLocator(entry.resource.locator)))) {
      build.tools = build.tools.map((tool) => tool.kind === "server" ? { ...tool, exists: false } : tool);
      reconcileBuildFingerprintInSnapshot(snapshot, build.id, undefined);
    }
    for (const build of availableBuilds) reconcileBuild(snapshot, build, fingerprints.get(build.id)!);
    for (const model of snapshot.configuredModels) reconcileConfiguredModel(snapshot, model);
  });
  const unavailableBuilds = fingerprintResults.flatMap(([build, value]) => value === undefined ? [{ ...build, serverPath: "", status: "missing" as const, warnings: [...(build.warnings ?? []), "llama-server became unavailable during catalog synchronization."] }] : []);
  return { models: modelDiscovery.models, builds: availableBuilds, brokenBuildCandidates: [...buildDiscovery.builds.filter((build) => build.status === "missing"), ...unavailableBuilds] };
}
