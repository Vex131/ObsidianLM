import { expect, test } from "@playwright/test";

const artifact = { id: "artifact-1", discoveryId: "discovered-model", resource: { owner: { scope: "local" }, locator: "C:/models/vision.gguf" }, kind: "model", referenceStatus: "available", configuredModelIds: ["configured-1"] };
const projector = { id: "artifact-mmproj", discoveryId: "discovered-projector", resource: { owner: { scope: "local" }, locator: "C:/models/mmproj.gguf" }, kind: "mmproj", referenceStatus: "available", configuredModelIds: ["configured-1"] };
const build = { id: "build-1", discoveryId: "discovered-build", displayName: "Fixture llama.cpp", resource: { owner: { scope: "local" }, locator: "C:/llama" }, server: { owner: { scope: "local" }, locator: "C:/llama/llama-server.exe" }, classification: "custom", tools: [], managedInferenceEligibility: "eligible", configuredModelIds: ["configured-1"], validationInProgress: false, staticEvidence: { routerFlags: { status: "candidate" }, warnings: [], assessedAt: "2026-08-28T00:00:00Z" }, functionalEvidence: { state: "eligible", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] } };
const model = { id: "configured-1", displayName: "Vision profile", routerAlias: "vision", artifactId: artifact.id, buildId: build.id, enabled: true, artifact, build, projector, projectorAssociation: { artifactId: projector.id, selection: "explicit", validationStatus: "not_validated" }, projectorCandidates: [{ artifactId: projector.id, basis: "filename", confidence: "high" }], llamaArgs: { ctxSize: 4096 }, flagOverrides: [{ flag: "--legacy-flag", values: ["preserve-me"] }], extraArgs: ["--unsupported-legacy"], warnings: ["Unsupported legacy value preserved."], validation: { structural: true, references: { artifact: "available", build: "available" }, status: "not_validated", managedInferenceEligibility: "eligible" } };

test("Profiles uses configured-model routes, preserves capabilities, and has no legacy host/port controls", async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-token"));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()); const method = route.request().method(); calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { configured: true, authRequired: true } });
    if (url.pathname === "/api/configured-models") return route.fulfill({ json: { revision: 1, configuredModels: [model] } });
    if (url.pathname === "/api/model-artifacts") return route.fulfill({ json: { revision: 1, artifacts: [artifact, projector] } });
    if (url.pathname === "/api/builds") return route.fulfill({ json: { revision: 1, builds: [build] } });
    if (url.pathname === "/api/runtime") return route.fulfill({ json: { state: { status: "running", activeProfileId: null }, routerState: { status: "running", activeBuildId: build.id, configuredModelStates: [{ configuredModelId: model.id, state: "unloaded" }] }, warnings: [] } });
    if (url.pathname.endsWith("/capabilities")) return route.fulfill({ json: { flags: [{ canonicalName: "--ctx-size", aliases: [] }], warnings: [] } });
    if (method === "GET" && url.pathname === "/api/profiles") return route.fulfill({ json: { profiles: [] } });
    if (url.pathname.startsWith("/api/profiles/")) return route.fulfill({ status: 410, json: { error: "legacy route must not be used" } });
    if (method === "POST" && url.pathname.endsWith("/duplicate")) return route.fulfill({ status: 201, json: { model: { ...model, id: "configured-duplicate", routerAlias: "vision-2" } } });
    if (method === "DELETE") return route.fulfill({ json: { deletedId: model.id } });
    return route.fulfill({ json: { model } });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.setViewportSize({ width: 320, height: 720 }); await page.goto("/#profiles");
  await expect(page.getByRole("heading", { name: "Profiles", exact: true })).toBeVisible();
  await expect(page.getByText("vision · Fixture llama.cpp · vision · enabled")).toBeVisible();
  await page.getByRole("button", { name: /Vision profile/ }).click();
  await expect(page.getByText(/Explicit projector: C:\/models\/mmproj.gguf/)).toBeVisible();
  await expect(page.getByText(/Unsupported legacy value preserved/)).toBeVisible();
  await expect(page.getByLabel("Host", { exact: true })).toHaveCount(0); await expect(page.getByLabel("Port", { exact: true })).toHaveCount(0); await expect(page.getByText("Command preview", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Router alias")).toHaveValue("vision");
  await expect(page.getByLabel("Name")).toHaveValue("Vision profile");
  await expect(page.getByText("SERVER")).not.toBeVisible();
  await expect.poll(() => calls.some(call => call.startsWith("GET /api/configured-models"))).toBe(true);
  expect(calls.some(call => /^(POST|PATCH|PUT|DELETE) \/api\/profiles(?:\/|$)/.test(call))).toBe(false);
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1366, height: 850 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) { await page.setViewportSize(viewport); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  expect(errors).toEqual([]);
});
