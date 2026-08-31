import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, fetchJson } from "../src/lib/api.ts";

test("requests are sent immediately without authentication bootstrap or injected headers", async () => {
  let authorization: string | null | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("Authorization");
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  assert.deepEqual(await fetchJson("/api/runtime"), { ok: true });
  assert.equal(authorization, null);
});

test("requests retain response errors", async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ message: "Unavailable" }), { status: 503 })) as typeof fetch;
  await assert.rejects(fetchJson("/api/runtime"), (error: unknown) => error instanceof ApiRequestError && error.statusCode === 503);
});
