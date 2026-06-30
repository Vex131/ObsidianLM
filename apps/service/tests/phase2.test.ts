import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createServer } from "../src/server.js";

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-service-phase2-"));
  const dataDir = path.join(root, "data");
  const modelDir = path.join(root, "models");
  const nestedModelDir = path.join(modelDir, "qwen");
  const llamaRoot = path.join(root, "llama-builds");
  const llamaBuildDir = path.join(llamaRoot, "llama.cpp-cuda");
  const ignoredBuildDir = path.join(llamaRoot, "tools-only");

  await mkdir(dataDir, { recursive: true });
  await mkdir(nestedModelDir, { recursive: true });
  await mkdir(llamaBuildDir, { recursive: true });
  await mkdir(ignoredBuildDir, { recursive: true });

  const modelPath = path.join(nestedModelDir, "Qwen2.5-7B-Instruct-Q4_K_M.gguf");
  const ignoredModelPath = path.join(modelDir, "notes.txt");
  const serverPath = path.join(llamaBuildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  const cliPath = path.join(llamaBuildDir, process.platform === "win32" ? "llama-cli.exe" : "llama-cli");
  const benchPath = path.join(llamaBuildDir, process.platform === "win32" ? "llama-bench.exe" : "llama-bench");
  const perplexityPath = path.join(llamaBuildDir, process.platform === "win32" ? "llama-perplexity.exe" : "llama-perplexity");
  const benchOnlyPath = path.join(ignoredBuildDir, process.platform === "win32" ? "llama-bench.exe" : "llama-bench");

  await writeFile(modelPath, "fake gguf fixture only", "utf8");
  await writeFile(ignoredModelPath, "not a model", "utf8");
  await writeFile(serverPath, "fake llama-server fixture only", "utf8");
  await writeFile(cliPath, "fake llama-cli fixture only", "utf8");
  await writeFile(benchPath, "fake llama-bench fixture only", "utf8");
  await writeFile(perplexityPath, "fake llama-perplexity fixture only", "utf8");
  await writeFile(benchOnlyPath, "fake llama-bench fixture only", "utf8");

  return { root, dataDir, modelDir, modelPath, llamaRoot, llamaBuildDir, serverPath, cliPath, benchPath, perplexityPath };
}

async function createFixtureApp(t: TestContext) {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;

  const app = await createServer();
  t.after(async () => {
    await app.close();
    delete process.env.OBSIDIANLM_DATA_DIR;
  });

  return { app, fixture };
}

async function saveDiscoveryFolders(app: Awaited<ReturnType<typeof createServer>>, fixture: Awaited<ReturnType<typeof makeFixture>>) {
  return app.inject({
    method: "PATCH",
    url: "/api/settings/discovery-folders",
    payload: {
      modelFolders: [fixture.modelDir],
      llamaCppFolders: [fixture.llamaRoot]
    }
  });
}

test("settings API normalizes and stores discovery folders", async (t) => {
  const { app, fixture } = await createFixtureApp(t);

  const modelFolderWithWhitespace = `  ${fixture.modelDir}  `;
  const llamaFolderWithWhitespace = `  ${fixture.llamaRoot}  `;
  const settingsPatch = await app.inject({
    method: "PATCH",
    url: "/api/settings/discovery-folders",
    payload: {
      modelFolders: [modelFolderWithWhitespace, fixture.modelDir, "", 42],
      llamaCppFolders: [llamaFolderWithWhitespace, fixture.llamaRoot, null]
    }
  });

  assert.equal(settingsPatch.statusCode, 200);
  const patchedSettings = settingsPatch.json();
  assert.deepEqual(patchedSettings.settings.modelFolders, [fixture.modelDir]);
  assert.deepEqual(patchedSettings.settings.llamaCppFolders, [fixture.llamaRoot]);

  const storedSettings = JSON.parse(await readFile(path.join(fixture.dataDir, "settings.json"), "utf8"));
  assert.deepEqual(storedSettings.modelFolders, [fixture.modelDir]);
  assert.deepEqual(storedSettings.llamaCppFolders, [fixture.llamaRoot]);

  const settingsGet = await app.inject({ method: "GET", url: "/api/settings" });
  assert.equal(settingsGet.statusCode, 200);
  assert.deepEqual(settingsGet.json().settings.modelFolders, [fixture.modelDir]);
  assert.deepEqual(settingsGet.json().settings.llamaCppFolders, [fixture.llamaRoot]);
});

