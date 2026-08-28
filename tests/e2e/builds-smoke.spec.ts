import { expect, test } from "@playwright/test";

const candidate = { id: "build-custom", name: "llama.cpp custom", folder: "C:/builds/custom/build/bin/Release", serverPath: "C:/builds/custom/build/bin/Release/llama-server.exe", discoveryRoot: "C:/builds", buildRootHint: "C:/builds/custom", relativeServerPath: "custom/build/bin/Release/llama-server.exe", detectedAt: "2026-08-28T10:00:00.000Z", tools: [
  { kind: "server", fileName: "llama-server.exe", path: "C:/builds/custom/build/bin/Release/llama-server.exe", exists: true },
  { kind: "cli", fileName: "llama-cli.exe", path: "C:/builds/custom/build/bin/Release/llama-cli.exe", exists: true },
  { kind: "bench", fileName: "llama-bench.exe", path: "C:/builds/custom/build/bin/Release/llama-bench.exe", exists: true }
] };
const legacy = { id: "build-official", name: "llama.cpp official", folder: "C:/builds/official", serverPath: "C:/builds/official/llama-server.exe", discoveryRoot: "C:/builds", buildRootHint: "C:/builds/official", relativeServerPath: "official/llama-server.exe", detectedAt: "2026-08-28T10:00:00.000Z", tools: [{ kind: "server", fileName: "llama-server.exe", path: "C:/builds/official/llama-server.exe", exists: true }] };
const unknown = { id: "build-unknown", name: "llama.cpp b9000", folder: "C:/builds/b9000", serverPath: "C:/builds/b9000/llama-server.exe", discoveryRoot: "C:/builds", buildRootHint: "C:/builds/b9000", relativeServerPath: "b9000/llama-server.exe", detectedAt: "2026-08-28T10:00:00.000Z", tools: [{ kind: "server", fileName: "llama-server.exe", path: "C:/builds/b9000/llama-server.exe", exists: true }] };
const profile = { id: "custom-profile", name: "Qwen custom", runtimeType: "llama.cpp", providerKind: "server", buildPath: candidate.serverPath, modelPath: "C:/models/qwen.gguf", host: "127.0.0.1", port: 8085 };
const routerEvidence = { modelsPreset: true, modelsMax: true, modelsAutoload: true };

