import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { GgufArtifactKind, GgufArtifactKindSource, GgufMetadataInspection, GgufMetadataValue } from "@obsidianlm/shared";

const MAGIC = "GGUF";
const maxKeyBytes = 1024;
const maxStringBytes = 64 * 1024;
const maxKvCount = 100_000n;
const maxArrayElements = 100_000_000n;
const maxStringArrayElements = 500_000n;
const readChunkBytes = 64 * 1024;
const scalarSizes = new Map<number, number>([[0, 1], [1, 1], [2, 2], [3, 2], [4, 4], [5, 4], [6, 4], [7, 1], [10, 8], [11, 8], [12, 8]]);
const metadataKeys = new Set([
  "general.type",
  "general.architecture",
  "general.name",
  "general.basename",
  "general.size_label",
  "general.finetune",
  "general.description",
  "general.license",
  "general.file_type",
  "general.quantization_version",
  "general.source.huggingface.repository"
]);
const architectureFields = new Set(["context_length", "embedding_length", "block_count", "expert_count", "expert_used_count", "nextn_predict_layers"]);

type CachedInspection = Omit<GgufMetadataInspection, "artifactId">;

const cache = new Map<string, CachedInspection>();
let cacheHits = 0;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function cacheKey(filePath: string, size: number, mtimeMs: number): string {
  return `${filePath}\0${size}\0${mtimeMs}`;
}

function invalid(message: string): CachedInspection {
  return { status: "invalid", artifactKind: "unknown", artifactKindSource: "unknown", metadata: {}, warnings: [message] };
}

function classifyFilename(fileName: string): GgufArtifactKind {
  const name = fileName.toLowerCase();
  if (/(?:mmproj|projector)/u.test(name)) return "mmproj";
  if (/(?:adapter|lora)/u.test(name)) return "adapter";
  if (/imatrix/u.test(name)) return "imatrix";
  return "unknown";
}

function classifyType(value: GgufMetadataValue | undefined): GgufArtifactKind {
  if (typeof value !== "string") return "unknown";
  switch (value.toLowerCase()) {
    case "model": return "model";
    case "mmproj":
    case "projector": return "mmproj";
    case "adapter": return "adapter";
    case "imatrix": return "imatrix";
    default: return "other";
  }
}