test("settings loader tolerates older settings files without discovery folders", async (t) => {
  const fixture = await makeFixture();
  process.env.OBSIDIANLM_DATA_DIR = fixture.dataDir;
  await writeFile(path.join(fixture.dataDir, "settings.json"), JSON.stringify({ uiPort: 8090, managedLlamaPort: 8085, startupMode: "service_only", staleProcessPolicy: "auto_stop_previous_managed_only" }), "utf8");

  const app = await createServer();
  t.after(async () => {
    await app.close();
    delete process.env.OBSIDIANLM_DATA_DIR;
  });

  const settingsGet = await app.inject({ method: "GET", url: "/api/settings" });
  assert.equal(settingsGet.statusCode, 200);
  assert.deepEqual(settingsGet.json().settings.modelFolders, []);
  assert.deepEqual(settingsGet.json().settings.llamaCppFolders, []);

  const modelsResponse = await app.inject({ method: "GET", url: "/api/discovery/models" });
  assert.equal(modelsResponse.statusCode, 200);
  assert.deepEqual(modelsResponse.json().models, []);
});

test("model discovery API scans configured folders for fake GGUF files", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const settingsPatch = await saveDiscoveryFolders(app, fixture);
  assert.equal(settingsPatch.statusCode, 200);

  const modelsResponse = await app.inject({ method: "GET", url: "/api/discovery/models" });
  assert.equal(modelsResponse.statusCode, 200);
  const modelsBody = modelsResponse.json();
  assert.deepEqual(modelsBody.scannedFolders, [fixture.modelDir]);
  assert.deepEqual(modelsBody.warnings, []);
  assert.equal(modelsBody.models.length, 1);
  assert.equal(modelsBody.models[0].path, fixture.modelPath);
  assert.equal(modelsBody.models[0].fileName, path.basename(fixture.modelPath));
  assert.equal(modelsBody.models[0].extension, ".gguf");
  assert.equal(modelsBody.models[0].quantizationGuess, "Q4_K_M");
  assert.equal(modelsBody.models[0].familyGuess, "qwen");
});

test("llama.cpp build discovery API returns fake builds that contain llama-server", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const settingsPatch = await saveDiscoveryFolders(app, fixture);
  assert.equal(settingsPatch.statusCode, 200);

  const buildsResponse = await app.inject({ method: "GET", url: "/api/discovery/llama-builds" });
  assert.equal(buildsResponse.statusCode, 200);
  const buildsBody = buildsResponse.json();
  assert.deepEqual(buildsBody.scannedFolders, [fixture.llamaRoot]);
  assert.deepEqual(buildsBody.warnings, []);
  assert.equal(buildsBody.builds.length, 1);
  assert.equal(buildsBody.builds[0].folder, fixture.llamaBuildDir);
  assert.equal(buildsBody.builds[0].serverPath, fixture.serverPath);
  assert.deepEqual(
    buildsBody.builds[0].tools.map((tool: { kind: string; path: string }) => [tool.kind, tool.path]),
    [
      ["cli", fixture.cliPath],
      ["bench", fixture.benchPath],
      ["perplexity", fixture.perplexityPath],
      ["server", fixture.serverPath]
    ].sort((a, b) => a[0].localeCompare(b[0]))
  );
});

test("discovery APIs warn for missing configured folders without crashing", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const missingModelDir = path.join(fixture.root, "missing-models");
  const missingBuildDir = path.join(fixture.root, "missing-builds");
  const settingsPatch = await app.inject({
    method: "PATCH",
    url: "/api/settings/discovery-folders",
    payload: {
      modelFolders: [missingModelDir],
      llamaCppFolders: [missingBuildDir]
    }
  });
  assert.equal(settingsPatch.statusCode, 200);

  const modelsResponse = await app.inject({ method: "GET", url: "/api/discovery/models" });
  assert.equal(modelsResponse.statusCode, 200);
  assert.deepEqual(modelsResponse.json().models, []);
  assert.equal(modelsResponse.json().warnings[0].code, "folder_missing");

  const buildsResponse = await app.inject({ method: "GET", url: "/api/discovery/llama-builds" });
  assert.equal(buildsResponse.statusCode, 200);
  assert.deepEqual(buildsResponse.json().builds, []);
  assert.equal(buildsResponse.json().warnings[0].code, "folder_missing");
});

