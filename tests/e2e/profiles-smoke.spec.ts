import { expect, test, type Page } from "@playwright/test";

const artifact = { id: "artifact-1", discoveryId: "discovered-model", resource: { owner: { scope: "local" }, locator: "C:/models/vision.gguf" }, kind: "model", role: "base", selectionStatus: "available", referenceStatus: "available", configuredModelIds: ["configured-1"] };
const projector = { id: "artifact-mmproj", discoveryId: "discovered-projector", resource: { owner: { scope: "local" }, locator: "C:/models/mmproj.gguf" }, kind: "mmproj", role: "projector", selectionStatus: "available", referenceStatus: "available", configuredModelIds: ["configured-1"] };
const unknownSupport = { id: "artifact-unknown-support", resource: { owner: { scope: "local" }, locator: "C:/models/unknown-projector.gguf" }, kind: "unknown", role: "unassigned", selectionStatus: "available", referenceStatus: "available", configuredModelIds: [] };
const mismatched = { id: "artifact-mismatched", resource: { owner: { scope: "local" }, locator: "C:/models/mismatched.gguf" }, kind: "model", role: "conflict", selectionStatus: "invalid", referenceStatus: "available", configuredModelIds: [] };
const missing = { id: "artifact-missing", resource: { owner: { scope: "local" }, locator: "C:/models/missing.gguf" }, kind: "model", role: "base", selectionStatus: "invalid", referenceStatus: "missing", configuredModelIds: ["configured-1"] };
const build = { id: "build-1", discoveryId: "discovered-build", displayName: "Fixture llama.cpp", resource: { owner: { scope: "local" }, locator: "C:/roots/llama" }, server: { owner: { scope: "local" }, locator: "C:/roots/llama/llama-server.exe" }, classification: "custom", tools: [{ kind: "server", fileName: "llama-server.exe", path: "C:/roots/llama/llama-server.exe", exists: true }], managedInferenceEligibility: "eligible", configuredModelIds: ["configured-1"], validationInProgress: false, staticEvidence: { routerFlags: { status: "candidate" }, warnings: [], assessedAt: "2026-08-28T00:00:00Z" }, functionalEvidence: { state: "eligible", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] } };
const alternateBuild = { ...build, id: "build-2", discoveryId: "alternate-build", displayName: "Alternate llama.cpp", resource: { owner: { scope: "local" }, locator: "C:/other/llama" }, server: { owner: { scope: "local" }, locator: "C:/other/llama/llama-server.exe" }, configuredModelIds: [] };
const model = { id: "configured-1", displayName: "Vision profile", routerAlias: "vision", artifactId: artifact.id, buildId: build.id, enabled: true, artifact, build, projector, projectorAssociation: { artifactId: projector.id, selection: "explicit", validationStatus: "not_validated" }, projectorCandidates: [{ artifactId: projector.id, basis: "filename", confidence: "high" }], llamaArgs: { ctxSize: 4096 }, flagOverrides: [{ flag: "--legacy-flag", values: ["preserve-me"] }], extraArgs: ["--unsupported-legacy"], warnings: ["Unsupported legacy value preserved."], validation: { structural: true, references: { artifact: "available", build: "available" }, status: "not_validated", managedInferenceEligibility: "eligible" } };

async function mockProfiles(page: Page, calls: string[], previewBodies: Array<Record<string, unknown>>) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    calls.push(`${method} ${url.pathname}`);
    if (method === "GET" && url.pathname === "/api/configured-models") return route.fulfill({ json: { revision: 1, configuredModels: [model] } });
    if (method === "POST" && url.pathname === "/api/configured-models/preview") {
      const request = route.request().postDataJSON() as { draft: { routerAlias: string; llamaArgs: { ctxSize?: number }; buildId: string } };
      previewBodies.push(request as unknown as Record<string, unknown>);
      const context = request.draft.llamaArgs.ctxSize;
      return route.fulfill({ json: {
        preset: { kind: "model_preset", buildId: request.draft.buildId, artifact: { authority: "derived", sourceRevision: `source-${context ?? "inherited"}`, validationState: "valid", freshness: "unknown", warnings: [], errors: [] }, configuredModelIds: [model.id], content: `version = 1\n\n[${request.draft.routerAlias}]\nmodel = C:/models/vision.gguf\n${context ? `ctx-size = ${context}\n` : ""}` },
        launch: { kind: "router_launch", artifact: { authority: "derived", sourceRevision: `source-${context ?? "inherited"}`, validationState: "valid", freshness: "unknown", warnings: [], errors: [] }, command: { displayCommand: `C:/llama/llama-server.exe --models-preset generated/${request.draft.buildId}.ini` }, policy: { modelsMax: 1, modelsAutoload: true } }
      } });
    }
    if (url.pathname === "/api/model-artifacts") return route.fulfill({ json: { revision: 1, artifacts: [artifact, projector, unknownSupport, mismatched, missing] } });
    if (url.pathname === "/api/builds") return route.fulfill({ json: { revision: 1, builds: [build, alternateBuild] } });
    if (url.pathname === "/api/runtime") return route.fulfill({ json: { state: { status: "running", activeProfileId: null }, routerState: { status: "running", activeBuildId: build.id, generatedArtifact: { sourceRevision: "source-4096" }, configuredModelStates: [{ configuredModelId: model.id, state: "unloaded" }] }, warnings: [] } });
    if (url.pathname === `/api/builds/${build.id}/capabilities`) return route.fulfill({ json: { flags: [{ canonicalName: "--ctx-size", aliases: [] }, { canonicalName: "--batch-size", aliases: [] }, { canonicalName: "--custom-mode", aliases: [], valuePlaceholder: "MODE", choices: ["fast", "safe"], description: "Fixture custom mode." }], warnings: [] } });
    if (url.pathname === `/api/builds/${alternateBuild.id}/capabilities`) return route.fulfill({ json: { flags: [{ canonicalName: "--batch-size", aliases: [] }], warnings: [] } });
    if (method === "GET" && url.pathname === "/api/profiles") return route.fulfill({ json: { profiles: [] } });
    if (url.pathname.startsWith("/api/profiles/")) return route.fulfill({ status: 410, json: { error: "legacy route must not be used" } });
    if (method === "POST" && url.pathname.endsWith("/duplicate")) return route.fulfill({ status: 201, json: { model: { ...model, id: "configured-duplicate", routerAlias: "vision-2" } } });
    if (method === "DELETE") return route.fulfill({ json: { deletedId: model.id } });
    return route.fulfill({ json: { model } });
  });
}

