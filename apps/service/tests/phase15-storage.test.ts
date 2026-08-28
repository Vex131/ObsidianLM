import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { LlamaCppProfile } from "@obsidianlm/shared";
import { loadLegacyProfiles, migratePhase15Domain, validatePhase15DomainSnapshot } from "../src/config/phase15-domain.js";
import { createServer } from "../src/server.js";

const profile = (id: string, name: string, modelPath: string, buildPath: string, extra: Partial<LlamaCppProfile> = {}): LlamaCppProfile => ({
  id, name, runtimeType: "llama.cpp", providerKind: "server", modelPath, buildPath, host: "127.0.0.1", port: 18085, ...extra
});

async function fixture(t: test.TestContext) {
  const dir = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase15-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const models = path.join(dir, "models");
  const builds = path.join(dir, "builds");
  await mkdir(models, { recursive: true });
  await mkdir(builds, { recursive: true });
  const model = path.join(models, "shared.gguf");
  const custom = path.join(models, "custom.gguf");
  const build = path.join(builds, "llama-server.exe");
  const otherBuild = path.join(builds, "other-server.exe");
  await Promise.all([writeFile(model, "model"), writeFile(custom, "custom"), writeFile(build, "build"), writeFile(otherBuild, "other")]);
  return { dir, model, custom, build, otherBuild };
}

async function json(dir: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, name), "utf8"));
}

async function names(dir: string, pattern: RegExp): Promise<string[]> {
  return (await readdir(dir)).filter((name) => pattern.test(name));
}

function canonicalJson(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function asV1(snapshot: any): any {
  const v1 = structuredClone(snapshot);
  v1.schemaVersion = 1;
  delete v1.compatibilityBindings;
  const migration = { ...v1.migration, startedAt: undefined, completedAt: undefined, backup: undefined };
  v1.revision = createHash("sha256").update(canonicalJson({ ...v1, revision: undefined, migration })).digest("hex");
  return v1;
}

test("Phase 15 migrates compactly, preserves evidence and custom fields, and is deterministic", async (t) => {
  const f = await fixture(t);
  const alternate = process.platform === "win32" ? f.model.replaceAll("\\", "/").toUpperCase() : f.model;
  const profiles = [
    profile("z", "Duplicate", alternate, f.build, { host: "0.0.0.0", port: 9001, llamaArgs: { ctxSize: 4096 } }),
    profile("a", "Duplicate", f.model, f.build, { llamaArgs: { ctxSize: 16384, tensorSplit: "3,1" }, flagOverrides: [{ flag: "--custom", values: ["one", "two"] }], extraArgs: ["--future", "preserve"] }),
    profile("different-build", "Other", f.model, f.otherBuild),
    profile("missing", "Missing", path.join(f.dir, "missing.gguf"), f.build),
    profile("missing-build", "Missing build", f.model, path.join(f.dir, "missing-server.exe"))
  ];
  const sourceBytes = Buffer.from(JSON.stringify(profiles));
  await writeFile(path.join(f.dir, "profiles.json"), sourceBytes);
  assert.equal(await migratePhase15Domain(f.dir), "migrated");
  const snapshot = await json(f.dir, "phase15-domain.json") as any;
  validatePhase15DomainSnapshot(snapshot);
  assert.equal(snapshot.artifacts.length, 2);
  assert.equal(snapshot.builds.length, 3);
  assert.equal(snapshot.configuredModels.length, 5);
  assert.equal(snapshot.migration.mappings.length, 5);
  const mapping = (id: string) => snapshot.migration.mappings.find((m: any) => m.legacyProfileId === id)!;
  assert.equal(mapping("a").artifactId, mapping("z").artifactId);
  assert.equal(mapping("a").artifactId, mapping("different-build").artifactId);
  assert.equal(mapping("a").buildId, mapping("z").buildId);
  assert.notEqual(mapping("a").buildId, mapping("different-build").buildId);
  const configuredA = snapshot.configuredModels.find((m: any) => m.displayName === "Duplicate" && m.llamaArgs?.ctxSize === 16384)!;
  const configuredMissing = snapshot.configuredModels.find((m: any) => m.displayName === "Missing")!;
  const configuredMissingBuild = snapshot.configuredModels.find((m: any) => m.displayName === "Missing build")!;
  assert.equal(mapping("z").legacyRuntimeEndpoint.port, 9001);
  assert.equal(configuredA.llamaArgs!.ctxSize, 16384);
  assert.deepEqual(configuredA.flagOverrides, [{ flag: "--custom", values: ["one", "two"] }]);
  assert.deepEqual(configuredA.extraArgs, ["--future", "preserve"]);
  assert.equal(configuredMissing.enabled, false);
  assert.equal(configuredMissing.validationStatus, "invalid");
  assert.equal(configuredMissingBuild.enabled, false);
  assert.equal(configuredMissingBuild.referenceStatus.build, "missing");
  assert.equal(snapshot.builds.find((b: any) => b.id === mapping("a").buildId)?.managedInferenceEligibility, "not_validated");
  const duplicateAliases = snapshot.configuredModels.filter((m: any) => m.displayName === "Duplicate").map((m: any) => m.routerAlias);
  assert.equal(duplicateAliases[0], "duplicate");
  assert.notEqual(duplicateAliases[0], duplicateAliases[1]);
  assert.equal(snapshot.configuredModels.some((m: any) => "projector" in m), false);
  const backups = await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/);
  assert.equal(backups.length, 1);
  assert.deepEqual(await readFile(path.join(f.dir, backups[0]!)), sourceBytes);

  await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify([...profiles].reverse()));
  assert.equal(await migratePhase15Domain(f.dir), "already_migrated");
  const repeated = await json(f.dir, "phase15-domain.json");
  assert.deepEqual(repeated, snapshot);
  await rm(path.join(f.dir, "phase15-domain.json"));
  assert.equal(await migratePhase15Domain(f.dir, { now: () => new Date("2030-01-01T00:00:00.000Z") }), "migrated");
  const rebuilt = await json(f.dir, "phase15-domain.json") as any;
  assert.equal(rebuilt.revision, snapshot.revision);
  assert.deepEqual(rebuilt.configuredModels.map((model: any) => [model.id, model.routerAlias]), snapshot.configuredModels.map((model: any) => [model.id, model.routerAlias]));
});

