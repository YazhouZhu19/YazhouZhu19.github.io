import assert from "node:assert/strict";
import test from "node:test";
import { compareSnapshots, createSnapshotLoader, SnapshotRequestError } from "../lib/snapshot-refresh";
import type { MonitorData } from "../lib/types";

const fixture = (ids: string[], collectedAt = "2026-09-18T00:00:00Z") =>
  ({
    papers: ids.map((id) => ({ id })),
    collectedAt,
    lastSuccessfulSync: collectedAt,
  }) as MonitorData;

test("snapshot comparison catches same-count metadata updates and ID replacements", () => {
  const old = fixture(["a", "b"]);
  assert.deepEqual(compareSnapshots(old, fixture(["b", "a"])), { changed: false, added: 0 });
  assert.deepEqual(compareSnapshots(old, fixture(["a", "b"], "2026-09-18T01:00:00Z")), {
    changed: true,
    added: 0,
  });
  assert.deepEqual(compareSnapshots(old, fixture(["a", "c"])), { changed: true, added: 1 });
});

test("manual and background refreshes share one pending network request", async () => {
  let requests = 0;
  let finish!: (value: string) => void;
  const loader = createSnapshotLoader(async () => {
    requests++;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const background = loader.load();
  const manual = loader.load();
  assert.equal(manual, background);
  await Promise.resolve();
  assert.equal(requests, 1);
  finish("snapshot");
  assert.equal(await manual, "snapshot");
  assert.equal(await background, "snapshot");
});

test("timeout aborts the request and releases the pending slot for retry", async () => {
  let signal: AbortSignal | undefined;
  let calls = 0;
  const loader = createSnapshotLoader(async (current) => {
    signal = current;
    if (++calls === 2) return "recovered";
    return new Promise<string>(() => {});
  }, 15);
  await assert.rejects(
    loader.load(),
    (error) => error instanceof SnapshotRequestError && error.kind === "timeout",
  );
  assert.equal(signal?.aborted, true);
  assert.equal(await loader.load(), "recovered");
});

test("a cold multi-shard load can complete after a minute but still has a finite deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let finish!: (value: string) => void;
  let signal!: AbortSignal;
  const loader = createSnapshotLoader((current) => {
    signal = current;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const request = loader.load();
  await Promise.resolve();
  t.mock.timers.tick(90_000);
  assert.equal(signal.aborted, false);
  finish("complete verified snapshot");
  assert.equal(await request, "complete verified snapshot");

  const stalled = loader.load();
  const rejection = assert.rejects(
    stalled,
    (error) => error instanceof SnapshotRequestError && error.kind === "timeout",
  );
  await Promise.resolve();
  t.mock.timers.tick(300_000);
  await rejection;
  assert.equal(signal.aborted, true);
});

test("unmount cancellation rejects promptly and allows an immediate fresh request", async () => {
  let calls = 0;
  let oldSignal: AbortSignal | undefined;
  const loader = createSnapshotLoader(async (signal) => {
    calls++;
    if (calls > 1) return "fresh";
    oldSignal = signal;
    return new Promise<string>(() => {});
  });
  const old = loader.load();
  await Promise.resolve();
  loader.cancel();
  const fresh = loader.load();
  await assert.rejects(old, (error) => error instanceof SnapshotRequestError && error.kind === "cancelled");
  assert.equal(oldSignal?.aborted, true);
  assert.equal(await fresh, "fresh");
});

test("a failed read releases the pending slot without replacing any snapshot", async () => {
  let calls = 0;
  const loader = createSnapshotLoader(async () => {
    if (++calls === 1) throw new Error("network offline");
    return "retry succeeded";
  });
  await assert.rejects(loader.load(), /network offline/);
  assert.equal(await loader.load(), "retry succeeded");
});
