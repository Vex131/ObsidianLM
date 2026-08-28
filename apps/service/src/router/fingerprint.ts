import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

export async function fingerprintServerExecutable(locator: string): Promise<string> {
  const normalized = process.platform === "win32" ? path.win32.normalize(locator.replaceAll("/", "\\")).toLowerCase() : path.normalize(locator);
  const hash = createHash("sha256").update(normalized).update("\0");
  for await (const chunk of createReadStream(locator)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