test("Phase 15 v2 ignores changed profiles and does not rewrite or create another backup", async (t) => {
  const f = await fixture(t);
  const source = [profile("one", "One", f.model, f.build)];
  await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify(source));
  await migratePhase15Domain(f.dir);
  const targetBefore = await readFile(path.join(f.dir, "phase15-domain.json"));
  const backupCount = (await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/)).length;
  assert.equal(await migratePhase15Domain(f.dir), "already_migrated");
  assert.deepEqual(await readFile(path.join(f.dir, "phase15-domain.json")), targetBefore);
  assert.equal((await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/)).length, backupCount);
  await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify([profile("two", "Two", f.custom, f.build)]));
  assert.equal(await migratePhase15Domain(f.dir), "already_migrated");
  assert.deepEqual(await readFile(path.join(f.dir, "phase15-domain.json")), targetBefore);
  assert.equal((await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/)).length, backupCount);
});

test("Phase 15 upgrades an exact v1 store atomically and only once", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify([
    profile("one", "One", f.model, f.build, { llamaArgs: { ctxSize: 4096 } }),
    profile("two", "Two", f.custom, f.otherBuild)
  ]));
  await migratePhase15Domain(f.dir);
  const v2 = await json(f.dir, "phase15-domain.json") as any;
  const v1 = asV1(v2);
  const v1Bytes = Buffer.from(`${JSON.stringify(v1, null, 2)}\n`);
  await writeFile(path.join(f.dir, "phase15-domain.json"), v1Bytes);

  await assert.rejects(
    () => migratePhase15Domain(f.dir, { rename: async () => { throw new Error("upgrade rename failed"); } }),
    /upgrade rename failed/u
  );
  assert.deepEqual(await readFile(path.join(f.dir, "phase15-domain.json")), v1Bytes);

  assert.equal(await migratePhase15Domain(f.dir), "migrated");
  const upgraded = await json(f.dir, "phase15-domain.json") as any;
  validatePhase15DomainSnapshot(upgraded);
  assert.equal(upgraded.schemaVersion, 2);
  assert.deepEqual(upgraded.artifacts, v1.artifacts);
  assert.deepEqual(upgraded.configuredModels, v1.configuredModels);
  assert.deepEqual(upgraded.builds, v1.builds);
  assert.deepEqual(upgraded.migration, v1.migration);
  assert.deepEqual(upgraded.compatibilityBindings, v1.migration.mappings.map((mapping: any) => ({
    legacyProfileId: mapping.legacyProfileId,
    configuredModelId: mapping.configuredModelId,
    legacyRuntimeEndpoint: mapping.legacyRuntimeEndpoint
  })));
  assert.ok((await names(f.dir, /^phase15-domain\.json\.schema-v1-upgrade-.*\.bak$/u)).length >= 1);
  const upgradedBytes = await readFile(path.join(f.dir, "phase15-domain.json"));
  assert.equal(await migratePhase15Domain(f.dir), "already_migrated");
  assert.deepEqual(await readFile(path.join(f.dir, "phase15-domain.json")), upgradedBytes);
});

