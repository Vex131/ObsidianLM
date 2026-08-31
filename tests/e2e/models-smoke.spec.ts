import { expect, test } from "@playwright/test";
const model = { id: "artifact-1", resource: { owner: { scope: "local" }, locator: "C:/models/vision.gguf" }, kind: "model", referenceStatus: "available", configuredModelIds: ["configured-1"], metadata: { displayName: "vision", status: "ready", warnings: [] } };
const projector = { id: "artifact-mmproj", resource: { owner: { scope: "local" }, locator: "C:/models/mmproj.gguf" }, kind: "mmproj", referenceStatus: "available", configuredModelIds: [] };
test("Models is immediately usable and excludes projector artifacts", async ({ page }) => {
  await page.route("**/api/**", (route) => { const path = new URL(route.request().url()).pathname; if (path === "/api/model-artifacts") return route.fulfill({ json: { revision: "1", artifacts: [model, projector] } }); if (path === "/api/configured-models") return route.fulfill({ json: { revision: "1", configuredModels: [] } }); return route.fulfill({ json: {} }); });
  await page.goto("/#models"); await expect(page.getByText("vision", { exact: true })).toBeVisible(); await expect(page.getByText("mmproj.gguf")).toHaveCount(0); await page.getByRole("row", { name: /vision/ }).click(); await expect(page.getByRole("link", { name: "Configure model" })).toBeVisible();
});