test("Profiles uses configured-model routes and presents the reference editor contract", async ({ page }, testInfo) => {
  const calls: string[] = [];
  const previewBodies: Array<Record<string, unknown>> = [];
  const errors: string[] = [];
  await mockProfiles(page, calls, previewBodies);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/#profiles");
  await expect(page.getByRole("heading", { name: "Profiles", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText("vision · 4K context")).toBeVisible();
  await expect(page.getByLabel("Router alias")).toHaveValue("vision");
  await expect(page.getByLabel("Display name")).toHaveValue("Vision profile");
  await expect(page.locator(".resource-grid select").first()).toHaveValue(artifact.id);
  await expect(page.getByLabel("llama.cpp Build")).toHaveValue(build.id);
  await expect(page.getByLabel("Projector / MMProj")).toHaveValue(projector.id);
  await expect(page.locator(".resource-grid select").first()).not.toContainText("unknown-projector");
  await expect(page.locator(".resource-grid select").first()).not.toContainText("mismatched");
  await expect(page.locator(".resource-grid select").first()).not.toContainText("missing");
  await expect(page.getByLabel("Projector / MMProj")).toContainText("mmproj");
  await expect(page.getByLabel("llama.cpp Build")).toContainText("llama · C:/roots");
  await expect(page.getByText("Unsupported legacy value preserved.")).toBeVisible();
  await expect(page.getByText("--legacy-flag", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Host", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Port", { exact: true })).toHaveCount(0);
  for (const heading of ["Validation", "Command Preview", "Change Summary", "Launch Impact"]) await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  await expect(page.getByText("Derived model-preset artifact")).toBeVisible();
  await expect(page.getByText("ctx-size = 4096")).toBeVisible();
  await expect(page.getByLabel("Context size")).toHaveValue("4096");
  await expect(page.getByText("--custom-mode", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("profiles-1600x900.png"), fullPage: true });

  await page.getByLabel("Context size").fill("8192");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await expect(page.locator(".change-panel")).toContainText("Context size");
  await expect(page.locator(".change-panel")).toContainText("4096");
  await expect(page.locator(".change-panel")).toContainText("8192");
  await expect(page.getByText("ctx-size = 8192")).toBeVisible();
  await expect(page.getByText("Required to apply preset changes")).toBeVisible();

  await page.getByLabel("llama.cpp Build").selectOption(alternateBuild.id);
  await expect(page.getByText("Unsupported by selected Build · preserved")).toBeVisible();
  await expect(page.getByText("Requires build switch", { exact: true })).toBeVisible();
  await expect(page.getByText("Required for Build replacement")).toBeVisible();

  await expect.poll(() => calls.some((call) => call === "GET /api/configured-models")).toBe(true);
  await expect.poll(() => previewBodies.length).toBeGreaterThan(1);
  expect(calls.some((call) => /^(POST|PATCH|PUT|DELETE) \/api\/profiles(?:\/|$)/.test(call))).toBe(false);
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1366, height: 850 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (viewport.width >= 768) expect(await page.locator(".profiles-page").evaluate((element) => { element.scrollTop = element.scrollHeight; const reachable = element.scrollHeight <= element.clientHeight || element.scrollTop > 0; element.scrollTop = 0; return reachable; })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`profiles-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});

test("New profile stays sparse until Model and Build resolve capabilities", async ({ page }) => {
  const calls: string[] = [];
  const previewBodies: Array<Record<string, unknown>> = [];
  await mockProfiles(page, calls, previewBodies);
  await page.goto("/#profiles");
  await page.getByRole("button", { name: "+ New profile" }).click();
  await expect(page.getByRole("heading", { name: "New profile", exact: true })).toBeVisible();
  await expect(page.getByLabel("Context size")).toHaveCount(0);
  await expect(page.getByText(/Configuration controls depend on the selected Build capability manifest/)).toBeVisible();
  await page.locator(".choice-grid select").first().selectOption(artifact.id);
  await page.getByLabel("llama.cpp Build").selectOption(build.id);
  await expect(page.getByLabel("Context size")).toBeVisible();
  await expect(page.getByLabel("Context size")).toHaveValue("");
  await expect(page.getByText("Inherited", { exact: true }).first()).toBeVisible();
  await expect.poll(() => previewBodies.some((body) => !(body as { existingId?: string }).existingId && (body as { draft: { llamaArgs: Record<string, unknown> } }).draft.llamaArgs.ctxSize === undefined)).toBe(true);
});
