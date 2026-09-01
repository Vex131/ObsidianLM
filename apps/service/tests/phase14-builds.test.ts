import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { defaultSettings } from "@obsidianlm/shared";
import {
  ensureStorageFiles,
  saveSettings,
} from "../src/config/storage.js";
import {
  getLlamaBuildCapabilities,
  parseLlamaBuildDevices,
  parseLlamaBuildVersion,
  type LlamaBuildProbeRunner,
} from "../src/discovery/llama-build-capabilities.js";
import {
  discoverLlamaBuilds,
  maxLlamaBuildResults,
  maxLlamaBuildVisitedDirectories,
} from "../src/discovery/llama-builds.js";
import { createServer } from "../src/server.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase14-builds-"));
  const data = path.join(root, "data");
  const builds = path.join(root, "builds");
  await mkdir(data, { recursive: true });
  await mkdir(builds, { recursive: true });
  const prior = process.env.OBSIDIANLM_DATA_DIR;
  process.env.OBSIDIANLM_DATA_DIR = data;
  t.after(() => {
    if (prior === undefined) delete process.env.OBSIDIANLM_DATA_DIR;
    else process.env.OBSIDIANLM_DATA_DIR = prior;
  });
  return { data, builds };
}

const settingsFor = (folder: string) => ({
  ...defaultSettings,
  llamaCppFolders: [folder],
});
test("build discovery treats immediate children as build candidates and selects root/bin server priority", async (t) => {
  const { builds } = await fixture(t);
  const alpha = path.join(builds, "Alpha-AVX2", "bin");
  const beta = path.join(builds, "Beta", "bin");
  const preferred = path.join(builds, "RootPreferred");
  await mkdir(alpha, { recursive: true });
  await mkdir(beta, { recursive: true });
  await mkdir(path.join(preferred, "bin"), { recursive: true });
  await Promise.all([
    writeFile(path.join(builds, "llama-server.exe"), "stray"),
    writeFile(path.join(alpha, "llama-server"), ""),
    writeFile(path.join(alpha, "llama-cli"), ""),
    writeFile(path.join(alpha, "llama-bench"), ""),
    writeFile(path.join(beta, "llama-server.exe"), ""),
    writeFile(path.join(beta, "llama-perplexity.exe"), ""),
    writeFile(path.join(preferred, "llama-server"), ""),
    writeFile(path.join(preferred, "bin", "llama-server.exe"), ""),
  ]);
  const result = await discoverLlamaBuilds(settingsFor(builds));
  assert.equal(result.builds.length, 3);
  assert.deepEqual(
    result.builds.map((build) => build.name),
    ["Alpha-AVX2", "Beta", "RootPreferred"],
  );
  const alphaBuild = result.builds[0]!;
  assert.equal(alphaBuild.discoveryRoot, builds);
  assert.equal(alphaBuild.buildRootHint, path.join(builds, "Alpha-AVX2"));
  assert.equal(alphaBuild.relativeServerPath, path.join("bin", "llama-server"));
  assert.deepEqual(
    alphaBuild.tools.map((tool) => tool.kind),
    ["server", "bench", "cli"],
  );
  assert.deepEqual(
    result.builds[1]!.tools.map((tool) => tool.kind),
    ["server", "perplexity"],
  );
  assert.equal(result.builds[2]!.serverPath, path.join(preferred, "llama-server"));
  assert.equal(result.builds.some((build) => build.folder === builds), false);
});

test("build discovery enforces depth and result bounds", async (t) => {
  const { builds } = await fixture(t);
  const atDepth = path.join(builds, "a", "b", "c", "d", "e", "f");
  const beyondDepth = path.join(atDepth, "g");
  await mkdir(beyondDepth, { recursive: true });
  await writeFile(path.join(atDepth, "llama-server"), "");
  await writeFile(path.join(beyondDepth, "llama-server"), "");
  for (let index = 0; index < maxLlamaBuildResults + 5; index += 1) {
    const folder = path.join(
      builds,
      `result-${String(index).padStart(3, "0")}`,
    );
    await mkdir(folder);
    await writeFile(path.join(folder, "llama-server"), "");
  }
  const result = await discoverLlamaBuilds(settingsFor(builds));
  assert.equal(result.builds.length, maxLlamaBuildResults);
  assert.ok(
    result.warnings.some(
      (warning) => warning.code === "max_build_results_reached",
    ),
  );
});

test("build discovery enforces the visited-directory bound", async (t) => {
  const { builds } = await fixture(t);
  for (let index = 0; index <= maxLlamaBuildVisitedDirectories; index += 1)
    await mkdir(
      path.join(builds, `directory-${String(index).padStart(5, "0")}`),
    );
  const result = await discoverLlamaBuilds(settingsFor(builds));
  assert.equal(result.builds.length, maxLlamaBuildResults);
});

test("build discovery skips symlinked directories when supported", async (t) => {
  const { builds } = await fixture(t);
  const target = path.join(builds, "target");
  const link = path.join(builds, "linked");
  await mkdir(target);
  await writeFile(path.join(target, "llama-server"), "");
  try {
    await symlink(target, link, "dir");
  } catch {
    t.skip("directory symlink creation is not permitted on this platform");
    return;
  }
  const result = await discoverLlamaBuilds(settingsFor(builds));
  assert.equal(result.builds.length, 1);
  assert.equal(result.builds[0]!.serverPath, path.join(target, "llama-server"));
});

