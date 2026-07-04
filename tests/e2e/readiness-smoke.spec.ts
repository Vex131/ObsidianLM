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

test.describe.serial("Phase 14 operator interface smoke", () => {
  test("first-run setup and focused operator pages render", async ({ page }) => {
    const consoleErrors = await collectConsoleErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Set up admin token" })).toBeVisible();
    await page.getByPlaceholder("Set up admin token").fill(adminToken);
    await page.getByPlaceholder("Repeat admin token").fill(adminToken);
    await page.getByRole("button", { name: "Set up admin token" }).click();

    await expect(page.getByRole("heading", { name: "ObsidianLM operator console" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Runtime status")).toBeVisible();
    await expect(page.getByText("Quick actions").or(page.getByRole("button", { name: "Start runtime" }))).toBeVisible();
    await expect(page.getByRole("heading", { name: "Current launch command" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent Runtime Logs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Runtime facts" })).toBeVisible();

    await page.getByRole("link", { name: "Runtime" }).click();
    await expect(page).toHaveURL(/#runtime$/);
    await expect(page.getByRole("heading", { name: "Control llama.cpp runtime" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start runtime" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop runtime" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Validate" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Startup checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Startup and server output" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Runtime inspector" })).toBeVisible();

    await page.getByRole("link", { name: "Profiles" }).click();
    await expect(page.getByRole("heading", { name: "Manage runtime profiles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Launch configs" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profile editor" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Profile inspector" })).toBeVisible();
    await expect(page.getByText("Change summary")).toBeVisible();

    await page.getByRole("link", { name: "Jobs" }).click();
    await expect(page.getByRole("heading", { name: "Run llama.cpp jobs" })).toBeVisible();
    await expect(page.getByText("Jobs are one-shot tools. They do not start or replace the managed llama.cpp server runtime.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "llama-bench" })).toBeVisible();
    await expect(page.getByText("No llama-bench tool discovered")).toBeVisible();
    await expect(page.getByRole("heading", { name: "llama-perplexity" })).toBeVisible();
    await expect(page.getByText("No llama-perplexity tool discovered")).toBeVisible();

    await page.getByRole("link", { name: "Models" }).click();
    await expect(page.getByRole("heading", { name: "Discovered GGUF models" })).toBeVisible();
    await expect(page.getByText("No .gguf models found in configured folders.")).toBeVisible();

    await page.getByRole("link", { name: "Builds" }).click();
    await expect(page.getByRole("heading", { name: "Discovered builds and tools" })).toBeVisible();
    await expect(page.getByText("No llama-server executable found in configured folders.")).toBeVisible();

    await page.getByRole("link", { name: "Logs" }).click();
    await expect(page.getByRole("heading", { name: "Runtime and service logs" })).toBeVisible();
    await expect(page.getByLabel("Runtime logs")).toBeVisible();

    await page.getByRole("link", { name: "Telemetry" }).click();
    await expect(page.getByRole("heading", { name: "GPU, processes, and ports" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "NVIDIA GPU status" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Detected llama\.cpp-like processes/ })).toBeVisible();

    await page.getByRole("link", { name: "Settings" }).click();
    await expect(page.locator("#model-folders")).toBeVisible();
    await expect(page.locator("#build-folders")).toBeVisible();
    await expect(page.locator("#tool-input-folders")).toBeVisible();

    await page.getByRole("link", { name: "System" }).click();
    await expect(page.getByRole("heading", { name: "Service diagnostics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Setup checklist" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Health and test chat" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("mobile dashboard smoke keeps navigation and runtime status usable", async ({ page }) => {
    const consoleErrors = await collectConsoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#dashboard");
    await expect(page.getByRole("heading", { name: "Enter admin token" })).toBeVisible();
    await page.getByPlaceholder("Enter admin token").fill(adminToken);
    await page.getByRole("button", { name: "Login" }).click();
    await expect(page.getByRole("heading", { name: "ObsidianLM operator console" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Runtime status")).toBeVisible();
    await page.getByRole("link", { name: "Runtime" }).click();
    await expect(page.getByRole("heading", { name: "Control llama.cpp runtime" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start runtime" })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
