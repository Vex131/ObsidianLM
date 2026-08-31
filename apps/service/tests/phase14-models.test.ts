import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { defaultSettings } from "@obsidianlm/shared";
import {
  ensureStorageFiles,
  saveProfiles,
  saveSettings,
} from "../src/config/storage.js";
import {
  clearGgufMetadataCache,
  getGgufMetadataCacheStats,
  inspectGgufMetadata,
} from "../src/discovery/gguf-metadata.js";
import { discoverModels } from "../src/discovery/models.js";
import { createServer } from "../src/server.js";

const u32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value);
  return out;
};
const i32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeInt32LE(value);
  return out;
};
const u64 = (value: bigint) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
};
const text = (value: string) =>
  Buffer.concat([u64(BigInt(Buffer.byteLength(value))), Buffer.from(value)]);
function kv(
  key: string,
  type: number,
  value: string | number | bigint,
): Buffer {
  const body =
    type === 8
      ? text(value as string)
      : type === 10
        ? u64(value as bigint)
        : u32(value as number);
  return Buffer.concat([text(key), i32(type), body]);
}
function gguf(entries: Buffer[], version = 3): Buffer {
  return Buffer.concat([
    Buffer.from("GGUF"),
    u32(version),
    u64(0n),
    u64(BigInt(entries.length)),
    ...entries,
  ]);
}
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "obsidianlm-phase14-"));
  const data = path.join(root, "data");
  const models = path.join(root, "models");
  await mkdir(data, { recursive: true });
  await mkdir(models, { recursive: true });
  const prior = process.env.OBSIDIANLM_DATA_DIR;
  process.env.OBSIDIANLM_DATA_DIR = data;
  t.after(() => {
    if (prior === undefined) delete process.env.OBSIDIANLM_DATA_DIR;
    else process.env.OBSIDIANLM_DATA_DIR = prior;
  });
  return { data, models };
}

test("GGUF inspection reads whitelisted model metadata and caches safely", async (t) => {
  const { models } = await fixture(t);
  const file = path.join(models, "Tiny.gguf");
  await writeFile(
    file,
    gguf([
      kv("general.name", 8, "Tiny"),
      kv("general.architecture", 8, "llama"),
      kv("general.type", 8, "model"),
      kv("llama.context_length", 4, 4096),
      kv("llama.expert_count", 4, 8),
    ]),
  );
  clearGgufMetadataCache();
  const first = await inspectGgufMetadata(file, "one");
  const second = await inspectGgufMetadata(file, "two");
  assert.equal(first.status, "ready");
  assert.equal(first.displayName, "Tiny");
  assert.equal(first.architecture, "llama");
  assert.equal(first.trainedContext, 4096);
  assert.equal(first.isMoE, true);
  assert.equal(first.artifactKind, "model");
  assert.equal(second.artifactId, "two");
  assert.equal(getGgufMetadataCacheStats().hits, 1);
  await writeFile(file, gguf([kv("general.name", 8, "Changed")]));
  await utimes(file, new Date(), new Date(Date.now() + 10_000));
  assert.equal(
    (await inspectGgufMetadata(file, "three")).displayName,
    "Changed",
  );
});

test("GGUF inspection handles type/fallback, invalid, truncated, unsupported, and bounded arrays", async (t) => {
  const { models } = await fixture(t);
  const projector = path.join(models, "projector.gguf");
  const fallback = path.join(models, "adapter-lora.gguf");
  const invalid = path.join(models, "bad.gguf");
  const truncated = path.join(models, "cut.gguf");
  const unsupported = path.join(models, "old.gguf");
  const array = path.join(models, "array.gguf");
  await writeFile(projector, gguf([kv("general.type", 8, "projector")]));
  await writeFile(fallback, gguf([]));
  await writeFile(invalid, "nope");
  await writeFile(truncated, Buffer.from("GGUF\x03"));
  await writeFile(unsupported, gguf([], 1));
  await writeFile(
    array,
    gguf([Buffer.concat([text("x"), i32(9), i32(4), u64(100_000_001n)])]),
  );
  assert.equal(
    (await inspectGgufMetadata(projector, "p")).artifactKind,
    "mmproj",
  );
  assert.equal(
    (await inspectGgufMetadata(fallback, "f")).artifactKindSource,
    "filename",
  );
  assert.equal((await inspectGgufMetadata(invalid, "i")).status, "invalid");
  assert.equal((await inspectGgufMetadata(truncated, "t")).status, "invalid");
  assert.equal(
    (await inspectGgufMetadata(unsupported, "u")).status,
    "unsupported",
  );
  assert.equal((await inspectGgufMetadata(array, "a")).status, "invalid");
});

