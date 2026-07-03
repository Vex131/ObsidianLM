import { defineConfig } from "@playwright/test";
import path from "node:path";

const port = 18090;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  globalSetup: "./tests/e2e/global-setup.ts",
  webServer: {
    command: "npm run start",
    url: baseURL,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      OBSIDIANLM_HOST: "127.0.0.1",
      OBSIDIANLM_PORT: `${port}`,
      OBSIDIANLM_DATA_DIR: path.resolve(".tmp", "e2e-data"),
      OBSIDIANLM_LOG_DIR: path.resolve(".tmp", "e2e-logs"),
      LOG_LEVEL: "silent"
    }
  }
});
