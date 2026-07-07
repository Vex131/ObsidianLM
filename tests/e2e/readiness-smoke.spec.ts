import { expect, test, type Page } from "@playwright/test";

async function collectConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    errors.push(error.message);
  });
  return errors;
}

test.describe("operator shell smoke", () => {
  test("operator shell loads and backend status API remains reachable", async ({ page, request }) => {
    const consoleErrors = await collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByRole("link", { name: /ObsidianLM dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Dashboard$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Runtime$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Profiles$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Models$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Logs$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Settings$/i })).toBeVisible();

    const response = await request.get("/api/status");
    expect(response.ok()).toBe(true);
    const status = (await response.json()) as { app?: string; service?: string };
    expect(status.app).toBe("ObsidianLM");
    expect(status.service).toBe("running");

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("dashboard readiness", () => {
  test("dashboard sections are visible and status API returns correct app", async ({ page, request }) => {
    const consoleErrors = await collectConsoleErrors(page);

    await page.goto("/#dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Control and monitor your local llama.cpp runtimes with precision.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Restart/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Stop/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Start runtime/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Quick Actions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Active Profile Details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Events" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Health Checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Resource Snapshot" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Performance Log" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Dashboard$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Runtime$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Profiles$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Models$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Builds$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Artifacts$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Logs$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Telemetry$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Settings$/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /^System$/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Open terminal/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Notifications/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open settings/i })).toBeVisible();
    await expect(page.getByLabel("Operator profile")).toBeVisible();

    const statusResponse = await request.get("/api/status");
    expect(statusResponse.ok()).toBe(true);
    const status = (await statusResponse.json()) as { app?: string };
    expect(status.app).toBe("ObsidianLM");

    expect(consoleErrors).toEqual([]);
  });
});
