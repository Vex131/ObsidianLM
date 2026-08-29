import { expect, test } from "@playwright/test";

const build = { id: "build-1", discoveryId: "candidate-1", displayName: "Fixture build", resource: { owner: { scope: "local" }, locator: "C:/llama" }, server: { owner: { scope: "local" }, locator: "C:/llama/llama-server.exe" }, classification: "custom", versionInfo: { raw: "b9000" }, tools: [], managedInferenceEligibility: "eligible", configuredModelIds: ["configured-1"], validationInProgress: false, staticEvidence: { assessedAt: "2026-08-28T00:00:00Z", routerFlags: { status: "candidate" }, warnings: [] }, functionalEvidence: { state: "eligible", launchAttempted: true, presetAccepted: true, healthVerified: true, modelsVerified: true, catalogBoundaryVerified: true, requiredBehaviorVerified: true, warnings: [], failures: [] } };
const candidate = { id: "candidate-2", name: "Unregistered build", serverPath: "C:/other/llama-server.exe", folder: "C:/other", tools: [] };
const preview = { artifact: { freshness: "current", validationState: "eligible", sourceRevision: "1", warnings: [], errors: {} }, configuredModelIds: ["configured-1"], content: "[router]\nmodels-max=1" };

test("Builds exposes registration, evidence, router previews, and dependency-safe deletion", async ({ page }) => {
  const calls: string[] = [];
  await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-token"));
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); const method = route.request().method(); calls.push(`${method} ${url.pathname}`);
    if (url.pathname === "/api/auth/status") return route.fulfill({ json: { configured: true, authRequired: true } });
    if (url.pathname === "/api/builds") return route.fulfill({ json: { revision: 1, builds: [build] } });
    if (url.pathname === "/api/discovery/llama-builds") return route.fulfill({ json: { builds: [candidate], warnings: [], scannedFolders: ["C:/"], detectedAt: "now" } });
    if (url.pathname === "/api/runtime") return route.fulfill({ json: { state: { status: "running", activeProfileId: null }, routerState: { status: "running", activeBuildId: "build-1", configuredModelStates: [] }, warnings: [] } });
    if (url.pathname === "/api/profiles") return route.fulfill({ json: { profiles: [] } });
    if (url.pathname.endsWith("/router-preset/preview")) return route.fulfill({ json: preview });
    if (url.pathname.endsWith("/router-launch/preview")) return route.fulfill({ json: { ...preview, policy: { modelsMax: 1, modelsAutoload: false }, command: { displayCommand: "llama-server --models-preset fixture.ini" } } });
    if (url.pathname.endsWith("/capabilities")) return route.fulfill({ json: { flags: [], warnings: [] } });
    if (method === "POST" && url.pathname.endsWith("/validate-router")) return route.fulfill({ json: { outcome: "eligible", build } });
    if (method === "POST" && url.pathname.endsWith("/generate")) return route.fulfill({ json: preview });
    return route.fulfill({ json: { build } });
  });
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message)); page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
  await page.setViewportSize({ width: 320, height: 720 }); await page.goto("/#builds"); await expect(page.getByRole("heading", { name: "Builds", exact: true })).toBeVisible();
  await expect(page.getByText("Yes").first()).toBeVisible(); await page.getByRole("row", { name: /Fixture build/ }).click();
  await expect(page.getByText("Static capability evidence")).toBeVisible(); await expect(page.getByText("Functional evidence")).toBeVisible(); await expect(page.getByText(/Delete is disabled while configured models depend/)).toBeVisible();
  await page.getByRole("button", { name: "Refresh previews" }).click(); await expect(page.getByText("current")).toBeVisible(); await expect(page.getByText(/1 model maximum/)).toBeVisible();
  await page.getByRole("button", { name: "Generate preset" }).click(); await expect(page.getByText("Router preset generated.")).toBeVisible(); await expect(page.getByRole("button", { name: "Delete build" })).toBeDisabled();
  await page.getByRole("button", { name: "Discovery" }).click(); await expect(page.getByRole("row", { name: /Unregistered build.*Candidate/ })).toBeVisible(); await page.getByRole("row", { name: /Unregistered build/ }).click(); await expect(page.getByRole("button", { name: "Register build" })).toBeVisible();
  expect(calls.some(call => /^(POST|PATCH|PUT|DELETE) \/api\/profiles(?:\/|$)/.test(call))).toBe(false);
  for (const viewport of [{ width: 1600, height: 900 }, { width: 1366, height: 850 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 720 }]) { await page.setViewportSize(viewport); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  expect(errors).toEqual([]);
});
