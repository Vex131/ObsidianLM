import { expect, test, type Page } from "@playwright/test";

const adminToken = "phase13-browser-smoke-token";

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

test.describe.serial("Phase 13 browser smoke", () => {
  test("first-run setup, dashboard readiness, empty discoveries, jobs, and diagnostics render", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Set up admin token" })).toBeVisible();
    await page.getByPlaceholder("Set up admin token").fill(adminToken);
    await page.getByPlaceholder("Repeat admin token").fill(adminToken);
    await page.getByRole("button", { name: "Set up admin token" }).click();

    const consoleErrors = await collectConsoleErrors(page);
    await expect(page.getByRole("heading", { name: /llama\.cpp runtime/i })).toBeVisible();
    await expect(page.getByText("Runtime status")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Setup checklist" })).toBeVisible();
    await expect(page.getByText("Setup incomplete")).toBeVisible();
    await expect(page.getByText("Empty discoveries are expected on a fresh install.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "One-shot job queue" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "llama-bench" })).toBeVisible();
    await expect(page.getByText("No llama-bench tool discovered")).toBeVisible();
    await expect(page.getByRole("heading", { name: "llama-perplexity" })).toBeVisible();
    await expect(page.getByText("No llama-perplexity tool discovered")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Health and test chat" })).toBeVisible();
    await expect(page.getByText("No active managed runtime is running in this service session.")).toBeVisible();
    await expect(page.locator("#model-folders")).toBeVisible();
    await expect(page.locator("#build-folders")).toBeVisible();
    await expect(page.locator("#tool-input-folders")).toBeVisible();
    await expect(page.getByText("No profiles are configured.")).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });

  test("mobile dashboard smoke renders readiness and jobs safely", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Enter admin token" })).toBeVisible();
    await page.getByPlaceholder("Enter admin token").fill(adminToken);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page.getByRole("heading", { name: "Setup checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "One-shot job queue" })).toBeVisible();
    await expect(page.locator("#tool-input-folders")).toBeVisible();
  });
});