test("profile creation API persists a llama.cpp profile from discovered fake paths", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const settingsPatch = await saveDiscoveryFolders(app, fixture);
  assert.equal(settingsPatch.statusCode, 200);

  const modelsResponse = await app.inject({ method: "GET", url: "/api/discovery/models" });
  const buildsResponse = await app.inject({ method: "GET", url: "/api/discovery/llama-builds" });
  const modelsBody = modelsResponse.json();
  const buildsBody = buildsResponse.json();

  const createProfile = await app.inject({
    method: "POST",
    url: "/api/discovery/profiles",
    payload: {
      name: "Qwen local test profile",
      modelPath: modelsBody.models[0].path,
      buildPath: buildsBody.builds[0].serverPath,
      host: "127.0.0.1",
      port: 8181,
      llamaArgs: { ctxSize: 4096, gpuLayers: 0 },
      extraArgs: ["--verbose"]
    }
  });

  assert.equal(createProfile.statusCode, 201);
  const createdProfile = createProfile.json();
  assert.equal(createdProfile.validation.valid, true);
  assert.deepEqual(createdProfile.validation.errors, []);
  assert.equal(createdProfile.profile.id, "qwen-local-test-profile");
  assert.equal(createdProfile.profile.modelPath, fixture.modelPath);
  assert.equal(createdProfile.profile.buildPath, fixture.serverPath);
  assert.equal(createdProfile.profile.host, "127.0.0.1");
  assert.equal(createdProfile.profile.port, 8181);
  assert.equal(createdProfile.profile.llamaArgs.ctxSize, 4096);
  assert.equal(createdProfile.profile.llamaArgs.gpuLayers, 0);
  assert.deepEqual(createdProfile.profile.extraArgs, ["--verbose"]);
  assert.equal(createdProfile.command.executable, fixture.serverPath);
  assert.ok(createdProfile.command.args.includes(fixture.modelPath));

  const profilesGet = await app.inject({ method: "GET", url: "/api/profiles" });
  assert.equal(profilesGet.statusCode, 200);
  assert.equal(profilesGet.json().profiles.length, 1);
  assert.equal(profilesGet.json().profiles[0].id, "qwen-local-test-profile");

  const duplicateProfile = await app.inject({
    method: "POST",
    url: "/api/discovery/profiles",
    payload: {
      name: "Qwen local test profile",
      modelPath: fixture.modelPath,
      buildPath: fixture.serverPath
    }
  });
  assert.equal(duplicateProfile.statusCode, 201);
  assert.notEqual(duplicateProfile.json().profile.id, "qwen-local-test-profile");
  assert.equal(duplicateProfile.json().profile.host, "0.0.0.0");
  assert.equal(duplicateProfile.json().profile.port, 8085);
  assert.equal(duplicateProfile.json().profile.llamaArgs.ctxSize, 8192);
});

test("profile creation API rejects paths that were not discovered from configured folders", async (t) => {
  const { app, fixture } = await createFixtureApp(t);
  const rogueModelDir = path.join(fixture.root, "rogue-models");
  const rogueBuildDir = path.join(fixture.root, "rogue-build");
  await mkdir(rogueModelDir, { recursive: true });
  await mkdir(rogueBuildDir, { recursive: true });
  const rogueModelPath = path.join(rogueModelDir, "Rogue-Q4_K_M.gguf");
  const rogueServerPath = path.join(rogueBuildDir, process.platform === "win32" ? "llama-server.exe" : "llama-server");
  await writeFile(rogueModelPath, "fake rogue model", "utf8");
  await writeFile(rogueServerPath, "fake rogue server", "utf8");

  const settingsPatch = await saveDiscoveryFolders(app, fixture);
  assert.equal(settingsPatch.statusCode, 200);

  const rejectedProfile = await app.inject({
    method: "POST",
    url: "/api/discovery/profiles",
    payload: {
      name: "Rogue profile",
      modelPath: rogueModelPath,
      buildPath: rogueServerPath
    }
  });

  assert.equal(rejectedProfile.statusCode, 400);
  assert.equal(rejectedProfile.json().validation.valid, false);
  assert.ok(rejectedProfile.json().validation.errors.includes("modelPath must match a discovered GGUF model from a configured model folder."));
  assert.ok(rejectedProfile.json().validation.errors.includes("buildPath must match a discovered llama-server executable from a configured llama.cpp folder."));

  const profilesGet = await app.inject({ method: "GET", url: "/api/profiles" });
  assert.equal(profilesGet.statusCode, 200);
  assert.deepEqual(profilesGet.json().profiles, []);
});
