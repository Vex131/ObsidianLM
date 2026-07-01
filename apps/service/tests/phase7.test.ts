import assert from "node:assert/strict";
import { access, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createServer } from "../src/server.js";
import { ensureAppDirectories, getAppPaths } from "../src/config/paths.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function restoreEnv(t: TestContext): void {
  const originalDataDir = process.env.OBSIDIANLM_DATA_DIR;
  const originalLogDir = process.env.OBSIDIANLM_LOG_DIR;
  const originalLogsDir = process.env.OBSIDIANLM_LOGS_DIR;
  const originalServiceMode = process.env.OBSIDIANLM_SERVICE_MODE;
  const originalNodeEnv = process.env.NODE_ENV;

  t.after(() => {
    setOrDeleteEnv("OBSIDIANLM_DATA_DIR", originalDataDir);
    setOrDeleteEnv("OBSIDIANLM_LOG_DIR", originalLogDir);
    setOrDeleteEnv("OBSIDIANLM_LOGS_DIR", originalLogsDir);
    setOrDeleteEnv("OBSIDIANLM_SERVICE_MODE", originalServiceMode);
    setOrDeleteEnv("NODE_ENV", originalNodeEnv);
  });
}

function setOrDeleteEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function makeFixture() {
  const root = await mkdir(path.join(tmpdir(), `obsidianlm-phase7-${process.pid}-${Date.now()}`), { recursive: true });
  assert.ok(root);
  return {
    root,
    dataDir: path.join(root, "custom-data"),
    logsDir: path.join(root, "custom-logs")
  };
}

test("service-mode path resolver uses project paths by default", (t) => {
  restoreEnv(t);
  delete process.env.OBSIDIANLM_DATA_DIR;
  delete process.env.OBSIDIANLM_LOG_DIR;
  delete process.env.OBSIDIANLM_LOGS_DIR;
  delete process.env.OBSIDIANLM_SERVICE_MODE;

  const paths = getAppPaths();
  assert.equal(paths.serviceMode, false);
  assert.equal(paths.dataDirMode, "project");
  assert.equal(paths.logDirMode, "project");
  assert.equal(paths.dataDir, path.join(repoRoot, "data"));
  assert.equal(paths.logsDir, path.join(repoRoot, "logs"));
});

test("service-mode path resolver uses ProgramData defaults", (t) => {
  restoreEnv(t);
  delete process.env.OBSIDIANLM_DATA_DIR;
  delete process.env.OBSIDIANLM_LOG_DIR;
  delete process.env.OBSIDIANLM_LOGS_DIR;
  process.env.OBSIDIANLM_SERVICE_MODE = "1";

  const paths = getAppPaths();
  assert.equal(paths.serviceMode, true);
  assert.equal(paths.dataDirMode, "programData");
  assert.equal(paths.logDirMode, "programData");
  assert.match(paths.dataDir, /ObsidianLM[\\/]data$/u);
  assert.match(paths.logsDir, /ObsidianLM[\\/]logs$/u);
  assert.match(paths.runtimeLogsDir, /ObsidianLM[\\/]logs[\\/]runtimes$/u);
  assert.match(paths.jobLogsDir, /ObsidianLM[\\/]logs[\\/]jobs$/u);
});

test("environment overrides win over service-mode defaults and directories are created", async (t) => {
  restoreEnv(t);
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_SERVICE_MODE = "1";
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  process.env.OBSIDIANLM_LOG_DIR = fixture.logsDir;

  const paths = getAppPaths();
  assert.equal(paths.dataDirMode, "custom");
  assert.equal(paths.logDirMode, "custom");
  assert.equal(paths.dataDir, fixture.dataDir);
  assert.equal(paths.logsDir, fixture.logsDir);

  await ensureAppDirectories();
  await Promise.all([access(paths.dataDir), access(paths.logsDir), access(paths.runtimeLogsDir), access(paths.jobLogsDir), access(paths.serviceLogsDir)]);
});

test("legacy OBSIDIANLM_LOGS_DIR remains a log-dir override alias", async (t) => {
  restoreEnv(t);
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_SERVICE_MODE = "1";
  delete process.env.OBSIDIANLM_LOG_DIR;
  process.env.OBSIDIANLM_LOGS_DIR = fixture.logsDir;

  const paths = getAppPaths();
  assert.equal(paths.logDirMode, "custom");
  assert.equal(paths.logsDir, fixture.logsDir);
});

test("status response exposes service-mode labels without local paths", async (t) => {
  restoreEnv(t);
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_SERVICE_MODE = "1";
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  process.env.OBSIDIANLM_LOG_DIR = fixture.logsDir;
  process.env.NODE_ENV = "production";

  const app = await createServer();
  t.after(async () => app.close());

  const response = await app.inject({ method: "GET", url: "/api/status" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.serviceMode, true);
  assert.equal(body.runningMode, "windowsService");
  assert.equal(body.dataDirMode, "custom");
  assert.equal(body.logDirMode, "custom");
  assert.equal(JSON.stringify(body).includes(fixture.root), false);
});

test("Windows service scripts and template stay wrapper-local and machine-neutral", async () => {
  const rootPackage = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  for (const scriptName of ["service:install", "service:uninstall", "service:start", "service:stop", "service:restart", "service:status"]) {
    assert.match(rootPackage.scripts[scriptName], /^powershell -NoProfile -ExecutionPolicy Bypass -File scripts\/windows\//u);
  }

  const scriptDir = path.join(repoRoot, "scripts", "windows");
  const files = ["common-service.ps1", "install-service.ps1", "uninstall-service.ps1", "start-service.ps1", "stop-service.ps1", "restart-service.ps1", "status-service.ps1", "obsidianlm-service.xml"];
  const contents = await Promise.all(files.map((file) => readFile(path.join(scriptDir, file), "utf8")));
  const allText = contents.join("\n");

  assert.match(allText, /Set-StrictMode -Version Latest/u);
  assert.match(allText, /Assert-ObsidianServiceOwned/u);
  assert.match(allText, /Get-ServiceExecutablePath/u);
  assert.match(allText, /\[string\]::Equals\(\$serviceExecutable, \$script:WrapperExePath/u);
  assert.equal(/StartsWith\(\$script:WrapperExePath/u.test(allText), false);
  assert.match(allText, /ObsidianLM Runtime Manager/u);
  assert.match(allText, /obsidianlm-service\.exe/u);
  assert.match(allText, /OBSIDIANLM_SERVICE_MODE/u);
  assert.match(allText, /OBSIDIANLM_DATA_DIR/u);
  assert.match(allText, /OBSIDIANLM_LOG_DIR/u);
  assert.equal(/C:\\Users\\/u.test(allText), false);
  assert.equal(/Invoke-WebRequest|Start-BitsTransfer|curl\.exe/u.test(allText), false);

  for (const file of ["start-service.ps1", "stop-service.ps1", "restart-service.ps1", "status-service.ps1", "uninstall-service.ps1"]) {
    const text = await readFile(path.join(scriptDir, file), "utf8");
    assert.match(text, /Assert-ObsidianServiceInstalled/u, `${file} must verify ownership before service operations`);
  }
});
