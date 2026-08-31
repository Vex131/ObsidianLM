import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { DiscoveredLlamaCppBuild } from "@obsidianlm/shared";
import {
  getLlamaBuildCapabilities,
  parseLlamaBuildDevices,
  parseLlamaBuildHelp,
  type LlamaBuildProbeRunner,
} from "../src/discovery/llama-build-capabilities.js";
import { createServer } from "../src/server.js";

test("llama build capability parsers preserve unknown flags and conservative devices", () => {
  const help = parseLlamaBuildHelp(
    `Usage: llama-server\n  -c, --ctx-size N   Context size (default: 4096)\n  --future-mode {fast,slow}  New mode; environment variable LLAMA_FUTURE\n  --old-flag         Deprecated legacy switch\n    with wrapped details\n  --custom VALUE     Custom setting\n  --`,
  );
  assert.equal(help.flags.length, 4);
  assert.deepEqual(help.flags[0], {
    canonicalName: "--ctx-size",
    aliases: ["-c", "--ctx-size"],
    valuePlaceholder: "N",
    description: "Context size (default: 4096)",
    defaultText: "4096",
  });
  assert.deepEqual(help.flags[1]?.choices, ["fast", "slow"]);
  assert.equal(help.flags[1]?.environmentAlias, "LLAMA_FUTURE");
  assert.equal(help.flags[2]?.deprecated, true);
  assert.match(help.flags[2]?.description ?? "", /wrapped details/);
  assert.equal(help.flags[3]?.canonicalName, "--custom");
  assert.ok(
    help.warnings.some((warning) => warning.code === "help_parse_partial"),
  );
  assert.deepEqual(
    parseLlamaBuildDevices(
      "Available devices:\nCUDA0: NVIDIA RTX\nVulkan0: AMD Radeon\n  malformed device\n1: AMD GPU",
    ),
    [
      { id: "CUDA0", label: "NVIDIA RTX" },
      { id: "Vulkan0", label: "AMD Radeon" },
      { id: "1", label: "AMD GPU" },
    ],
  );
});

test("capability inspection uses the injected probe runner and caches by executable fingerprint", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-capabilities-"));
  const serverPath = path.join(root, "llama-server");
  await writeFile(serverPath, "fixture", "utf8");
  const build: DiscoveredLlamaCppBuild = {
    id: "fixture-build",
    name: "Fixture",
    folder: root,
    serverPath,
    tools: [],
    detectedAt: new Date(0).toISOString(),
  };
  let calls = 0;
  const runner: LlamaBuildProbeRunner = async (_path, args) => {
    calls += 1;
    if (args[0] === "--help")
      return {
        ok: true,
        stdout: "  --unknown-flag VALUE  Future setting",
        stderr: "",
      };
    if (args[0] === "--list-devices")
      return { ok: true, stdout: "CUDA0: Test GPU", stderr: "" };
    return { ok: true, stdout: "llama.cpp fixture", stderr: "" };
  };
  const manifest = await getLlamaBuildCapabilities(build, runner);
  assert.equal(manifest.status, "ready");
  assert.equal(manifest.flags[0]?.canonicalName, "--unknown-flag");
  assert.equal(manifest.devices[0]?.id, "CUDA0");
  await getLlamaBuildCapabilities(build, runner);
  assert.equal(calls, 3);
});

test("unknown capability build route returns before any executable probe", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "obsidianlm-capability-route-"),
  );
  const dataDir = path.join(root, "data");
  await mkdir(dataDir, { recursive: true });
  const originalDataDir = process.env.OBSIDIANLM_DATA_DIR;
  process.env.OBSIDIANLM_DATA_DIR = dataDir;
  const app = await createServer();
  t.after(async () => {
    await app.close();
    if (originalDataDir === undefined) delete process.env.OBSIDIANLM_DATA_DIR;
    else process.env.OBSIDIANLM_DATA_DIR = originalDataDir;
  });
  const response = await app.inject({
    method: "GET",
    url: "/api/discovery/llama-builds/not-a-build/capabilities",
  });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "not_found");
});
