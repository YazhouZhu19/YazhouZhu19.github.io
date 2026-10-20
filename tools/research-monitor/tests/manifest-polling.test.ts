import assert from "node:assert/strict";
import test from "node:test";
import { manifestPollDelay, startManifestPolling } from "../lib/manifest-polling";

test("manifest polling backs off from five minutes to a capped hour", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5].map((n) => manifestPollDelay(n) / 60_000),
    [5, 10, 20, 40, 60, 60],
  );
});

test("polling pauses when hidden, checks on return, resets after success and cleans up", async () => {
  const source = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  source.visibilityState = "visible";
  let task: (() => void) | undefined;
  let delay = 0,
    calls = 0,
    succeed = false;
  const stop = startManifestPolling(
    async () => {
      calls++;
      return succeed;
    },
    {
      visibility: source,
      schedule: (callback, milliseconds) => {
        task = callback;
        delay = milliseconds;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      unschedule: () => {
        task = undefined;
      },
    },
  );
  assert.equal(delay, 300_000);
  task!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal(delay, 600_000);
  source.visibilityState = "hidden";
  source.dispatchEvent(new Event("visibilitychange"));
  assert.equal(task, undefined);
  succeed = true;
  source.visibilityState = "visible";
  source.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  assert.equal(delay, 300_000);
  stop();
  assert.equal(task, undefined);
  source.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 2);
});

test("repeated visibility events never overlap an active check or restart after disposal", async () => {
  const source = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  source.visibilityState = "visible";
  let finish!: (value: boolean) => void;
  let calls = 0,
    queued = 0;
  const stop = startManifestPolling(
    () => {
      calls++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    {
      visibility: source,
      schedule: () => {
        queued++;
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      unschedule: () => {},
    },
  );
  source.dispatchEvent(new Event("visibilitychange"));
  source.dispatchEvent(new Event("visibilitychange"));
  assert.equal(calls, 1);
  stop();
  finish(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(queued, 1);
});
