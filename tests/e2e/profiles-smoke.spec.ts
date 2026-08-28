import { expect, test } from "@playwright/test";

const model = { id: "m1", name: "Tiny model", fileName: "tiny.Q4.gguf", path: "C:/models/tiny.Q4.gguf", folder: "C:/models", extension: ".gguf", sizeBytes: 1048576, modifiedAt: "now", detectedAt: "now", quantizationGuess: "Q4" };
const build = { id: "b1", name: "CPU build", folder: "C:/llama", serverPath: "C:/llama/llama-server.exe", tools: [], detectedAt: "now" };

test("profiles draft is capability-aware and usable at 320px", async ({ page }) => {
  let sawNoValueOverride = false;
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route("**/api/status", (route) => route.fulfill({ json: { app: "ObsidianLM", service: "running", warnings: [] } }));
  await page.route("**/api/runtime", (route) => route.fulfill({ json: { state: { activeProfileId: null, status: "stopped" }, warnings: [] } }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: { managedLlamaPort: 8085 } }));
  await page.route("**/api/profiles", (route) => route.fulfill({ json: { profiles: [] } }));
  await page.route("**/api/discovery/models", (route) => route.fulfill({ json: { models: [model], warnings: [], scannedFolders: ["C:/models"], detectedAt: "now" } }));
  await page.route("**/api/discovery/llama-builds", (route) => route.fulfill({ json: { builds: [build], warnings: [], scannedFolders: ["C:/llama"], detectedAt: "now" } }));
  await page.route("**/api/discovery/llama-builds/b1/capabilities", (route) => route.fulfill({ json: { buildId: "b1", serverPath: build.serverPath, status: "ready", devices: [{ id: "gpu0", label: "GPU 0" }], flags: [
    { canonicalName: "--ctx-size", aliases: ["-c"], valuePlaceholder: "N" },
    { canonicalName: "--n-gpu-layers", aliases: ["-ngl"], valuePlaceholder: "N" },
    { canonicalName: "--split-mode", aliases: ["-sm"], valuePlaceholder: "MODE" },
    { canonicalName: "--tensor-split", aliases: ["-ts"], valuePlaceholder: "LIST" },
    { canonicalName: "--experimental-mode", aliases: [], valuePlaceholder: "VALUE", description: "Build-only option", defaultText: "safe" },
    { canonicalName: "--experimental-toggle", aliases: [], description: "Build-only switch" }
  ], warnings: [] } }));
  await page.route("**/api/profiles/validate-draft", (route) => route.fulfill({ json: { profile: {}, validation: { valid: true, errors: [], warnings: [] } } }));
  await page.route("**/api/profiles/preview-command", async (route) => {
    const body = route.request().postDataJSON() as { llamaArgs?: { ctxSize?: number }; flagOverrides?: Array<{ flag: string; values?: string[] }> };
    expect(body.llamaArgs?.ctxSize).toBeUndefined();
    const toggle = body.flagOverrides?.find((override) => override.flag === "--experimental-toggle");
    if (toggle) sawNoValueOverride = toggle.values === undefined;
    await route.fulfill({ json: { profile: {}, command: { executable: build.serverPath, args: [], displayCommand: "llama-server", commandHash: "x" }, validation: { valid: true, errors: [], warnings: [] } } });
  });

  await page.goto("/#profiles");
  await expect(page.getByLabel("Model")).toBeVisible();
  await expect(page.getByLabel("Build")).toBeVisible();
  await expect(page.getByLabel("Profile name")).not.toBeVisible();
  await page.getByLabel("Model").selectOption(model.path);
  await page.getByLabel("Build").selectOption(build.serverPath);
  await expect(page.getByText("CONTEXT & CACHE")).toBeVisible();
  await page.getByText("Build-specific options").click();
  await expect(page.getByText("--experimental-mode")).toBeVisible();
  await page.getByLabel("--experimental-toggle").selectOption("true");
  await expect.poll(() => sawNoValueOverride).toBe(true);
  await expect(page.getByText("Tensor split")).not.toBeVisible();
  await expect(page.getByText("Draft validation passed.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
