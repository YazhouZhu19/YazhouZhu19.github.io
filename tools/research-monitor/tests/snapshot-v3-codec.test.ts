import assert from "node:assert/strict";
import test from "node:test";
import { decodeV3Paper, encodeV3Paper } from "../lib/snapshot-v3";

const dictionary = ["医学影像实验室", ""], indices = new Map(dictionary.map((value, index) => [value, index]));
const roundTrip = (paper: Record<string, unknown>) => decodeV3Paper(JSON.parse(JSON.stringify(encodeV3Paper(paper, indices))), dictionary);
const base = () => ({ id: "example", abstract: "A preserved abstract", authors: [], provenance: [] });

test("v3 distinguishes equal, distinct, null and absent original abstracts exactly", () => {
  for (const extra of [{}, { originalAbstract: null }, { originalAbstract: "" }, { originalAbstract: "HTML <p>Original</p>" }, { originalAbstract: "A preserved abstract" }]) {
    const paper = { ...base(), ...extra };
    assert.deepEqual(roundTrip(paper), paper);
  }
  const same = { ...base(), originalAbstract: "A preserved abstract" };
  const encoded = encodeV3Paper(same, indices);
  assert.equal(encoded[0], 1);
  assert.equal("originalAbstract" in encoded[1], false);
  assert.equal(encodeV3Paper(base(), indices)[0], 0);
  assert.equal("originalAbstract" in roundTrip(base()), false);
});

test("v3 author tuples preserve display names, absent/null ORCID, extra fields and repeated affiliation order", () => {
  const paper = { ...base(), affiliations: ["医学影像实验室", "Literal institution", ""], authors: [
    { name: "作者一", orcid: null, affiliations: ["医学影像实验室", "Literal institution", "医学影像实验室"], displayName: "作者 一", custom: [false, 1, null] },
    { name: "No ORCID", affiliations: [] },
    { name: "With ORCID", orcid: "0000-0000-0000-0001", affiliations: [""] },
    { name: "No optional fields", extra: { untouched: true } },
  ], custom: { originalAbstract: true, name: "not a transport marker" } };
  const original = structuredClone(paper), encoded = encodeV3Paper(paper, indices);
  assert.deepEqual(encoded[1].authors[0].slice(0, 3), ["作者一", null, [0, "Literal institution", 0]]);
  assert.deepEqual(roundTrip(paper), paper);
  assert.deepEqual(paper, original);
});

test("v3 provenance tuples preserve missing fields, explicit nulls and unknown values exactly", () => {
  const paper = { ...base(), provenance: [
    { queryUrl: 0, collectedAt: "2026-10-20T00:00:00Z", queryTrack: "segmentation", sourceRecordId: "source:1" },
    { collectedAt: "2026-10-20T00:00:00Z" },
    { queryUrl: null, collectedAt: null, queryTrack: null, sourceRecordId: null },
    { custom: { nested: [1, false, null] } },
    {},
  ] };
  const encoded = encodeV3Paper(paper, indices);
  assert.deepEqual(encoded[1].provenance[0], [0, "2026-10-20T00:00:00Z", "segmentation", "source:1"]);
  assert.deepEqual(roundTrip(paper), paper);
});

test("v3 rejects corrupt references and ambiguous compact metadata before returning any paper", () => {
  const compact = encodeV3Paper({ ...base(), originalAbstract: "A preserved abstract", authors: [{ name: "Author", orcid: null, affiliations: ["医学影像实验室"] }] }, indices);
  for (const index of [-1, 0.5, dictionary.length, null, true, {}]) {
    const invalid = structuredClone(compact);
    invalid[1].authors[0][2] = [index];
    assert.throws(() => decodeV3Paper(invalid, dictionary), /affiliation reference/);
  }
  for (const invalid of [
    [2, compact[1]], [true, compact[1]], [0, null], [0, compact[1], {}],
    [1, { ...compact[1], originalAbstract: "conflicting" }],
    [1, { ...compact[1], abstract: null }],
    [0, { ...compact[1], authors: [["Author", null, [], null, 9]] }],
    [0, { ...compact[1], authors: [["Author", null, [], null, 3, { name: "overridden" }]] }],
    [0, { ...compact[1], authors: [["Author", "present", [], null, 2]] }],
    [0, { ...compact[1], provenance: [[null, null, null, null, 16]] }],
    [0, { ...compact[1], provenance: [[null, null, null, null, 15, { queryTrack: "overridden" }]] }],
    [0, { ...compact[1], provenance: [[0, null, null, null, 0]] }],
  ]) assert.throws(() => decodeV3Paper(invalid, dictionary), /v3 paper/);
});