test("Phase 15 backs up malformed or unsupported source and never creates a target", async (t) => {
  for (const [label, content] of [["json", "{"], ["shape", JSON.stringify({ profiles: [] })], ["shape", JSON.stringify([profile("bad", "Bad", "model.gguf", "server.exe", { llamaArgs: { ctxSize: "invalid" } as any })])]] as const) {
    const f = await fixture(t);
    await writeFile(path.join(f.dir, "profiles.json"), content);
    await assert.rejects(() => migratePhase15Domain(f.dir));
    assert.equal(await loadLegacyProfiles(f.dir).then((r) => r.kind), label === "json" ? "invalid_json" : "unsupported_shape");
    const backups = await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/);
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(f.dir, backups[0]!), "utf8"), content);
    await assert.rejects(() => readFile(path.join(f.dir, "phase15-domain.json")), { code: "ENOENT" });
  }
});

test("Phase 15 startup sees malformed legacy storage before forgiving recovery", async (t) => {
  const f = await fixture(t);
  const previousDataDir = process.env.OBSIDIANLM_DATA_DIR;
  const previousLogDir = process.env.OBSIDIANLM_LOG_DIR;
  process.env.OBSIDIANLM_DATA_DIR = f.dir;
  process.env.OBSIDIANLM_LOG_DIR = path.join(f.dir, "logs");
  t.after(() => {
    if (previousDataDir === undefined) delete process.env.OBSIDIANLM_DATA_DIR; else process.env.OBSIDIANLM_DATA_DIR = previousDataDir;
    if (previousLogDir === undefined) delete process.env.OBSIDIANLM_LOG_DIR; else process.env.OBSIDIANLM_LOG_DIR = previousLogDir;
  });
  await writeFile(path.join(f.dir, "profiles.json"), "{ invalid");
  await assert.rejects(() => createServer(), /profiles\.json is invalid JSON/);
  assert.equal(await readFile(path.join(f.dir, "profiles.json"), "utf8"), "{ invalid");
  assert.equal((await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/)).length, 1);
  await assert.rejects(() => readFile(path.join(f.dir, "phase15-domain.json")), { code: "ENOENT" });
});

