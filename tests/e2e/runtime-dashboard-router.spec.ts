import { expect, test, type Page, type Route } from "@playwright/test";

const now = "2026-08-28T12:00:00.000Z";
const token = "e2e-admin-token";
const builds = [
  { id: "build-a", displayName: "Build A", resource: { owner: { scope: "local" }, locator: "C:/llama/a" }, server: { owner: { scope: "local" }, locator: "C:/llama/a/llama-server.exe" }, classification: "official", tools: [], managedInferenceEligibility: "eligible", configuredModelIds: ["model-a", "model-b"], validationInProgress: false },
  { id: "build-b", displayName: "Build B", resource: { owner: { scope: "local" }, locator: "C:/llama/b" }, server: { owner: { scope: "local" }, locator: "C:/llama/b/llama-server.exe" }, classification: "official", tools: [], managedInferenceEligibility: "eligible", configuredModelIds: ["model-c"], validationInProgress: false }
];
const models = [
  { id: "model-a", displayName: "Model A", routerAlias: "model-a", artifactId: "artifact-a", buildId: "build-a", enabled: true, artifact: { resource: { locator: "C:/models/a.gguf" }, kind: "model" }, build: builds[0], llamaArgs: { ctxSize: 4096, gpuLayers: 12 }, validation: { structural: true, references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] },
  { id: "model-b", displayName: "Model B", routerAlias: "model-b", artifactId: "artifact-b", buildId: "build-a", enabled: true, artifact: { resource: { locator: "C:/models/b.gguf" }, kind: "model" }, build: builds[0], validation: { structural: true, references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] },
  { id: "model-c", displayName: "Model C", routerAlias: "model-c", artifactId: "artifact-c", buildId: "build-b", enabled: true, artifact: { resource: { locator: "C:/models/c.gguf" }, kind: "model" }, build: builds[1], validation: { structural: true, references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] },
  { id: "invalid", displayName: "Disabled invalid model", routerAlias: "invalid", artifactId: "missing", buildId: "build-a", enabled: false, artifact: { resource: { locator: "C:/missing.gguf" }, kind: "model" }, build: builds[0], validation: { structural: true, references: { artifact: "missing", build: "available" }, status: "invalid", managedInferenceEligibility: "ineligible" }, warnings: ["Artifact missing"] }
];

function runtime(status: "running" | "stopped" | "failed" = "running") {
  const running = status === "running";
  return { state: { status, pid: running ? 4321 : null, activeRuntimeId: running ? "router_e2e" : null, startedAt: running ? now : null }, routerState: { stateVersion: 1, activeRuntimeId: running ? "router_e2e" : null, activeBuildId: running ? "build-a" : null, pid: running ? 4321 : null, host: running ? "127.0.0.1" : null, port: running ? 8085 : null, startedByObsidianLM: running, ownershipEvidence: running ? "current_process_child" : "unproven", startedAt: running ? now : null, commandHash: running ? "sha256:router-e2e" : null, status, health: { endpoint: "/health", state: running ? "healthy" : "unknown", checkedAt: now }, catalog: { endpoint: "/models", observedAt: now, entries: running ? [{ routerIdentifier: "model-a", alias: "model-a", state: "loaded", ownership: "managed", configuredModelId: "model-a" }] : [], reconciliationState: running ? "reconciled" : "unknown", warnings: [] }, configuredModelStates: [{ configuredModelId: "model-a", state: running ? "loaded" : "unloaded" }, { configuredModelId: "model-b", state: "unloaded" }, { configuredModelId: "model-c", state: "unloaded" }], warnings: [], errors: [], compatibilityProfileId: null }, warnings: [] };
}

