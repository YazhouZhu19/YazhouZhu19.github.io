import assert from "node:assert/strict";
import test from "node:test";
import { SIGNALS_ARCHIVE_MAX_BYTES, SIGNALS_MAX_BYTES, SIGNALS_MAX_RECORDS } from "../lib/research-signals";
import { signalsCapacity, signalsCapacityLines } from "../scripts/signals-capacity";

test("capacity reports actual utilization and remaining space against the bounded sharded archive limits", () => {
  const result = signalsCapacity(83953, 80116835);
  assert.deepEqual(result.records, {
    used: 83953,
    limit: SIGNALS_MAX_RECORDS,
    remaining: 166047,
    percent: 33.58,
    warning: false,
  });
  assert.deepEqual(result.bytes, {
    used: 80116835,
    limit: SIGNALS_ARCHIVE_MAX_BYTES,
    remaining: 188318621,
    percent: 29.85,
    warning: false,
  });
});

test("either the record or byte threshold emits an Actions warning at 80 percent, not below", () => {
  const recordBoundary = Math.ceil(SIGNALS_MAX_RECORDS * 0.8);
  const byteBoundary = Math.ceil(SIGNALS_ARCHIVE_MAX_BYTES * 0.8);
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
  const result = signalsCapacity(SIGNALS_MAX_RECORDS + 1, SIGNALS_ARCHIVE_MAX_BYTES + 1);
  assert.equal(result.records.remaining, -1);
  assert.equal(result.bytes.remaining, -1);
  assert.equal(result.records.limit, SIGNALS_MAX_RECORDS);
  assert.equal(result.bytes.limit, SIGNALS_ARCHIVE_MAX_BYTES);
  for (const value of [-1, 0.5, NaN, Infinity]) assert.throws(() => signalsCapacity(value, 0));
});

test("legacy flat files keep their own byte cap and report it explicitly", () => {
  const result = signalsCapacity(83953, 80116835, "legacy");
  assert.deepEqual(result.bytes, {
    used: 80116835,
    limit: SIGNALS_MAX_BYTES,
    remaining: 20546461,
    percent: 79.59,
    warning: false,
  });
  assert.equal(result.records.limit, SIGNALS_MAX_RECORDS);
  const threshold = Math.ceil(SIGNALS_MAX_BYTES * 0.8);
  assert.equal(signalsCapacityLines(0, threshold - 1, "input", "legacy").length, 1);
  const lines = signalsCapacityLines(0, threshold, "input", "legacy");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).format, "legacy");
  assert.equal(JSON.parse(lines[0]).bytes.limit, SIGNALS_MAX_BYTES);
  assert.equal(signalsCapacity(0, SIGNALS_MAX_BYTES + 1, "legacy").bytes.remaining, -1);
  assert.equal(signalsCapacityLines(0, threshold, "input", "sharded").length, 1);
});
