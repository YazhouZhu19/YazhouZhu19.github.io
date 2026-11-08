import assert from "node:assert/strict";
import test from "node:test";
import { SIGNALS_MAX_BYTES, SIGNALS_MAX_RECORDS } from "../lib/research-signals";
import { signalsCapacity, signalsCapacityLines } from "../scripts/signals-capacity";

test("capacity reports actual utilization and remaining space against the existing hard limits", () => {
  const result = signalsCapacity(83953, 80116835);
  assert.deepEqual(result.records, {
    used: 83953,
    limit: SIGNALS_MAX_RECORDS,
    remaining: 16047,
    percent: 83.95,
    warning: true,
  });
  assert.deepEqual(result.bytes, {
    used: 80116835,
    limit: SIGNALS_MAX_BYTES,
    remaining: 20546461,
    percent: 79.59,
    warning: false,
  });
});

test("either the record or byte threshold emits an Actions warning at 80 percent, not below", () => {
  const recordBoundary = Math.ceil(SIGNALS_MAX_RECORDS * 0.8);
  const byteBoundary = Math.ceil(SIGNALS_MAX_BYTES * 0.8);
  assert.equal(signalsCapacityLines(recordBoundary - 1, byteBoundary - 1, "input").length, 1);
  for (const [records, bytes] of [
    [recordBoundary, 0],
    [0, byteBoundary],
  ]) {
    const lines = signalsCapacityLines(records, bytes, "output");
    assert.equal(JSON.parse(lines[0]).event, "signals-capacity");
    assert.equal(JSON.parse(lines[0]).phase, "output");
    assert.match(lines[1], /^::warning title=Research signals capacity::/);
    assert.match(lines[1], /remaining/);
  }
});

test("capacity reporting never hides an exceeded limit or changes it", () => {
  const result = signalsCapacity(SIGNALS_MAX_RECORDS + 1, SIGNALS_MAX_BYTES + 1);
  assert.equal(result.records.remaining, -1);
  assert.equal(result.bytes.remaining, -1);
  assert.equal(result.records.limit, SIGNALS_MAX_RECORDS);
  assert.equal(result.bytes.limit, SIGNALS_MAX_BYTES);
  for (const value of [-1, 0.5, NaN, Infinity]) assert.throws(() => signalsCapacity(value, 0));
});
