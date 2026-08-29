import { expect, test, type Page, type Route } from "@playwright/test";

const token = "e2e-admin-token";
const now = "2026-08-28T12:00:00.000Z";
const model = { id: "artifact-1", name: "Model A", fileName: "model-a.Q4.gguf", path: "C:/models/model-a.Q4.gguf", folder: "C:/models", extension: ".gguf", sizeBytes: 1024, modifiedAt: now, detectedAt: now, quantizationGuess: "Q4", artifactKindGuess: "model" };
const build = { id: "build-a", name: "Build A", folder: "C:/llama/a", serverPath: "C:/llama/a/llama-server.exe", tools: [{ kind: "bench", path: "C:/llama/a/llama-bench.exe", fileName: "llama-bench.exe" }, { kind: "perplexity", path: "C:/llama/a/llama-perplexity.exe", fileName: "llama-perplexity.exe" }], detectedAt: now };
const job = { id: "job-1", type: "llama-bench", status: "completed", createdAt: now, startedAt: now, finishedAt: now, command: "llama-bench [redacted]", executable: "llama-bench.exe", args: [], cwd: null, exitCode: 0, signal: null, logPath: "job.log", resultPath: null, errorMessage: null, selection: { tool: "llama-bench.exe", build: "llama", model: "tiny.Q4.gguf" }, result: { type: "llama-bench", parsed: true, rows: [{ test: "pp512", backend: "CPU", threads: "4", gpuLayers: "0", nPrompt: "512", tokensPerSecond: 42, raw: {} }], warnings: [] } };
const status = { app: "ObsidianLM", version: "0.15.0", runningMode: "development", serviceMode: false, dataDirMode: "project", logDirMode: "project", uiPort: 18090, managedLlamaPort: 8085, warnings: [], detection: { warnings: [], categories: [], ports: [], checkedAt: now }, gpu: { available: true, gpuCount: 1 }, activeRuntime: { status: "running", pid: 1234, buildId: "build-a", apiUrl: "http://127.0.0.1:8085" } };
const runtime = { state: { status: "running", pid: 1234, activeRuntimeId: "router_e2e", startedAt: now }, routerState: { stateVersion: 1, activeRuntimeId: "router_e2e", activeBuildId: "build-a", pid: 1234, host: "127.0.0.1", port: 8085, startedByObsidianLM: true, ownershipEvidence: "current_process_child", startedAt: now, commandHash: "sha256:e2e", status: "running", health: { endpoint: "/health", state: "healthy", checkedAt: now }, catalog: { endpoint: "/models", observedAt: now, entries: [{ routerIdentifier: "model-a", alias: "model-a", state: "loaded", ownership: "managed", configuredModelId: "model-a" }], reconciliationState: "reconciled", warnings: [] }, configuredModelStates: [{ configuredModelId: "model-a", state: "loaded" }, { configuredModelId: "model-b", state: "unloaded" }, { configuredModelId: "model-c", state: "unloaded" }], warnings: [], errors: [], compatibilityProfileId: null }, warnings: [] };
const settings = { settings: { modelFolders: ["C:/models"], llamaCppFolders: ["C:/llama"], toolInputFolders: ["C:/data"], managedLlamaPort: 8085, uiPort: 18090, startupMode: "service_only", staleProcessPolicy: "auto_stop_previous_managed_only", adminTokenHash: null } };
const readiness = { ok: true, blockingChecks: [], warnings: [], storageWarnings: [], nextActions: [], counts: {}, checks: [{ id: "models", label: "Models", status: "pass", message: "Models discovered", count: 1 }] };