test("Phase 15 backs up malformed targets, rejects duplicate aliases/cross references, and preserves the old target", async (t) => {
  for (const bad of [
    "{",
    JSON.stringify({ schemaVersion: 99 }),
    JSON.stringify({ schemaVersion: 1, revision: "x", artifacts: [], configuredModels: [{ schemaVersion: 1, id: "m", routerAlias: "same", artifactId: "missing", buildId: "missing" }], builds: [], migration: {} }),
    JSON.stringify({ schemaVersion: 1, revision: "x", artifacts: [], configuredModels: [{ schemaVersion: 1, id: "m1", routerAlias: "same", artifactId: "missing", buildId: "missing" }, { schemaVersion: 1, id: "m2", routerAlias: "same", artifactId: "missing", buildId: "missing" }], builds: [], migration: {} }),
    JSON.stringify({ schemaVersion: 1, revision: "x", artifacts: [], configuredModels: [], builds: [], migration: {} })
  ]) {
    const f = await fixture(t);
    await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify([profile("new", "New", f.model, f.build)]));
    const original = Buffer.from(bad);
    await writeFile(path.join(f.dir, "phase15-domain.json"), bad);
    await assert.rejects(() => migratePhase15Domain(f.dir), /Phase 15 migration/);
    assert.deepEqual(await readFile(path.join(f.dir, "phase15-domain.json")), original);
    assert.equal((await names(f.dir, /^phase15-domain\.json\.corrupt-phase15-.*\.bak$/)).length, 1);
  }

  const f = await fixture(t);
  await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify([
    profile("one", "One", f.model, f.build),
    profile("two", "Two", f.custom, f.build)
  ]));
  await migratePhase15Domain(f.dir);
  const valid = await json(f.dir, "phase15-domain.json") as any;
  const duplicateAlias = structuredClone(valid);
  duplicateAlias.configuredModels[1].routerAlias = duplicateAlias.configuredModels[0].routerAlias;
  assert.throws(() => validatePhase15DomainSnapshot(duplicateAlias), /duplicate IDs or aliases/);
  const brokenReference = structuredClone(valid);
  brokenReference.configuredModels[0].artifactId = "artifact_missing";
  assert.throws(() => validatePhase15DomainSnapshot(brokenReference), /invalid model references/);
  const incompleteModel = structuredClone(valid);
  delete incompleteModel.configuredModels[0].enabled;
  assert.throws(() => validatePhase15DomainSnapshot(incompleteModel), /malformed records/);
  const unsafeMissingModel = structuredClone(valid);
  unsafeMissingModel.artifacts[0].referenceStatus = "missing";
  unsafeMissingModel.configuredModels.find((model: any) => model.artifactId === unsafeMissingModel.artifacts[0].id).referenceStatus.artifact = "missing";
  assert.throws(() => validatePhase15DomainSnapshot(unsafeMissingModel), /inconsistent reference validation state/);
});

test("Phase 15 initialization atomic failures clean temp files and retry successfully", async (t) => {
  const f = await fixture(t);
  const old = JSON.stringify([profile("one", "One", f.model, f.build)]);
  await writeFile(path.join(f.dir, "profiles.json"), old);
  await writeFile(path.join(f.dir, "profiles.json"), JSON.stringify([profile("two", "Two", f.custom, f.build)]));
  const scenarios = ["backup", "stat", "write", "rename"] as const;
  for (const scenario of scenarios) {
    const deps: any = {};
    if (scenario === "backup") deps.open = async () => { throw Object.assign(new Error("backup failed"), { code: "EACCES" }); };
    if (scenario === "stat") deps.stat = async () => { throw new Error("stat failed"); };
    if (scenario === "write") deps.writeFile = async (file: string, ...args: any[]) => { if (file.endsWith(".tmp")) throw new Error("write failed"); return writeFile(file, args[0], args[1]); };
    if (scenario === "rename") deps.rename = async () => { throw new Error("rename failed"); };
    await assert.rejects(() => migratePhase15Domain(f.dir, deps));
    await assert.rejects(() => readFile(path.join(f.dir, "phase15-domain.json")), { code: "ENOENT" });
    assert.equal((await names(f.dir, /\.tmp$/)).length, 0);
    if (scenario === "backup") continue;
  }
  let backupSeen = false;
  const checkedWrite = async (file: string, ...args: any[]) => { if (file.endsWith(".tmp")) backupSeen = (await names(f.dir, /^profiles\.json\.phase15-.*\.bak$/)).length >= 2; return writeFile(file, args[0], args[1]); };
  assert.equal(await migratePhase15Domain(f.dir, { writeFile: checkedWrite as any }), "migrated");
  assert.equal(backupSeen, true);
});