test("a configured build folder remains a library root when it has a stray server", async (t) => {
  const { builds } = await fixture(t);
  await writeFile(path.join(builds, "llama-server.exe"), "");
  const child = path.join(builds, "child");
  await mkdir(child);
  const result = await discoverLlamaBuilds(settingsFor(builds));
  assert.equal(result.builds.length, 1);
  assert.equal(result.builds[0]!.folder, child);
  assert.equal(result.builds[0]!.name, "child");
});

test("build discovery selects one server per candidate and exposes broken candidates", async (t) => {
  const { builds } = await fixture(t);
  const folder = path.join(builds, "dual-server");
  await mkdir(folder);
  await writeFile(path.join(folder, "llama-server"), "");
  await writeFile(path.join(folder, "llama-server.exe"), "");
  await writeFile(path.join(folder, "llama-cli.exe"), "");
  await mkdir(path.join(builds, "broken"));
  const result = await discoverLlamaBuilds(settingsFor(builds));
  assert.equal(result.builds.length, 2);
  assert.equal(
    result.builds.find((build) => build.name === "dual-server")?.serverPath,
    path.join(folder, "llama-server.exe"),
  );
  assert.equal(
    result.builds.find((build) => build.name === "broken")?.status,
    "missing",
  );
});

test("capability parsing provides conservative version, device, origin, backend, and router assessments", async (t) => {
  const { builds } = await fixture(t);
  const serverPath = path.join(builds, "llama-server");
  await writeFile(serverPath, "fixture");
  assert.deepEqual(
    parseLlamaBuildVersion("llama.cpp version 1.2.3 commit abcdef1"),
    {
      raw: "llama.cpp version 1.2.3 commit abcdef1",
      major: 1,
      minor: 2,
      patch: 3,
      commit: "abcdef1",
    },
  );
  assert.deepEqual(
    parseLlamaBuildVersion(
      "version: 10581 (abcdef1)\nbuilt with MSVC 19.44 for x86_64-pc-windows-msvc",
    ),
    {
      raw: "version: 10581 (abcdef1)\nbuilt with MSVC 19.44 for x86_64-pc-windows-msvc",
      buildNumber: 10581,
      commit: "abcdef1",
      compiler: "MSVC 19.44",
      target: "x86_64-pc-windows-msvc",
    },
  );
  assert.deepEqual(
    parseLlamaBuildDevices(
      "[CUDA] CUDA0: NVIDIA RTX\nMetal: Apple GPU\nCUDA0: duplicate",
    ),
    [
      { id: "CUDA0", label: "NVIDIA RTX" },
      { id: "Metal", label: "Apple GPU" },
    ],
  );
  const runner: LlamaBuildProbeRunner = async (_serverPath, args) => {
    if (args[0] === "--version")
      return {
        ok: true,
        stdout: "llama.cpp version 1.2.3 commit abcdef1",
        stderr: "",
      };
    if (args[0] === "--list-devices")
      return { ok: true, stdout: "[CUDA] CUDA0: NVIDIA RTX", stderr: "" };
    return {
      ok: true,
      stdout:
        "  --models-preset FILE\n  --models-max N\n  --no-models-autoload",
      stderr: "",
    };
  };
  const build = {
    id: "build",
    name: "Build",
    folder: builds,
    serverPath,
    tools: [],
    detectedAt: new Date(0).toISOString(),
  };
  const manifest = await getLlamaBuildCapabilities(build, runner);
  assert.equal(manifest.origin.classification, "unknown");
  assert.equal(manifest.router.status, "candidate");
  assert.deepEqual(manifest.backendHints, ["CUDA"]);
  assert.ok(manifest.inspectedAt.length > 0);
  assert.deepEqual(manifest.router.evidence, {
    modelsPreset: true,
    modelsMax: true,
    modelsAutoload: true,
  });
  const failed = await getLlamaBuildCapabilities(
    { ...build, id: "failed", serverPath: path.join(builds, "other-server") },
    async () => ({ ok: false, stdout: "", stderr: "" }),
  );
  assert.equal(failed.router.status, "unknown");
});

test("origin and router classification require explicit executable evidence", async (t) => {
  const { builds } = await fixture(t);
  const cases = [
    {
      name: "llama-official",
      version: "llama.cpp official build",
      help: "  --host HOST",
      origin: "official",
      router: "unsupported",
    },
    {
      name: "llama-custom",
      version: "llama.cpp custom patched build",
      help: "  --models-preset FILE",
      origin: "custom",
      router: "partial",
    },
    {
      name: "llama-plain",
      version: "llama.cpp version: 10581 (abcdef1)",
      help: "  --host HOST",
      origin: "unknown",
      router: "unsupported",
    },
  ] as const;
  for (const item of cases) {
    const folder = path.join(builds, item.name);
    const serverPath = path.join(folder, "llama-server");
    await mkdir(folder);
    await writeFile(serverPath, "fixture");
    const runner: LlamaBuildProbeRunner = async (_path, args) =>
      args[0] === "--version"
        ? { ok: true, stdout: item.version, stderr: "" }
        : args[0] === "--help"
          ? { ok: true, stdout: item.help, stderr: "" }
          : { ok: true, stdout: "", stderr: "" };
    const manifest = await getLlamaBuildCapabilities(
      {
        id: item.name,
        name: item.name,
        folder,
        buildRootHint: folder,
        serverPath,
        tools: [],
        detectedAt: new Date(0).toISOString(),
      },
      runner,
    );
    assert.equal(manifest.origin.classification, item.origin);
    assert.equal(manifest.router.status, item.router);
  }
});
