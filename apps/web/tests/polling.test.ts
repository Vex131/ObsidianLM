import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionAwarePoller } from "../src/lib/polling.ts";

test("poller coalesces refreshes and resumes once when visible", async () => {
  const listeners = new Map<string, () => void>();
  let hidden = false;
  Object.assign(globalThis, {
    document: {
      get hidden() { return hidden; },
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: (name: string) => listeners.delete(name)
    },
    window: { setTimeout, clearTimeout }
  });

  let calls = 0;
  let complete: (() => void) | undefined;
  const poller = createCompletionAwarePoller(() => new Promise<void>((resolve) => { calls += 1; complete = resolve; }), 1000);
  poller.start();
  await Promise.resolve();
  assert.equal(calls, 1);
  const initial = poller.refresh();
  assert.strictEqual(initial, poller.refresh());
  complete?.();
  await initial;

  hidden = true;
  listeners.get("visibilitychange")?.();
  hidden = false;
  listeners.get("visibilitychange")?.();
  await Promise.resolve();
  assert.equal(calls, 2);
  poller.stop();
});
