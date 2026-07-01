import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyRequest } from "fastify";

const scrypt = promisify(scryptCallback);

const hashPrefix = "scrypt:v1";
const saltBytes = 16;
const keyLength = 64;
const minimumTokenLength = 12;

export function validateAdminTokenStrength(token: unknown): string | null {
  if (typeof token !== "string" || token.length === 0) {
    return "Admin token is required.";
  }

  if (/\s/.test(token)) {
    return "Admin token cannot contain whitespace.";
  }

  if (token.length < minimumTokenLength) {
    return `Admin token must be at least ${minimumTokenLength} characters.`;
  }

  return null;
}

export async function hashAdminToken(token: string): Promise<string> {
  const strengthError = validateAdminTokenStrength(token);
  if (strengthError) {
    throw new Error(strengthError);
  }

  const salt = randomBytes(saltBytes);
  const derived = (await scrypt(token, salt, keyLength)) as Buffer;
  return `${hashPrefix}:${salt.toString("base64")}:${derived.toString("base64")}`;
}

export function isAdminTokenHash(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const parts = value.split(":");
  if (parts.length !== 4 || `${parts[0]}:${parts[1]}` !== hashPrefix) {
    return false;
  }

  const salt = Buffer.from(parts[2] ?? "", "base64");
  const expected = Buffer.from(parts[3] ?? "", "base64");
  return salt.length === saltBytes && expected.length > 0;
}

export async function verifyAdminTokenHash(token: unknown, storedHash: string | null | undefined): Promise<boolean> {
  if (typeof token !== "string" || !isAdminTokenHash(storedHash)) {
    return false;
  }

  const parts = storedHash.split(":");
  const salt = Buffer.from(parts[2] ?? "", "base64");
  const expected = Buffer.from(parts[3] ?? "", "base64");
  const actual = (await scrypt(token, salt, expected.length)) as Buffer;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }

  const match = /^Bearer\s+([^\s]+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}
