import assert from "node:assert/strict";
import test from "node:test";
import { parseEpmcPage } from "../lib/epmc-page";

const encode = (value: unknown) => JSON.stringify(value);
const records = (count: number) => Array.from({ length: count }, (_, id) => ({ id: String(id), source: "MED" }));

test("Europe PMC core pages can exhaust at 132 records despite hitCount 134", () => {
  // Shape and counts reproduced from the live segmentation query on 2026-09-27.
  const firstCursor = "AoJwgJCUv6ADKDU2NDc0OTc4";
  const lastCursor = "AoJwgJmotYUDKDU2NDc2MTg5";
  const first = parseEpmcPage(encode({ hitCount: 134, nextCursorMark: firstCursor, request: { cursorMark: "*" }, resultList: { result: records(99) } }), "*", 0);
  const second = parseEpmcPage(encode({ hitCount: 134, nextCursorMark: lastCursor, request: { cursorMark: firstCursor }, resultList: { result: records(33) } }), firstCursor, first.hits.length);
  const last = parseEpmcPage(encode({ version: "6.9", hitCount: 134, request: { cursorMark: lastCursor }, resultList: { result: [] } }), lastCursor, first.hits.length + second.hits.length);
  assert.equal(first.exhausted, false);
  assert.equal(second.exhausted, false);
  assert.deepEqual(last, { hits: [], total: 134, next: undefined, exhausted: true });
  assert.equal(first.hits.length + second.hits.length, 132, "retain the count discrepancy for coverage reporting");
});

test("Europe PMC repeated terminal cursor is valid after previously received records", () => {
  const page = parseEpmcPage(encode({ hitCount: 200, request: { cursorMark: "last" }, nextCursorMark: "last", resultList: { result: [] } }), "last", 198);
  assert.equal(page.exhausted, true);
  assert.equal(page.total, 200);
});

test("Europe PMC explicit zero result is valid", () => {
  assert.deepEqual(parseEpmcPage(encode({ hitCount: 0, resultList: { result: [] } }), "*", 0), { hits: [], total: 0, next: undefined, exhausted: true });
});

test("Europe PMC nonzero empty first page remains an error", () => {
  assert.throws(() => parseEpmcPage(encode({ hitCount: 134, request: { cursorMark: "*" }, resultList: { result: [] } }), "*", 0), /返回空页/);
});

test("Europe PMC advancing or unconfirmed empty page remains an error", () => {
  const resultList = { result: [] };
  assert.throws(() => parseEpmcPage(encode({ hitCount: 134, request: { cursorMark: "page-2" }, nextCursorMark: "page-3", resultList }), "page-2", 132), /返回空页/);
  assert.throws(() => parseEpmcPage(encode({ hitCount: 134, request: { cursorMark: "wrong-cursor" }, resultList }), "page-2", 132), /返回空页/);
  assert.throws(() => parseEpmcPage(encode({ hitCount: 134, resultList }), "page-2", 132), /返回空页/);
  assert.throws(() => parseEpmcPage(encode({ hitCount: 134, request: { cursorMark: "page-2" }, nextPageUrl: "https://www.ebi.ac.uk/europepmc/webservices/rest/search?cursorMark=page-3", resultList }), "page-2", 132), /返回空页/);
});

test("Europe PMC malformed JSON, result lists, counts, and cursors remain errors", () => {
  assert.throws(() => parseEpmcPage("<html>Unavailable</html>", "*", 0), /非 JSON/);
  for (const value of [null, {}, { hitCount: 0 }, { hitCount: "0", resultList: { result: [] } }, { hitCount: -1, resultList: { result: [] } }]) {
    assert.throws(() => parseEpmcPage(encode(value), "*", 0), /无法识别/);
  }
  assert.throws(() => parseEpmcPage(encode({ hitCount: 1, nextCursorMark: 123, resultList: { result: records(1) } }), "*", 0), /无效的下一页游标/);
});
