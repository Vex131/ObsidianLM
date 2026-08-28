import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";

export async function fingerprintServerExecutable(locator: string): Promise<string> {
  const info = await stat(locator);
  const normalized = process.platform === "win32" ? path.win32.normalize(locator.replaceAll("/", "\\")).toLowerCase() : path.normalize(locator);
  return createHash("sha256").update(`${normalized}\0${info.size}\0${info.mtimeMs}`).digest("hex");
}