function safeNumber(value: GgufMetadataValue | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

class Reader {
  private position = 0n;
  private buffer = Buffer.alloc(0);
  private bufferStart = 0n;

  constructor(private readonly handle: Awaited<ReturnType<typeof open>>, private readonly size: bigint) {}

  private takeBuffered(length: number): Buffer | undefined {
    const offset = this.position - this.bufferStart;
    if (offset < 0n || offset > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
    const start = Number(offset);
    if (start + length > this.buffer.length) return undefined;
    this.position += BigInt(length);
    return this.buffer.subarray(start, start + length);
  }

  private async bytes(length: number): Promise<Buffer> {
    if (length < 0 || this.position + BigInt(length) > this.size) throw new Error("truncated GGUF metadata");
    const buffered = this.takeBuffered(length);
    if (buffered) return buffered;
    if (this.position > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("GGUF file position exceeds supported range");
    const available = this.size - this.position;
    const readLength = Number(available < BigInt(Math.max(length, readChunkBytes)) ? available : BigInt(Math.max(length, readChunkBytes)));
    const next = Buffer.allocUnsafe(readLength);
    const { bytesRead } = await this.handle.read(next, 0, readLength, Number(this.position));
    if (bytesRead < length) throw new Error("truncated GGUF metadata");
    this.buffer = next.subarray(0, bytesRead);
    this.bufferStart = this.position;
    return this.takeBuffered(length)!;
  }

  async u32(): Promise<number> { return (await this.bytes(4)).readUInt32LE(); }
  async i32(): Promise<number> { return (await this.bytes(4)).readInt32LE(); }
  async u64(): Promise<bigint> { return (await this.bytes(8)).readBigUInt64LE(); }
  async fixedString(length: number): Promise<string> { return (await this.bytes(length)).toString("ascii"); }

  async string(limit = maxStringBytes): Promise<string> {
    const length = await this.u64();
    if (length > BigInt(limit)) throw new Error("GGUF string exceeds metadata limit");
    return (await this.bytes(Number(length))).toString("utf8");
  }

  skip(length: bigint): void {
    if (length < 0n || this.position + length > this.size) throw new Error("truncated GGUF metadata");
    this.position += length;
  }

  async skipStringArray(count: bigint): Promise<void> {
    for (let index = 0n; index < count; index += 1n) {
      const data = this.takeBuffered(8) ?? await this.bytes(8);
      const length = data.readBigUInt64LE();
      if (length > BigInt(maxStringBytes)) throw new Error("GGUF string exceeds metadata limit");
      this.skip(length);
    }
  }

  async scalar(type: number): Promise<GgufMetadataValue> {
    const data = await this.bytes(scalarSizes.get(type)!);
    switch (type) {
      case 0: return data.readUInt8();
      case 1: return data.readInt8();
      case 2: return data.readUInt16LE();
      case 3: return data.readInt16LE();
      case 4: return data.readUInt32LE();
      case 5: return data.readInt32LE();
      case 6: return data.readFloatLE();
      case 7: return data.readUInt8() !== 0;
      case 10: { const value = data.readBigUInt64LE(); return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString(); }
      case 11: { const value = data.readBigInt64LE(); return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString(); }
      case 12: return data.readDoubleLE();
      default: throw new Error("unsupported GGUF scalar type");
    }
  }

  async value(type: number, store: boolean): Promise<GgufMetadataValue | undefined> {
    if (type === 8) {
      const value = await this.string();
      return store ? value : undefined;
    }
    if (type === 9) {
      const elementType = await this.i32();
      const count = await this.u64();
      if (count > maxArrayElements) throw new Error("GGUF array exceeds element limit");
      if (elementType === 8) {
        if (count > maxStringArrayElements) throw new Error("GGUF string array exceeds inspection limit");
        await this.skipStringArray(count);
      } else {
        const elementSize = scalarSizes.get(elementType);
        if (!elementSize) throw new Error("unsupported GGUF array element type");
        this.skip(count * BigInt(elementSize));
      }
      return undefined;
    }
    if (!scalarSizes.has(type)) throw new Error("unsupported GGUF value type");
    const value = await this.scalar(type);
    return store ? value : undefined;
  }
}

async function parse(filePath: string): Promise<CachedInspection> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const file = await stat(filePath);
    handle = await open(filePath, "r");
    const reader = new Reader(handle, BigInt(file.size));
    if ((await reader.fixedString(4)) !== MAGIC) return invalid("Invalid GGUF magic.");
    const version = await reader.u32();
    if (version !== 2 && version !== 3) return { status: "unsupported", artifactKind: "unknown", artifactKindSource: "unknown", version, metadata: {}, warnings: ["Unsupported GGUF version."] };
    const tensorCount = await reader.u64();
    const kvCount = await reader.u64();
    if (kvCount > maxKvCount) throw new Error("GGUF metadata key/value count exceeds limit");
    const metadata: Record<string, GgufMetadataValue> = {};
    let architecture: string | undefined;
    for (let index = 0n; index < kvCount; index += 1n) {
      const key = await reader.string(maxKeyBytes);
      const type = await reader.i32();
      const dynamic = architectureFields.has(key.slice(key.lastIndexOf(".") + 1));
      const value = await reader.value(type, metadataKeys.has(key) || Boolean(dynamic));
      if (value !== undefined) {
        metadata[key] = value;
        if (key === "general.architecture" && typeof value === "string") architecture = value;
      }
    }
    for (const key of Object.keys(metadata)) {
      if (architectureFields.has(key.slice(key.lastIndexOf(".") + 1)) && (!architecture || !key.startsWith(`${architecture}.`))) delete metadata[key];
    }
    const metadataKind = classifyType(metadata["general.type"]);
    const filenameKind = classifyFilename(path.basename(filePath));
    const artifactKind = metadataKind === "unknown" ? filenameKind : metadataKind;
    const artifactKindSource: GgufArtifactKindSource = metadataKind === "unknown" ? (filenameKind === "unknown" ? "unknown" : "filename") : "metadata";
    const context = architecture ? safeNumber(metadata[`${architecture}.context_length`]) : undefined;
    const experts = architecture ? safeNumber(metadata[`${architecture}.expert_count`]) : undefined;
    return {
      status: "ready", artifactKind, artifactKindSource, version,
      tensorCount: tensorCount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(tensorCount) : undefined,
      kvCount: Number(kvCount), displayName: typeof metadata["general.name"] === "string" ? metadata["general.name"] : undefined,
      architecture, trainedContext: context,
      embeddingLength: architecture ? safeNumber(metadata[`${architecture}.embedding_length`]) : undefined,
      blockCount: architecture ? safeNumber(metadata[`${architecture}.block_count`]) : undefined,
      expertCount: experts, expertUsedCount: architecture ? safeNumber(metadata[`${architecture}.expert_used_count`]) : undefined,
      nextnPredictLayers: architecture ? safeNumber(metadata[`${architecture}.nextn_predict_layers`]) : undefined,
      isMoE: experts !== undefined && experts > 0, metadata, warnings: []
    };
  } catch (error) {
    return invalid(error instanceof Error ? error.message.replace(/\r?\n/g, " ") : "Invalid GGUF metadata.");
  } finally {
    await handle?.close();
  }
}

export async function inspectGgufMetadata(filePath: string, artifactId: string): Promise<GgufMetadataInspection> {
  try {
    const file = await stat(filePath);
    const key = cacheKey(filePath, file.size, file.mtimeMs);
    let inspection = cache.get(key);
    if (inspection) {
      cacheHits += 1;
      cache.delete(key);
      cache.set(key, inspection);
    } else {
      inspection = await parse(filePath);
      cache.set(key, inspection);
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
    }
    return { artifactId, ...clone(inspection) };
  } catch {
    return { artifactId, ...invalid("GGUF file could not be read.") };
  }
}

export function clearGgufMetadataCache(): void { cache.clear(); cacheHits = 0; }
export function getGgufMetadataCacheStats(): { size: number; hits: number } { return { size: cache.size, hits: cacheHits }; }
export { classifyFilename as guessGgufArtifactKind };
