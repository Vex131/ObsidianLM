import { expect, test } from "@playwright/test";

const model = {
  id: "model-1", name: "Qwen Tiny", fileName: "Qwen-Tiny-Q4_K_M.gguf", path: "C:/models/Qwen-Tiny-Q4_K_M.gguf", folder: "C:/models",
  extension: ".gguf", sizeBytes: 2_147_483_648, modifiedAt: "2026-08-28T10:00:00.000Z", detectedAt: "2026-08-28T10:01:00.000Z",
  quantizationGuess: "Q4_K_M", familyGuess: "qwen", artifactKindGuess: "unknown", artifactKindSource: "unknown"
};
const projector = {
  id: "projector-1", name: "mmproj-Qwen-Tiny", fileName: "mmproj-Qwen-Tiny-F16.gguf", path: "C:/models/mmproj-Qwen-Tiny-F16.gguf", folder: "C:/models",
  extension: ".gguf", sizeBytes: 33_554_432, modifiedAt: "2026-08-28T09:00:00.000Z", detectedAt: "2026-08-28T10:01:00.000Z",
  familyGuess: "qwen", artifactKindGuess: "mmproj", artifactKindSource: "filename"
};
const profile = { id: "qwen-profile", name: "Qwen coding", runtimeType: "llama.cpp", providerKind: "server", buildPath: "C:/llama/llama-server.exe", modelPath: model.path, host: "127.0.0.1", port: 8085 };

test("Models inspects artifacts and hands an unsaved draft to Profiles", async ({ page }) => {
  let profileWrites = 0;
  await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-token"));
  await page.route("**/api/status", (route) => route.fulfill({ json: { app: "ObsidianLM", service: "running", warnings: [] } }));
  await page.route("**/api/runtime", (route) => route.fulfill({ json: { state: { activeProfileId: profile.id, status: "running" }, warnings: [] } }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: { managedLlamaPort: 8085 } }));
  await page.route("**/api/profiles", async (route) => {
    if (route.request().method() !== "GET") profileWrites += 1;
    await route.fulfill({ json: { profiles: [profile] } });
  });
  await page.route("**/api/discovery/models/usage", (route) => route.fulfill({ json: { usage: [{ artifactId: model.id, profileIds: [profile.id] }], missingProfileIds: [] } }));
  await page.route("**/api/discovery/models/model-1/metadata", (route) => route.fulfill({ json: {
    artifactId: model.id, status: "ready", artifactKind: "model", artifactKindSource: "metadata", version: 3, tensorCount: 42, kvCount: 8,
    displayName: "Qwen Tiny Fixture", architecture: "qwen3", trainedContext: 32768, embeddingLength: 2048, blockCount: 24,
    expertCount: 8, expertUsedCount: 2, isMoE: true, metadata: { "general.type": "model", "general.name": "Qwen Tiny Fixture", "general.architecture": "qwen3", "qwen3.context_length": 32768 }, warnings: []
  } }));
  await page.route("**/api/discovery/models", (route) => route.fulfill({ json: { models: [model, projector], warnings: [], scannedFolders: ["C:/models"], detectedAt: "2026-08-28T10:01:00.000Z" } }));
  await page.route("**/api/discovery/llama-builds", (route) => route.fulfill({ json: { builds: [], warnings: [], scannedFolders: [], detectedAt: "now" } }));

  await page.setViewportSize({ width: 1366, height: 850 });
  await page.goto("/#models");
  await expect(page.getByRole("heading", { name: "Models", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inspect Qwen Tiny" })).toBeVisible();
  await expect(page.getByText("mmproj-Qwen-Tiny", { exact: true })).not.toBeVisible();
  await page.getByPlaceholder("Name, path, architecture").fill("nothing-here");
  await expect(page.getByText("No artifacts match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("button", { name: /Projectors \(1\)/ }).click();
  await expect(page.getByText("mmproj-Qwen-Tiny", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Models \(1\)/ }).click();
  await page.getByRole("button", { name: "Inspect Qwen Tiny" }).click();
  await expect(page.getByText("Qwen Tiny Fixture", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("32,768", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Qwen coding", { exact: true })).toBeVisible();
  await expect(page.getByText(/current managed runtime profile/)).toBeVisible();
  for (const width of [1600, 1366, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.getByRole("complementary", { name: "Artifact inspector" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.getByRole("link", { name: "Configure in Profiles" }).click();
  await expect(page.getByRole("heading", { name: "Profiles", exact: true })).toBeVisible();
  await expect(page.getByLabel("Model")).toHaveValue(model.path);
  await expect(page.getByLabel("Build")).toHaveValue("");
  await expect(page.getByRole("heading", { name: "New local draft" })).toBeVisible();
  expect(profileWrites).toBe(0);

});

test("Profiles accepts an ID-only handoff when metadata overrides a misleading filename hint", async ({ page }) => {
  const misleading = { ...model, fileName: "adapter-Qwen-Tiny.gguf", artifactKindGuess: "adapter", artifactKindSource: "filename" };
  let profileWrites = 0;
  await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-token"));
  await page.route("**/api/status", (route) => route.fulfill({ json: { app: "ObsidianLM", service: "running", warnings: [] } }));
  await page.route("**/api/runtime", (route) => route.fulfill({ json: { state: { activeProfileId: null, status: "stopped" }, warnings: [] } }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: { managedLlamaPort: 8085 } }));
  await page.route("**/api/profiles", async (route) => { if (route.request().method() !== "GET") profileWrites += 1; await route.fulfill({ json: { profiles: [] } }); });
  await page.route("**/api/discovery/models/model-1/metadata", (route) => route.fulfill({ json: { artifactId: model.id, status: "ready", artifactKind: "model", artifactKindSource: "metadata", metadata: { "general.type": "model" }, warnings: [] } }));
  await page.route("**/api/discovery/models", (route) => route.fulfill({ json: { models: [misleading], warnings: [], scannedFolders: ["C:/models"], detectedAt: "now" } }));
  await page.route("**/api/discovery/llama-builds", (route) => route.fulfill({ json: { builds: [], warnings: [], scannedFolders: [], detectedAt: "now" } }));

  await page.goto("/#profiles?model=model-1");
  await expect(page.getByLabel("Model")).toHaveValue(model.path);
  await expect(page.getByLabel("Build")).toHaveValue("");
  await expect(page.getByRole("heading", { name: "New local draft" })).toBeVisible();
  expect(profileWrites).toBe(0);
});