test("Builds inspects toolchains and hands an unsaved build draft to Profiles", async ({ page }) => {
  let profileWrites = 0;
  await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-token"));
  await page.route("**/api/status", (route) => route.fulfill({ json: { app: "ObsidianLM", service: "running", warnings: [] } }));
  await page.route("**/api/runtime", (route) => route.fulfill({ json: { state: { activeProfileId: profile.id, status: "running" }, warnings: [] } }));
  await page.route("**/api/settings", (route) => route.fulfill({ json: { managedLlamaPort: 8085 } }));
  await page.route("**/api/profiles", async (route) => { if (route.request().method() !== "GET") profileWrites += 1; await route.fulfill({ json: { profiles: [profile] } }); });
  await page.route("**/api/discovery/models", (route) => route.fulfill({ json: { models: [], warnings: [], scannedFolders: [], detectedAt: "now" } }));
  await page.route("**/api/discovery/llama-builds/usage", (route) => route.fulfill({ json: { usage: [{ buildId: candidate.id, profileIds: [profile.id] }], missingProfileIds: ["missing-profile"] } }));
  await page.route("**/api/discovery/llama-builds", (route) => route.fulfill({ json: { builds: [candidate, legacy, unknown], warnings: [], scannedFolders: ["C:/builds"], detectedAt: "now" } }));
  await page.route("**/api/discovery/llama-builds/build-custom/capabilities", (route) => route.fulfill({ json: { buildId: candidate.id, serverPath: candidate.serverPath, inspectedAt: "2026-08-28T11:00:00.000Z", versionText: "version: 10581 (abcdef1)", versionInfo: { raw: "version: 10581 (abcdef1)", buildNumber: 10581, commit: "abcdef1", compiler: "MSVC 19.44", target: "x86_64-pc-windows-msvc" }, origin: { classification: "custom", source: "path_hint", evidence: ["Build folder naming explicitly indicates a custom build."] }, status: "ready", devices: [{ id: "CUDA0", label: "NVIDIA RTX Fixture" }], backendHints: ["CUDA"], flags: [{ canonicalName: "--models-preset", aliases: ["--models-preset"], valuePlaceholder: "FILE" }, { canonicalName: "--models-max", aliases: ["--models-max"], valuePlaceholder: "N" }, { canonicalName: "--no-models-autoload", aliases: ["--no-models-autoload"] }, { canonicalName: "--flash-attn", aliases: ["--flash-attn"], description: "Flash Attention" }], router: { status: "candidate", evidence: routerEvidence, missingRequiredFlags: [], compatibilityHints: ["Required router CLI options were detected. Functional router startup and API validation remain Phase 15 work."] }, warnings: [] } }));
  await page.route("**/api/discovery/llama-builds/build-official/capabilities", (route) => route.fulfill({ json: { buildId: legacy.id, serverPath: legacy.serverPath, inspectedAt: "2026-08-28T11:01:00.000Z", versionText: "official build b7000", versionInfo: { raw: "official build b7000", buildNumber: 7000 }, origin: { classification: "official", source: "path_hint", evidence: ["Build folder naming explicitly indicates an official package."] }, status: "ready", devices: [{ id: "CPU", label: "CPU" }], backendHints: ["CPU"], flags: [{ canonicalName: "--host", aliases: ["--host"] }], router: { status: "unsupported", evidence: { modelsPreset: false, modelsMax: false, modelsAutoload: false }, missingRequiredFlags: ["--models-preset", "--models-max", "--models-autoload / --no-models-autoload"], compatibilityHints: ["Legacy compatibility candidate."] }, warnings: [] } }));

  await page.goto("/#builds");
  await expect(page.getByRole("heading", { name: "Builds", exact: true })).toBeVisible();
  await expect(page.getByText("Page content will be rebuilt")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Inspect llama.cpp custom" })).toBeVisible();
  await page.getByPlaceholder("Name, path, version, tool, device").fill("b9000");
  await expect(page.getByRole("button", { name: "Inspect llama.cpp b9000" })).toBeVisible();
  await page.getByPlaceholder("Name, path, version, tool, device").fill("");
  await page.getByRole("button", { name: "Inspect llama.cpp custom" }).click();
  await expect(page.getByText("b10581", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("NVIDIA RTX Fixture")).toBeVisible();
  await expect(page.getByText("Static candidate", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Functional router test:/)).toBeVisible();
  await expect(page.getByText("Qwen custom", { exact: true })).toBeVisible();
  await expect(page.getByText("Active runtime build", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect llama.cpp official" }).click();
  const inspector = page.getByRole("complementary", { name: "Build inspector" });
  await expect(inspector.getByText("Legacy candidate", { exact: true })).toBeVisible();
  await expect(inspector.getByText("Official hint", { exact: true })).toBeVisible();
  await page.getByLabel("Origin").selectOption("custom");
  await expect(page.getByRole("button", { name: "Inspect llama.cpp official" })).toHaveCount(0);
  await page.getByLabel("Origin").selectOption("all");
  for (const width of [1600, 1366, 768, 390, 320]) { await page.setViewportSize({ width, height: 850 }); await expect(page.getByRole("complementary", { name: "Build inspector" })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); }
  await page.getByRole("button", { name: "Inspect llama.cpp custom" }).click();
  await page.getByRole("link", { name: "Use in Profiles" }).click();
  await expect(page.getByRole("heading", { name: "Profiles", exact: true })).toBeVisible();
  await expect(page.getByLabel("Build")).toHaveValue(candidate.serverPath);
  await expect(page.getByLabel("Model")).toHaveValue("");
  await expect(page.getByRole("heading", { name: "New local draft" })).toBeVisible();
  expect(profileWrites).toBe(0);
});
