import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, fetchJson, setAuthConfigured, setAuthConfigurationUnavailable } from "../src/lib/api.ts";

test("setup-required 423 suspends protected network requests until auth becomes available", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ error: "setup_required", message: "Setup required" }), {
      status: 423,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  setAuthConfigured(true);

  await assert.rejects(fetchJson("/api/runtime"), (error: unknown) => error instanceof ApiRequestError && error.statusCode === 423);
  await assert.rejects(fetchJson("/api/runtime"), (error: unknown) => error instanceof ApiRequestError && error.statusCode === 423);
  assert.equal(requests, 1);

  setAuthConfigured(true);
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  assert.deepEqual(await fetchJson("/api/runtime"), { ok: true });
  assert.equal(requests, 2);
});

test("protected requests wait for the initial authoritative auth state", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  setAuthConfigured(undefined);

  const request = fetchJson("/api/runtime");
  await Promise.resolve();
  assert.equal(requests, 0);
  setAuthConfigured(true);
  assert.deepEqual(await request, { ok: true });
  assert.equal(requests, 1);
});

test("auth status failure settles waiting requests and later recovery resumes them", async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  setAuthConfigured(undefined);

  const request = fetchJson("/api/runtime");
  setAuthConfigurationUnavailable("Authentication status unavailable");
  await assert.rejects(request, (error: unknown) => error instanceof ApiRequestError && error.statusCode === 503);
  assert.equal(requests, 0);

  setAuthConfigured(true);
  assert.deepEqual(await fetchJson("/api/runtime"), { ok: true });
  assert.equal(requests, 1);
});
