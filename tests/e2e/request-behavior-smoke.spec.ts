import { expect, test } from "@playwright/test";

test("idle navigation has one cheap status loop and no setup-required request storm", async ({ page }) => {
  test.setTimeout(45_000);
  const statusStarted = new Map<string, number>();
  const statusDurations: number[] = [];
  let statusRequests = 0, statusInFlight = 0, maxStatusInFlight = 0, setupRequiredResponses = 0;

  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/status") return;
    statusRequests += 1;
    statusInFlight += 1;
    maxStatusInFlight = Math.max(maxStatusInFlight, statusInFlight);
    statusStarted.set(request.url(), performance.now());
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 423) setupRequiredResponses += 1;
    if (path !== "/api/status") return;
    statusInFlight -= 1;
    const started = statusStarted.get(response.url());
    if (started !== undefined) statusDurations.push(performance.now() - started);
  });

  await page.goto("/#dashboard");
  for (const label of ["Runtime", "Profiles", "Models", "Builds", "Jobs", "Logs", "Telemetry", "Settings", "System", "Dashboard"]) {
    await page.getByRole("link", { name: new RegExp(`^${label}$`) }).click();
    await expect(page.getByRole("heading", { name: label, exact: true })).toBeVisible();
  }
  await page.waitForTimeout(30_000);

  expect(statusRequests).toBeGreaterThanOrEqual(4);
  expect(statusRequests).toBeLessThanOrEqual(5);
  expect(maxStatusInFlight).toBe(1);
  expect(setupRequiredResponses).toBe(0);
  expect(Math.max(...statusDurations)).toBeLessThan(1_000);
});