async function fixture(page: Page, options: { state?: "running" | "stopped" | "failed"; switchError?: boolean } = {}) {
  await page.addInitScript((value) => localStorage.setItem("obsidianlm.adminToken", value), token);
  let current = runtime(options.state ?? "running");
  const requests: { path: string; method: string; body: unknown }[] = [];
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === "/api/profiles" || path.startsWith("/api/profiles/")) requests.push({ path, method, body: null });
    if (path.startsWith("/api/runtime/") && method !== "GET") requests.push({ path, method, body: route.request().postDataJSON() });
    if (path === "/api/auth/status") return route.fulfill({ json: { configured: true } });
    if (path === "/api/runtime" || path === "/api/runtime/catalog") return route.fulfill({ json: path.endsWith("catalog") ? { routerState: current.routerState } : current });
    if (path === "/api/configured-models") return route.fulfill({ json: { revision: "r1", configuredModels: models } });
    if (path === "/api/builds") return route.fulfill({ json: { revision: "r1", builds } });
    if (path === "/api/runtime/command") return route.fulfill({ json: { command: { executable: builds[0].server.locator, args: ["--models-preset", "C:/generated/router.json", "--models-max", "1", "--models-autoload", "--host", "127.0.0.1", "--port", "8085"], displayCommand: "llama-server --models-preset C:/generated/router.json --models-max 1 --models-autoload --host 127.0.0.1 --port 8085" } } });
    if (path === "/api/runtime/logs") return route.fulfill({ json: { logs: [{ id: 1, sequence: 1, timestamp: now, source: "stdout", stream: "stdout", origin: "runtime_system", message: "system ready" }, { id: 2, sequence: 2, timestamp: now, source: "stdout", stream: "stdout", origin: "router", message: "router listening" }, { id: 3, sequence: 3, timestamp: now, source: "stdout", stream: "stdout", origin: "router_child", configuredModelId: "model-a", routerAlias: "model-a", message: "model child loaded" }], warnings: [] } });
    if (path === "/api/readiness") return route.fulfill({ json: { ok: true, blockingChecks: [], warnings: [], storageWarnings: [], nextActions: [], counts: {}, managedPort: { port: 8085, inUse: current.routerState.status === "running", conflict: false } } });
    if (path === "/api/runtime/health") return route.fulfill({ json: { ok: true, status: "healthy" } });
    if (path === "/api/monitoring/gpu") return route.fulfill({ json: { available: true, warnings: [], summary: { gpuCount: 1, usedMemoryMiB: 100, totalMemoryMiB: 1000, managedRouterGpuMemoryMiB: 10, managedRouterChildrenGpuMemoryMiB: 80, managedRuntimeGpuMemoryMiB: 90, warningsCount: 0 }, gpus: [{ name: "RTX test", memoryUsedMiB: 100, memoryTotalMiB: 1000, utilizationGpuPercent: 20, temperatureGpuC: 50, powerDrawW: 40, powerLimitW: 200, processes: [{ pid: 4321, processName: "llama-server.exe", gpuIndex: 0, usedMemoryMiB: 10, kind: "managed_router", ownership: "proven", reasons: [] }, { pid: 4322, processName: "llama-server.exe", gpuIndex: 0, usedMemoryMiB: 80, kind: "managed_router_child", ownership: "proven", configuredModelId: "model-a", routerAlias: "model-a", reasons: [] }] }] } });
    if (path === "/api/processes/llama") return route.fulfill({ json: { available: true, processes: [{ pid: 4321, name: "managed_router", role: "managed_router", ownership: "proven" }, { pid: 4322, name: "managed_router_child", role: "managed_router_child", ownership: "proven", configuredModelId: "model-a" }, { pid: 9999, name: "unmanaged", role: "unknown", ownership: "unproven" }], warnings: [] } });
    if (path === "/api/status") return route.fulfill({ json: { app: "ObsidianLM", version: "0.15.0", warnings: [], activeRuntime: { status: current.routerState.status, buildId: current.routerState.activeBuildId, pid: current.routerState.pid } } });
    if (path === "/api/settings") return route.fulfill({ json: { settings: { managedLlamaPort: 8085 } } });
    if (path === "/api/runtime/start") { current = runtime("running"); return route.fulfill({ json: { ok: true, message: "Router started", routerState: current.routerState } }); }
    if (path === "/api/runtime/switch-model" && options.switchError) return route.fulfill({ status: 409, json: { error: "model_load_failed", message: "model failed" } });
    if (path === "/api/runtime/switch-model" || path === "/api/runtime/switch-build") return route.fulfill({ json: { ok: true, message: "Model switch requested", routerState: current.routerState } });
    if (path === "/api/runtime/restart" || path === "/api/runtime/stop") return route.fulfill({ json: { ok: true, message: "Router action requested", routerState: current.routerState } });
    return route.fulfill({ json: {} });
  });
  return requests;
}