async function fixture(page: Page, options: { gpu?: boolean; storedToken?: boolean } = {}) {
  if (options.storedToken !== false) await page.addInitScript(() => localStorage.setItem("obsidianlm.adminToken", "e2e-admin-token"));
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url()); const path = url.pathname;
    if (path === "/api/status") return route.fulfill({ json: status });
    if (path === "/api/auth/status") return route.fulfill({ json: { configured: true } });
    if (path === "/api/settings") return route.fulfill({ json: settings });
    if (path === "/api/readiness") return route.fulfill({ json: readiness });
    if (path === "/api/runtime" || path === "/api/runtime/health") return route.fulfill({ json: path.endsWith("health") ? { ok: true, status: "healthy" } : runtime });
    if (path === "/api/runtime/catalog") return route.fulfill({ json: { catalog: runtime.routerState.catalog, routerState: runtime.routerState } });
    if (path === "/api/runtime/logs") return route.fulfill({ json: { logs: [{ id: 1, sequence: 1, timestamp: now, source: "stdout", stream: "stdout", message: "runtime listening" }], warnings: [] } });
    if (path === "/api/runtime/command") return route.fulfill({ json: { command: { executable: build.serverPath, args: ["--models-preset", "C:/generated/router.json", "--models-max", "1", "--models-autoload", "--host", "127.0.0.1", "--port", "8085"], displayCommand: "llama-server --models-preset C:/generated/router.json --models-max 1 --models-autoload --host 127.0.0.1 --port 8085" } } });
    if (path === "/api/runtime/logs/stream") return route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: log\ndata: ${JSON.stringify({ id: 2, sequence: 2, timestamp: now, source: "system", stream: "system", message: "SSE runtime log" })}\n\n` });
    if (path === "/api/configured-models") return route.fulfill({ json: { revision: 1, configuredModels: [{ id: "model-a", displayName: "Model A", routerAlias: "model-a", artifactId: "artifact-1", buildId: "build-a", enabled: true, artifact: { resource: { locator: model.path }, kind: "model" }, build: { ...build, displayName: "Build A", managedInferenceEligibility: "eligible" }, llamaArgs: { ctxSize: 4096, gpuLayers: 12 }, validation: { structural: true, references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] }, { id: "model-b", displayName: "Model B", routerAlias: "model-b", artifactId: "artifact-2", buildId: "build-a", enabled: true, artifact: { resource: { locator: "C:/models/model-b.gguf" }, kind: "model" }, build: { ...build, displayName: "Build A", managedInferenceEligibility: "eligible" }, validation: { structural: true, references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] }, { id: "model-c", displayName: "Model C", routerAlias: "model-c", artifactId: "artifact-3", buildId: "build-b", enabled: true, artifact: { resource: { locator: "C:/models/model-c.gguf" }, kind: "model" }, build: { ...build, id: "build-b", displayName: "Build B", managedInferenceEligibility: "eligible" }, validation: { structural: true, references: { artifact: "available", build: "available" }, status: "valid", managedInferenceEligibility: "eligible" }, warnings: [] }, { id: "model-invalid", displayName: "Disabled invalid model", routerAlias: "invalid", artifactId: "artifact-4", buildId: "build-a", enabled: false, artifact: { resource: { locator: "C:/missing.gguf" }, kind: "model" }, build: { ...build, displayName: "Build A", managedInferenceEligibility: "eligible" }, validation: { structural: true, references: { artifact: "missing", build: "available" }, status: "invalid", managedInferenceEligibility: "ineligible" }, warnings: [] }] } });
    if (path === "/api/model-artifacts") return route.fulfill({ json: { revision: 1, artifacts: [{ id: "artifact-1", resource: { owner: { scope: "local" }, locator: model.path }, kind: "model", referenceStatus: "available", configuredModelIds: ["model-a"] }] } });
    if (path === "/api/builds") return route.fulfill({ json: { revision: 1, builds: [{ id: "build-a", displayName: "Build A", resource: { owner: { scope: "local" }, locator: build.folder }, server: { owner: { scope: "local" }, locator: build.serverPath }, classification: "official", tools: build.tools, managedInferenceEligibility: "eligible", configuredModelIds: ["model-a", "model-b"], validationInProgress: false }, { id: "build-b", displayName: "Build B", resource: { owner: { scope: "local" }, locator: "C:/llama/b" }, server: { owner: { scope: "local" }, locator: "C:/llama/b/llama-server.exe" }, classification: "official", tools: [], managedInferenceEligibility: "eligible", configuredModelIds: ["model-c"], validationInProgress: false }] } });
    if (path === "/api/discovery/models") return route.fulfill({ json: { models: [model], warnings: [], scannedFolders: ["C:/models"], detectedAt: now } });
    if (path === "/api/discovery/llama-builds") return route.fulfill({ json: { builds: [build], warnings: [], scannedFolders: ["C:/llama"], detectedAt: now } });
    if (path === "/api/discovery/tool-inputs") return route.fulfill({ json: { files: [{ name: "wiki.txt", path: "C:/data/wiki.txt" }], warnings: [], scannedFolders: ["C:/data"] } });
    if (path === "/api/jobs" && route.request().method() === "GET") return route.fulfill({ json: { jobs: [job] } });
    if (path.endsWith("/logs") && path.includes("/jobs/")) return route.fulfill({ json: { logs: ["bench started", "42 tokens/s"] } });
    if (path === "/api/monitoring/gpu") return route.fulfill({ json: options.gpu === false ? { available: false, warnings: [{ message: "nvidia-smi unavailable" }], summary: { gpuCount: 0, usedMemoryMiB: null, totalMemoryMiB: null }, gpus: [], processes: [] } : { available: true, driverVersion: "555", cudaVersion: "12.4", warnings: [], summary: { gpuCount: 1, usedMemoryMiB: 100, totalMemoryMiB: 1000 }, gpus: [{ name: "RTX test", memoryUsedMiB: 100, memoryTotalMiB: 1000, utilizationGpuPercent: 20, temperatureGpuC: 50, powerDrawW: 40, powerLimitW: 200 }], processes: [{ pid: 1234, processName: "llama-server.exe", gpuIndex: 0, usedMemoryMiB: 100, kind: "current_managed_runtime", reasons: ["PID matches the current managed runtime."] }, { pid: 8888, processName: "other.exe", gpuIndex: 0, usedMemoryMiB: 20, kind: "unknown_gpu_process", reasons: ["Not managed by ObsidianLM."] }] } });
    if (path === "/api/monitoring/ports") return route.fulfill({ json: { port: { port: 8085, inUse: true, ownerPid: 1234, detectionMethod: "fixture", warnings: [] }, conflict: false } });
    if (path === "/api/processes/llama") return route.fulfill({ json: { processes: [{ pid: 1234, name: "llama-server.exe", startedAt: now, confidence: "medium", reasons: ["Process resembles llama-server."] }, { pid: 9999, name: "llama-server.exe", startedAt: now, confidence: "low", reasons: ["PID does not match managed runtime."] }], warnings: [], detectionMethod: "fixture" } });
    if (path === "/api/logs/service") return route.fulfill({ json: { logs: [], warnings: [] } });
    if (route.request().method() === "POST" || route.request().method() === "PATCH") return route.fulfill({ json: { ...job, status: "running", message: "ok" } });
    return route.fulfill({ json: {} });
  });
}

test("Phase 14 navigation has exact pages and no Artifacts route", async ({ page }) => {
  await fixture(page); await page.goto("/#dashboard");
  for (const label of ["Dashboard", "Runtime", "Profiles", "Models", "Builds", "Jobs", "Logs", "Telemetry", "Settings", "System"]) {
    await page.getByRole("link", { name: new RegExp(`^${label}$`) }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
    await expect(page.getByText(/placeholder|coming soon|not implemented/i)).not.toBeVisible();
  }
  await expect(page.getByRole("link", { name: /^Artifacts$/ })).not.toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 }); await expect(page.getByRole("link", { name: /^Dashboard$/ })).toBeVisible(); await expect(page.getByRole("link", { name: /^System$/ })).toBeVisible();
});

test("Jobs runs both tools, sends structured controls, cancels, and renders history", async ({ page }) => {
  await fixture(page); const pageErrors: string[] = []; page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/#jobs"); await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
  await page.getByLabel(/Discovered bench tool/).selectOption("build-a|C:/llama/a/llama-bench.exe"); await page.getByLabel("Primary model").selectOption(model.path); await page.getByLabel("Threads").fill("4"); await page.getByRole("button", { name: "Run bench" }).click(); await page.waitForTimeout(100); expect(pageErrors).toEqual([]); await expect(page.getByRole("status").last()).toContainText("Job queued");
  await expect(page.getByText(/pp512 · 42 tok\/s/)).toBeVisible(); await page.getByRole("button", { name: /llama-bench completed/ }).click(); await expect(page.getByText("bench started")).toBeVisible();
  await page.route("**/api/jobs", (route) => route.request().method() === "GET" ? route.fulfill({ json: { jobs: [{ ...job, id: "job-running", status: "running", finishedAt: null }] } }) : route.fallback());
  await page.route("**/api/jobs/job-running/cancel", (route) => route.fulfill({ json: { ok: true, message: "Cancellation requested", job: { ...job, id: "job-running", status: "cancelled" } } }));
  await page.getByRole("button", { name: "Refresh" }).first().click(); await expect(page.getByRole("button", { name: "Cancel current" })).toBeEnabled(); const cancelRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/job-running/cancel")); await page.getByRole("button", { name: "Cancel current" }).click(); await cancelRequest;
  await page.unroute("**/api/jobs"); await page.getByRole("button", { name: "Perplexity" }).click(); await page.getByLabel(/Discovered perplexity tool/).selectOption("build-a|C:/llama/a/llama-perplexity.exe"); await page.getByLabel("Primary model").selectOption(model.path); await page.getByLabel("Discovered dataset").selectOption("C:/data/wiki.txt"); await expect(page.getByRole("button", { name: "Run perplexity" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 720 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("Logs authenticates SSE, filters sources, pauses, and renders jobs/service", async ({ page }) => {
  await fixture(page); let auth = ""; await page.route("**/api/runtime/logs/stream**", async (route) => { auth = route.request().headers().authorization ?? ""; await route.fulfill({ status: 200, contentType: "text/event-stream", body: `event: log\ndata: ${JSON.stringify({ id: 3, sequence: 3, timestamp: now, source: "stdout", stream: "stdout", message: "SSE visible" })}\n\n` }); });
  await page.goto("/#logs"); await expect(page.getByText("SSE visible")).toBeVisible(); expect(auth).toBe(`Bearer ${token}`); expect(page.url()).not.toContain(token); await page.getByRole("button", { name: "Pause" }).click(); await expect(page.getByRole("button", { name: "Resume" })).toBeVisible(); await page.getByRole("button", { name: "Jobs" }).click(); await page.getByLabel("Job").selectOption("job-1"); await expect(page.getByText("42 tokens/s")).toBeVisible(); await page.getByRole("button", { name: "Service" }).click(); await expect(page.getByText("service output")).toBeVisible(); await page.getByRole("button", { name: /Clear visible/ }).click();
});

test("Telemetry shows managed/external processes, meters, port state, and unavailable GPU", async ({ page }) => {
  await fixture(page); await page.setViewportSize({ width: 320, height: 720 }); await page.goto("/#telemetry"); await expect(page.getByText("RTX test")).toBeVisible(); await expect(page.getByText("Managed", { exact: true })).toBeVisible(); await expect(page.getByText("External", { exact: true })).toBeVisible(); await expect(page.getByText(/Port: 8085 · occupied/)).toBeVisible(); await expect(page.getByText("unknown_gpu_process", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: /kill|adopt/i })).toHaveCount(0); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.unrouteAll(); await fixture(page, { gpu: false }); await page.goto("/#telemetry"); await expect(page.getByText("GPU monitoring unavailable")).toBeVisible();
});

test("Settings stores no rendered secret, locks locally, edits folders, and blocks invalid ports", async ({ page }) => {
  await fixture(page, { storedToken: false }); await page.goto("/#settings"); await expect(page.getByText("Browser locked")).toBeVisible(); await page.getByLabel("Admin token").fill(token); await page.getByRole("button", { name: "Unlock / Verify" }).click(); await expect(page.getByText(/stored token is never displayed/i)).toBeVisible(); await expect(page.locator("body")).not.toContainText(token);
  await page.getByRole("textbox", { name: "Model folders 1", exact: true }).fill("C:/new-models"); await page.getByRole("button", { name: "Save discovery folders" }).click(); await expect(page.getByRole("status").last()).toContainText("Discovery folders saved"); await page.getByLabel("Port").fill("70000"); await page.getByRole("button", { name: "Save managed port" }).click(); await expect(page.getByText(/integer from 1 to 65535/)).toBeVisible();
  await page.route("**/api/settings/runtime", (route) => route.fulfill({ status: 409, json: { message: "Stop the managed runtime before changing its managed port." } })); await page.getByLabel("Port").fill("9090"); await page.getByRole("button", { name: "Save managed port" }).click(); await expect(page.getByText(/Stop the managed runtime/)).toBeVisible(); await page.getByRole("button", { name: /Forget token/ }).click(); await expect(page.getByText("This browser is locked")).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("System and Runtime expose readiness, actions, health, command, and safe links", async ({ page }) => {
  await fixture(page); await page.goto("/#system"); await expect(page.getByText("Ready")).toBeVisible(); await expect(page.getByText("Models discovered")).toBeVisible(); await expect(page.getByRole("heading", { name: "Next actions" })).toBeVisible(); await expect(page.getByRole("button", { name: /Run checks/ })).toBeVisible(); await expect(page.locator("body")).not.toContainText("hash");
  await page.goto("/#runtime"); await expect(page.getByLabel("Router control hero").getByText("Router running")).toBeVisible(); await expect(page.getByText("healthy").first()).toBeVisible(); await expect(page.getByRole("heading", { name: "Launch Command" })).toBeVisible(); await expect(page.getByRole("link", { name: "Open full Logs" })).toBeVisible(); await expect(page.getByText("Clean", { exact: true })).not.toBeVisible(); await expect(page.getByText("Force", { exact: true })).not.toBeVisible(); await expect(page.getByText("Check recovery", { exact: true })).not.toBeVisible(); await page.getByRole("button", { name: "Switch model" }).click(); await expect(page.getByRole("complementary", { name: "Configured model drawer" })).toBeVisible();
});

test("navigation keeps one non-overlapping application status poller", async ({ page }) => {
  test.setTimeout(45_000);
  await fixture(page);
  let requests = 0, inFlight = 0, maxInFlight = 0;
  await page.route("**/api/status", async (route) => {
    requests += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 150));
    inFlight -= 1;
    await route.fulfill({ json: status });
  });

  await page.goto("/#dashboard");
  for (const label of ["Runtime", "Profiles", "Models", "Builds", "Jobs", "Logs", "Telemetry", "Settings", "System", "Dashboard"]) {
    await page.getByRole("link", { name: new RegExp(`^${label}$`) }).click();
  }
  await page.waitForTimeout(30_000);

  expect(requests).toBeGreaterThanOrEqual(4);
  expect(requests).toBeLessThanOrEqual(5);
  expect(maxInFlight).toBe(1);
});

test("runtime log stream waits for authoritative setup state and resumes with bounded reconnects", async ({ page }) => {
  test.setTimeout(20_000);
  await fixture(page);
  let configured = false, streamRequests = 0;
  await page.route("**/api/auth/status", (route) => route.fulfill({ json: { configured } }));
  await page.route("**/api/runtime/logs/stream**", (route) => {
    streamRequests += 1;
    return route.fulfill({ status: 200, contentType: "text/event-stream", body: "" });
  });

  await page.goto("/#logs");
  await page.waitForTimeout(2_000);
  expect(streamRequests).toBe(0);
  configured = true;
  await page.waitForTimeout(8_000);
  expect(streamRequests).toBeGreaterThanOrEqual(1);
  expect(streamRequests).toBeLessThanOrEqual(3);
});