test("GGUF inspection skips tokenizer string arrays and retains useful general metadata", async (t) => {
  const { models } = await fixture(t);
  const file = path.join(models, "metadata.gguf");
  const tokens = Buffer.concat([
    text("tokenizer.ggml.tokens"),
    i32(9),
    i32(8),
    u64(2n),
    text("one"),
    text("two"),
  ]);
  await writeFile(
    file,
    gguf([
      tokens,
      kv("general.description", 8, "Useful model"),
      kv("general.file_type", 4, 15),
    ]),
  );
  const inspected = await inspectGgufMetadata(file, "metadata");
  assert.equal(inspected.status, "ready");
  assert.equal(inspected.metadata["general.description"], "Useful model");
  assert.equal(inspected.metadata["general.file_type"], 15);
  assert.equal(inspected.metadata["tokenizer.ggml.tokens"], undefined);
});

test("GGUF inspection rejects excessive string-array work before reading elements", async (t) => {
  const { models } = await fixture(t);
  const file = path.join(models, "huge-tokenizer.gguf");
  const tokens = Buffer.concat([
    text("tokenizer.ggml.tokens"),
    i32(9),
    i32(8),
    u64(500_001n),
  ]);
  await writeFile(file, gguf([tokens]));
  const inspected = await inspectGgufMetadata(file, "huge-tokenizer");
  assert.equal(inspected.status, "invalid");
  assert.match(inspected.warnings[0], /string array exceeds inspection limit/u);
});

test("GGUF inspection buffers accepted string-array length prefixes", async (t) => {
  const { models } = await fixture(t);
  const file = path.join(models, "bounded-tokenizer.gguf");
  const tokens = Buffer.concat([
    text("tokenizer.ggml.tokens"),
    i32(9),
    i32(8),
    u64(500_000n),
    Buffer.alloc(500_000 * 8),
  ]);
  await writeFile(file, gguf([tokens]));
  assert.equal(
    (await inspectGgufMetadata(file, "bounded-tokenizer")).status,
    "ready",
  );
});

test("metadata endpoint resolves only discovered IDs without authentication", async (t) => {
  const { models } = await fixture(t);
  const file = path.join(models, "model.gguf");
  const malformed = path.join(models, "malformed.gguf");
  await writeFile(file, gguf([kv("general.type", 8, "model")]));
  await writeFile(malformed, "bad");
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, modelFolders: [models] });
  const app = await createServer();
  t.after(() => app.close());
  const discovered = await discoverModels();
  const model = discovered.models.find((item) => item.path === file)!;
  const publicResponse = await app.inject({
    method: "GET",
    url: `/api/discovery/models/${model.id}/metadata`,
  });
  assert.equal(publicResponse.statusCode, 200);
  const known = await app.inject({
    method: "GET",
    url: `/api/discovery/models/${model.id}/metadata?path=${encodeURIComponent(file)}`,
  });
  assert.equal(known.statusCode, 200);
  assert.equal(known.json().artifactKind, "model");
  const malformedResponse = await app.inject({
    method: "GET",
    url: `/api/discovery/models/${discovered.models.find((item) => item.path === malformed)!.id}/metadata`,
  });
  assert.equal(malformedResponse.statusCode, 200);
  assert.equal(malformedResponse.json().status, "invalid");
  const unknown = await app.inject({
    method: "GET",
    url: "/api/discovery/models/not-a-model/metadata",
  });
  assert.equal(unknown.statusCode, 404);
});

test("model usage is matched by service path semantics", async (t) => {
  const { models } = await fixture(t);
  const file = path.join(models, "used.gguf");
  await writeFile(file, gguf([]));
  await ensureStorageFiles();
  await saveSettings({ ...defaultSettings, modelFolders: [models] });
  await saveProfiles([
    {
      id: "used",
      name: "Used",
      runtimeType: "llama.cpp",
      providerKind: "server",
      buildPath: "llama-server",
      modelPath: file,
      host: "127.0.0.1",
      port: 8085,
    },
    {
      id: "missing",
      name: "Missing",
      runtimeType: "llama.cpp",
      providerKind: "server",
      buildPath: "llama-server",
      modelPath: path.join(models, "gone.gguf"),
      host: "127.0.0.1",
      port: 8085,
    },
  ]);
  const app = await createServer();
  t.after(() => app.close());
  const response = await app.inject({
    method: "GET",
    url: "/api/discovery/models/usage",
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(body.usage[0].profileIds, ["used"]);
  assert.deepEqual(body.missingProfileIds, ["missing"]);
});