test.describe("router runtime dashboard contract", () => {
  test("Runtime shows router authority, drawer state, logs, and launch semantics", async ({ page }) => {
    const errors: string[] = []; page.on("console", (m) => m.type() === "error" && errors.push(m.text())); page.on("pageerror", (e) => errors.push(e.message));
    const requests = await fixture(page); await page.goto("/#runtime");
    await expect(page.getByText("Build A").first()).toBeVisible(); await expect(page.getByText("4321").first()).toBeVisible(); await expect(page.getByText("Model A").first()).toBeVisible(); await expect(page.getByText("Active Router Configuration")).toBeVisible(); await expect(page.getByText(/models-preset.*models-max 1.*models-autoload.*--host.*--port/)).toBeVisible();
    await expect(page.getByText("Grounded activity")).toBeVisible(); await expect(page.getByText("Loaded Model A")).toBeVisible(); await expect(page.getByText("runtime_system")).not.toBeVisible(); await expect(page.getByText("system ready")).toBeVisible(); await expect(page.getByText("router listening")).toBeVisible(); await expect(page.getByText("model child loaded")).toBeVisible(); await expect(page.getByText("Queue")).not.toBeVisible(); await expect(page.getByText("Last request")).not.toBeVisible();
    await page.getByRole("button", { name: "Switch model" }).click(); const drawer = page.getByRole("complementary", { name: "Configured model drawer" }); await expect(drawer).toBeVisible(); await expect(drawer.getByText("Build A").first()).toBeVisible(); await expect(drawer.getByText("Text", { exact: true }).first()).toBeVisible(); await expect(drawer.getByText("disabled", { exact: true })).toBeVisible(); await expect(drawer.getByText(/validation invalid; artifact missing/)).toBeVisible();
    await expect(requests.filter((r) => r.path.includes("/profiles"))).toHaveLength(0); expect(errors).toEqual([]);
  });

  test("same-build switch posts only configuredModelId; cross-build confirms and uses switch-build", async ({ page }) => {
    const requests = await fixture(page); await page.goto("/#runtime"); await page.getByRole("button", { name: "Switch model" }).click();
    await page.getByRole("button", { name: /Model B/ }).click(); await page.getByRole("button", { name: "Switch model" }).last().click(); await expect.poll(() => requests.find((r) => r.path === "/api/runtime/switch-model")?.body).toEqual({ configuredModelId: "model-b" });
    await page.getByRole("button", { name: "Switch model" }).click(); await page.getByRole("button", { name: /Model C/ }).click(); page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "Switch build & restart router" }).click(); await expect.poll(() => requests.find((r) => r.path === "/api/runtime/switch-build")?.body).toEqual({ configuredModelId: "model-c" });
    expect(requests.some((r) => r.path.includes("/start") || r.path.includes("/stop"))).toBe(false); expect(requests.filter((r) => r.path.includes("/profiles"))).toHaveLength(0);
  });

  test("Dashboard exposes active router metrics, links stopped state to Runtime, and has no child controls", async ({ page }) => {
    const requests = await fixture(page); await page.goto("/#dashboard");
    await expect(page.getByText("Build A").first()).toBeVisible(); await expect(page.getByText("Model A").first()).toBeVisible(); await expect(page.getByText("4321").first()).toBeVisible(); await expect(page.getByText(/\d+h \d+m \d+s/).first()).toBeVisible(); await expect(page.getByRole("heading", { name: "Active Runtime Details" })).toBeVisible(); await expect(page.getByRole("heading", { name: "Resource Snapshot" })).toBeVisible(); await expect(page.getByText("RTX test")).toBeVisible(); await expect(page.getByText("managed_router_child")).not.toBeVisible(); await expect(page.getByText("/api/profiles")).not.toBeVisible();
    expect(requests.filter((r) => r.path.includes("/profiles"))).toHaveLength(0);
  });

  test("Dashboard stopped state routes model selection to Runtime", async ({ page }) => {
    const requests = await fixture(page, { state: "stopped" }); await page.goto("/#dashboard");
    await expect(page.getByRole("link", { name: /Open Runtime to start/i })).toBeVisible(); await expect(page.getByText("Managed router stopped")).toBeVisible(); await expect(requests.filter((r) => r.path.includes("/profiles"))).toHaveLength(0);
  });

  test("stopped selection starts target build then switches model and exposes failure", async ({ page }) => {
    const requests = await fixture(page, { state: "stopped", switchError: true }); await page.goto("/#runtime"); await page.getByRole("button", { name: "Select model to start" }).click(); await page.getByRole("button", { name: /Model A/ }).click(); await page.getByRole("button", { name: "Start build & load model" }).click(); await expect.poll(() => requests.filter((r) => r.path.includes("/runtime/") && r.method === "POST").map((r) => r.path)).toEqual(["/api/runtime/start", "/api/runtime/switch-model"]); await expect(page.getByText(/Router started, but model load failed/)).toBeVisible();
  });

  for (const [width, height] of [[1600, 900], [1366, 850], [1024, 800], [768, 900], [390, 844], [320, 720]]) test(`no horizontal overflow at ${width}x${height} on Dashboard and Runtime`, async ({ page }) => { await fixture(page); for (const hash of ["#dashboard", "#runtime"]) { await page.setViewportSize({ width, height }); await page.goto(`/${hash}`); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); } });
});
