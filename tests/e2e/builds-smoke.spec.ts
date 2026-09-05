import { expect, test } from "@playwright/test";

const build = { id: "build-1", displayName: "Legacy label", resource: { owner: { scope: "local" }, locator: "C:/builds/valid-build" }, server: { owner: { scope: "local" }, locator: "C:/builds/valid-build/llama-server.exe" }, classification: "custom", tools: [{ kind: "server", exists: true }], managedInferenceEligibility: "not_validated", configuredModelIds: ["model-1"], validationInProgress: false, warnings: [], failures: [] };
const broken = { ...build, id: "build-2", resource: { owner: { scope: "local" }, locator: "C:/builds/broken-build" }, tools: [], configuredModelIds: [] };
const artifact = { resource: { locator: "C:/data/generated/build-1.ini" }, freshness: "unknown" };
test("Builds exposes reachable dependency, validation, preset, launch, and classification controls", async ({ page }) => {
  const calls: string[] = []; let patchBody: unknown;
  await page.route("**/api/**", (route) => { const path = new URL(route.request().url()).pathname, method = route.request().method(); calls.push(`${method} ${path}`); if (method === "PATCH" && path === `/api/builds/${build.id}`) { patchBody = route.request().postDataJSON(); return route.fulfill({ json: {} }); } if (method === "POST" && path.endsWith("/validate-router")) return route.fulfill({ json: { outcome: "eligible", build: { ...build, managedInferenceEligibility: "eligible" } } }); if (path.endsWith("/capabilities")) return route.fulfill({ json: { router: { status: "candidate", missingRequiredFlags: [] } } }); if (path.endsWith("/router-preset/preview")) return route.fulfill({ json: { kind: "model_preset", artifact, content: "[model]", configuredModelIds: ["model-1"] } }); if (method === "POST" && path.endsWith("/router-preset/generate")) return route.fulfill({ json: { kind: "model_preset", artifact: { ...artifact, freshness: "current" }, content: "[model]", configuredModelIds: ["model-1"] } }); if (path.endsWith("/router-launch/preview")) return route.fulfill({ json: { kind: "router_launch", artifact, command: { displayCommand: "llama-server --models-preset C:/data/generated/build-1.ini" } } }); if (path === "/api/builds") return route.fulfill({ json: { revision: "1", builds: [build, broken] } }); if (path === "/api/runtime") return route.fulfill({ json: { state: {}, routerState: { activeBuildId: build.id }, warnings: [] } }); return route.fulfill({ json: {} }); });
  await page.goto("/#builds"); await expect(page.getByRole("row", { name: /valid-build/ })).toHaveCount(1); await expect(page.getByText("Legacy label")).toHaveCount(0); await expect(page.getByText("llama-server.exe not found (possibly broken build)")).toBeVisible();
  await page.getByRole("row", { name: /valid-build/ }).click(); await expect(page.getByText("model-1")).toBeVisible(); await page.getByRole("button", { name: "Inspect static capabilities" }).click(); await expect(page.getByRole("status")).toContainText("Static capabilities inspected."); await page.getByRole("button", { name: "Run router validation" }).click(); await expect(page.getByRole("status")).toContainText("Router validation eligible."); await page.getByRole("button", { name: "Preview router preset" }).click(); await expect(page.getByText("[model]")).toBeVisible(); await expect(page.getByText("llama-server --models-preset")).toBeVisible(); await page.getByRole("button", { name: "Generate router preset" }).click(); await expect(page.getByText("(current)")).toBeVisible();
  await page.getByLabel("Classification").selectOption("official"); await page.getByRole("button", { name: "Save classification" }).click(); await expect(page.getByRole("status")).toContainText("Classification saved."); expect(patchBody).toEqual({ classification: "official" }); expect(calls).toEqual(expect.arrayContaining(["GET /api/builds/build-1/capabilities", "POST /api/builds/build-1/validate-router", "GET /api/builds/build-1/router-preset/preview", "GET /api/builds/build-1/router-launch/preview", "POST /api/builds/build-1/router-preset/generate"]));
});

test("real discovery keeps broken Builds visible but excludes them from Profiles", async ({ page }) => {
  await page.goto("/#builds");
  await expect(page.getByRole("row", { name: /valid-build/ })).toBeVisible();
  const brokenRow = page.getByRole("row", { name: /broken-build/ });
  await expect(brokenRow).toBeVisible();
  await expect(brokenRow).toContainText("llama-server.exe not found (possibly broken build)");

  const profilesBuildsLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/builds" && response.request().method() === "GET" && response.ok()
  );
  await page.goto("/#profiles");
  await profilesBuildsLoaded;
  await expect(page.getByRole("button", { name: "+ New profile" })).toBeVisible();
  const discovered = await page.request.get("/api/builds").then((response) => response.json()) as { builds: Array<{ resource: { locator: string }; tools: Array<{ kind: string; exists: boolean }> }> };
  expect(discovered.builds.some((entry) => entry.resource.locator.endsWith("valid-build") && entry.tools.some((tool) => tool.kind === "server" && tool.exists))).toBe(true);
  expect(discovered.builds.some((entry) => entry.resource.locator.endsWith("broken-build") && entry.tools.some((tool) => tool.kind === "cli" && tool.exists) && !entry.tools.some((tool) => tool.kind === "server" && tool.exists))).toBe(true);
  await page.getByRole("button", { name: "+ New profile" }).click();
  const selector = page.getByLabel("llama.cpp Build");
  await expect(selector).toContainText("valid-build");
  await expect(selector).not.toContainText("broken-build");
  await expect(selector).not.toContainText("llama-server.exe");
});
