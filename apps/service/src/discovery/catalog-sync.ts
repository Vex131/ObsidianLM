import { createLlamaCppBuildId, type DiscoveredLlamaCppBuild, type DiscoveredModel, type LlamaCppBuild, type ModelArtifact } from "@obsidianlm/shared";
import { findOrRegisterLocalArtifactInSnapshot, mutatePhase15Domain, normalizeLocalResourceLocator, reconcileBuildFingerprintInSnapshot, type Phase15DomainSnapshot } from "../config/phase15-domain.js";
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
  if (artifactRoleMismatch(snapshot, artifact) || projector !== undefined && artifactRoleMismatch(snapshot, projector)) { model.enabled = false; model.validationStatus = "invalid"; return; }
  if (model.referenceStatus.artifact !== "available" || model.referenceStatus.build !== "available" || (projector !== undefined && projector.referenceStatus !== "available")) { model.enabled = false; model.validationStatus = "invalid"; } else model.validationStatus = "not_validated";
}

function reconcileArtifact(snapshot: Phase15DomainSnapshot, found: DiscoveredModel, artifact: ModelArtifact, metadata: ModelArtifact["metadata"]): void {
  const main = snapshot.configuredModels.some((model) => model.artifactId === artifact.id);
  const projector = snapshot.configuredModels.some((model) => model.projector?.artifactId === artifact.id);
  const kind = metadata?.artifactKind === "unknown" ? found.artifactKindGuess ?? "unknown" : metadata?.artifactKind ?? found.artifactKindGuess ?? "unknown";
  const storedMetadata = metadata && Object.fromEntries(Object.entries({ ...metadata, artifactKind: kind, artifactKindSource: metadata.artifactKind === "unknown" && found.artifactKindGuess !== "unknown" ? found.artifactKindSource : metadata.artifactKindSource, artifactId: artifact.id }).filter(([, value]) => value !== undefined));
  Object.assign(artifact, { referenceStatus: "available", discoveryId: found.id, discoveredAt: found.detectedAt, updatedAt: found.detectedAt, metadata: storedMetadata });
  if (!main && !projector) artifact.kind = kind;
}

function artifactRoleMismatch(snapshot: Phase15DomainSnapshot, artifact: ModelArtifact): boolean {
  const kind = artifact.metadata?.artifactKind;
  return kind !== undefined && kind !== "unknown" && (
    kind !== "model" && snapshot.configuredModels.some((model) => model.artifactId === artifact.id)
    || kind !== "mmproj" && snapshot.configuredModels.some((model) => model.projector?.artifactId === artifact.id)
  );
}

function reconcileBuild(snapshot: Phase15DomainSnapshot, found: DiscoveredLlamaCppBuild, fingerprint: string | undefined): LlamaCppBuild {
  let build = snapshot.builds.find((entry) => entry.resource.owner.scope === "local" && normalizeLocalResourceLocator(entry.resource.locator) === normalizeLocalResourceLocator(found.folder));
  if (!build && found.serverPath) build = snapshot.builds.find((entry) => entry.server.owner.scope === "local" && normalizeLocalResourceLocator(entry.server.locator) === normalizeLocalResourceLocator(found.serverPath));
  if (!build) {
    build = {
      schemaVersion: 1,
      id: createLlamaCppBuildId(normalizeLocalResourceLocator(found.folder)),
      displayName: found.name,
      resource: { owner: { scope: "local" }, locator: found.folder },
      server: { owner: { scope: "local" }, locator: found.serverPath || found.folder },
      tools: [],
      classification: "unknown",
      managedInferenceEligibility: "not_validated",
      warnings: [],
      failures: []
    };
    snapshot.builds.push(build);
  }
  const serverChanged = !!found.serverPath && normalizeLocalResourceLocator(build.server.locator) !== normalizeLocalResourceLocator(found.serverPath);
  build.resource = { owner: { scope: "local" }, locator: found.folder };
  if (found.serverPath) build.server = { owner: { scope: "local" }, locator: found.serverPath };
  build.displayName = found.name;
  build.tools = structuredClone(found.tools).map((tool) => tool.kind === "server" && fingerprint === undefined ? { ...tool, exists: false } : tool);
  build.discoveryId = found.id;
  reconcileBuildFingerprintInSnapshot(snapshot, build.id, fingerprint, "Router validation was invalidated because the discovered server executable changed.");
  if (serverChanged || !found.serverPath) delete build.staticEvidence;
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
  const fingerprints = new Map(fingerprintResults.flatMap(([build, value]) => value === undefined ? [] : [[normalizeLocalResourceLocator(build.folder), value] as const]));
  await mutatePhase15Domain((snapshot) => {
    const foundArtifacts = new Set(modelDiscovery.models.map((model) => normalizeLocalResourceLocator(model.path)));
    for (const artifact of snapshot.artifacts.filter((entry) => entry.resource.owner.scope === "local" && !foundArtifacts.has(normalizeLocalResourceLocator(entry.resource.locator)))) artifact.referenceStatus = "missing";
    for (const [model, evidence] of metadata) {
      const existing = snapshot.artifacts.find((artifact) => artifact.resource.owner.scope === "local" && normalizeLocalResourceLocator(artifact.resource.locator) === normalizeLocalResourceLocator(model.path));
      const kind = evidence.artifactKind === "unknown" ? model.artifactKindGuess : evidence.artifactKind;
      const artifact = findOrRegisterLocalArtifactInSnapshot(snapshot, model.path, { ...(existing ? {} : { kind }), referenceStatus: "available" });
      const stored = snapshot.artifacts.find((entry) => entry.id === artifact.id)!;
      reconcileArtifact(snapshot, model, stored, evidence);
      if (artifactRoleMismatch(snapshot, stored)) {
        for (const model of snapshot.configuredModels.filter((entry) => entry.artifactId === stored.id || entry.projector?.artifactId === stored.id)) {
          model.enabled = false;
          model.validationStatus = "invalid";
          const warning = "Artifact metadata conflicts with its configured model role.";
          if (!model.warnings?.includes(warning)) model.warnings = [...(model.warnings ?? []), warning];
        }
      }
    }
    const foundFolders = new Set(buildDiscovery.builds.map((build) => normalizeLocalResourceLocator(build.folder)));
    for (const build of snapshot.builds.filter((entry) => entry.resource.owner.scope === "local" && !foundFolders.has(normalizeLocalResourceLocator(entry.resource.locator)))) {
      build.tools = build.tools.map((tool) => tool.kind === "server" ? { ...tool, exists: false } : tool);
      reconcileBuildFingerprintInSnapshot(snapshot, build.id, undefined);
    }
    for (const build of buildDiscovery.builds) reconcileBuild(snapshot, build, fingerprints.get(normalizeLocalResourceLocator(build.folder)));
    for (const model of snapshot.configuredModels) reconcileConfiguredModel(snapshot, model);
  });
  return { models: modelDiscovery.models, builds: buildDiscovery.builds, brokenBuildCandidates: [] };
}
