import assert from "node:assert/strict";
import test from "node:test";
import { createLatestAsyncAction } from "../lib/latest-async-action";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("a later drill selection wins even when the earlier read finishes last", async () => {
  const action = createLatestAsyncAction();
  const old = deferred<string>(),
    next = deferred<string>();
  const applied: string[] = [];
  const first = action.run(
    () => old.promise,
    (value) => applied.push(value),
  );
  const second = action.run(
    () => next.promise,
    (value) => applied.push(value),
  );
  next.resolve("new selection");
  assert.equal(await second, true);
  old.resolve("old selection");
  assert.equal(await first, false);
  assert.deepEqual(applied, ["new selection"]);
});

test("navigation, changed filters and unmount invalidate an in-flight UI action", async () => {
  const action = createLatestAsyncAction();
  for (const reason of ["navigation", "filters", "manifest", "unmount"]) {
    const pending = deferred<string>();
    let applied = false;
    const result = action.run(
      () => pending.promise,
      () => {
        applied = true;
      },
    );
    action.invalidate();
    pending.resolve(reason);
    assert.equal(await result, false);
    assert.equal(applied, false);
  }
  let accepted = "";
  assert.equal(
    await action.run(
      async () => "recovered",
      (value) => {
        accepted = value;
      },
    ),
    true,
  );
  assert.equal(accepted, "recovered");
});

test("a failed read never applies a partial selection and a new action can retry", async () => {
  const action = createLatestAsyncAction();
  let applied = 0;
  await assert.rejects(
    action.run(
      async () => {
        throw new Error("read failed");
      },
      () => {
        applied++;
      },
    ),
    /read failed/,
  );
  assert.equal(applied, 0);
  await action.run(
    async () => "complete",
    () => {
      applied++;
    },
  );
  assert.equal(applied, 1);
});
