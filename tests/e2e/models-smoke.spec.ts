import { expect, test } from "@playwright/test";

const configured = { id: "configured-1", displayName: "Vision configured", routerAlias: "vision", artifactId: "artifact-1", buildId: "build-1", enabled: true, artifact: { id: "artifact-1", resource: { locator: "C:/models/vision.gguf" }, kind: "model" }, build: { displayName: "Build A" }, projector: { resource: { locator: "C:/models/mmproj.gguf" } }, projectorAssociation: { validationStatus: "available" }, projectorCandidates: [{ artifactId: "artifact-mmproj", basis: "filename", confidence: "high" }], validation: { references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] };
const registered = { id: "artifact-1", discoveryId: "discovered-1", resource: { owner: { scope: "local" }, locator: "C:/models/vision.gguf" }, kind: "model", referenceStatus: "available", configuredModelIds: [configured.id] };
const discovered = { id: "discovered-only", name: "Discovered only", path: "C:/models/new.gguf", artifactKindGuess: "model", detectedAt: "2026-08-28T00:00:00Z" };

test("Models separates configured models, registered artifacts, and discovered-only records", async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-token"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); calls.push(`${route.request().method()} ${url.pathname}`);
    if (url.pathname === "/api/configured-models") return route.fulfill({ json: { revision: 1, configuredModels: [configured] } });
    if (url.pathname === "/api/model-artifacts") return route.fulfill({ json: { revision: 1, artifacts: [registered] } });
    if (url.pathname === "/api/discovery/models") return route.fulfill({ json: { models: [discovered], warnings: [], scannedFolders: ["C:/models"], detectedAt: "now" } });
    if (url.pathname === "/api/runtime") return route.fulfill({ json: { state: { status: "running", activeProfileId: null }, routerState: { status: "running", activeBuildId: "build-1", configuredModelStates: [{ configuredModelId: "configured-1", state: "loaded" }] }, warnings: [] } });
    if (url.pathname === "/api/profiles") return route.fulfill({ json: { profiles: [] } });
    return route.fulfill({ json: { ok: true } });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.goto("/#models"); await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  await expect(page.getByText("Vision configured")).toBeVisible(); await expect(page.getByText("loaded")).toBeVisible();
  await page.getByRole("button", { name: "Artifacts" }).click(); await expect(page.getByText("Registered Artifact")).toBeVisible(); await expect(page.getByText("Discovered only")).toBeVisible();
  await page.getByRole("row", { name: /Discovered only/ }).click(); await expect(page.getByRole("button", { name: "Register artifact" })).toBeVisible(); await expect(page.getByRole("link", { name: "New configuration" })).not.toBeVisible();
  await page.getByRole("row", { name: /Registered Artifact/ }).click(); await expect(page.getByRole("link", { name: "New configuration" })).toBeVisible(); await expect(page.getByText("configured-1")).toBeVisible();
  expect(calls.some(call => /^(POST|PATCH|PUT|DELETE) \/api\/profiles(?:\/|$)/.test(call))).toBe(false);
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1366, height: 850 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) { await page.setViewportSize(viewport); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  expect(errors).toEqual([]);
});
