import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWorkIndex,
  createWorkGroupingCache,
  groupWorks,
  normalizedWorkTitle,
  titleAuthorMatch,
} from "../lib/paper-works";
import { normalizeRecord } from "../lib/record";
import type { Paper } from "../lib/types";

function paper(id: string, title: string, names: string[], extra: Partial<Paper> = {}): Paper {
  return normalizeRecord(
    {
      id,
      title,
      abstract: "",
      source: "fixture",
      url: `https://example.org/${id}`,
      publishedAt: "2026-10-01",
      authors: names.map((name) => ({ name, affiliations: [] })),
      ...extra,
    },
    "2026-10-21T00:00:00Z",
  );
}
const title = "Cross-modal MRI segmentation: a multicenter study";

test("exact normalized titles and first author surnames connect preprint and article without changing records", () => {
  const rows = [
    paper("preprint", title, ["Alice Smith", "Bo Wang"], { status: "preprint" }),
    paper("article", "Cross–modal MRI segmentation — a multicenter study.", ["A. Smith", "C. Jones"], {
      status: "published",
    }),
  ];
  const before = structuredClone(rows);
  assert.equal(normalizedWorkTitle(rows[0].title), normalizedWorkTitle(rows[1].title));
  assert.equal(titleAuthorMatch(...(rows as [Paper, Paper]))?.firstAuthorSurname, "smith");
  assert.deepEqual(groupWorks(rows), [rows]);
  assert.deepEqual(rows, before);
  assert.equal(groupWorks(rows)[0][0], rows[0]);
  assert.equal(groupWorks(rows, { titleAuthors: false }).length, 2);
});

test("author-set Jaccard at one half supports reordered author lists while below threshold does not", () => {
  const a = paper("a", title, ["Alice Smith", "Bo Wang", "Carol Lee"]);
  const b = paper("b", title, ["Bo Wang", "Alice Smith", "Dan Zhao"]);
  const c = paper("c", title, ["Eve Brown", "Alice Smith", "Frank Khan"]);
  assert.equal(titleAuthorMatch(a, b)?.authorJaccard, 0.5);
  assert.equal(groupWorks([a, b]).length, 1);
  assert.equal(titleAuthorMatch(a, c), null);
});

test("generic equal titles with unrelated or missing authors stay separate", () => {
  const rows = [
    paper("a", "Editorial", ["Alice Smith"]),
    paper("b", "Editorial", ["Bob Jones"]),
    paper("c", "Editorial", []),
    paper("d", "Editorial", []),
    paper("e", "", ["Alice Smith"]),
    paper("f", "", ["Alice Smith"]),
  ];
  assert.equal(groupWorks(rows).length, rows.length);
});

test("similar but nonidentical titles never group using authors alone", () => {
  const a = paper("a", title, ["Alice Smith"]);
  const b = paper("b", title + ": external validation", ["Alice Smith"]);
  assert.equal(groupWorks([a, b]).length, 2);
});

test("surname parsing supports source initials, punctuation and family-name-first comma notation", () => {
  const a = paper("a", title, ["Gerrit Cornelis Arends"], {
    authors: [{ name: "Gerrit Cornelis Arends", displayName: "Arends GC", affiliations: [] }],
  });
  const b = paper("b", title, ["Arends, Gerrit"]);
  assert.equal(titleAuthorMatch(a, b)?.firstAuthorSurname, "arends");
  const c = paper("c", title, ["Smith AJ"]);
  const d = paper("d", title, ["Alice Smith"]);
  assert.equal(titleAuthorMatch(c, d)?.firstAuthorSurname, "smith");
});

test("collective or isolated names cannot create a surname-only match", () => {
  const a = paper("a", title, ["International Image Study Group"]);
  const b = paper("b", title, ["Another Image Study Group"]);
  assert.equal(titleAuthorMatch(a, b), null);
  assert.equal(titleAuthorMatch(paper("c", title, ["Wang"]), paper("d", title, ["Alice Wang"])), null);
});

test("known identifiers retain precedence and index lists every unchanged source record", () => {
  const a = paper("a", title, ["Alice Smith"], { doi: "10.1234/example" });
  const b = paper("b", "Updated study title", ["Bob Jones"], { relatedDoi: "10.1234/example" });
  const c = paper("c", "Unrelated study", ["Alice Smith"]);
  const index = buildWorkIndex([a, b, c]);
  assert.equal(index.recordCount, 3);
  assert.equal(index.workCount, 2);
  assert.equal(index.duplicateGroupCount, 1);
  assert.equal(index.duplicatesRemoved, 1);
  assert.deepEqual(index.byPaperId.get(a.id), [a, b]);
  assert.equal(index.byPaperId.get(a.id), index.byPaperId.get(b.id));
  assert.deepEqual(index.byPaperId.get("c"), [c]);
});

test("ambiguous overlap bridges do not join incompatible authors and grouping is order-stable", () => {
  const a = paper("a", title, ["Alice Smith"]);
  const b = paper("b", title, ["Alice Smith", "Bob Jones"]);
  const c = paper("c", title, ["Bob Jones"]);
  const ids = (rows: Paper[]) =>
    groupWorks(rows)
      .map((group) => group.map((p) => p.id).sort())
      .sort();
  assert.deepEqual(ids([a, b, c]), [["a", "b"], ["c"]]);
  assert.deepEqual(ids([c, b, a]), [["a", "b"], ["c"]]);
});

test("reused normalized identities retain independent subset and replacement-record grouping", () => {
  const a = paper("a", title, ["Alice Smith"]);
  const b = paper("b", title, ["Alice Smith", "Bob Jones"]);
  const c = paper("c", title, ["Bob Jones"]);
  const cache = createWorkGroupingCache();
  assert.equal(buildWorkIndex([a, b, c], cache).workCount, 2);
  // A full-snapshot group projection would incorrectly keep b and c separate.
  assert.equal(buildWorkIndex([b, c], cache).workCount, 1);
  for (const rows of [[a, c], [c, b, a], [b], [{ ...b, title: "A corrected title" }, c]])
    assert.deepEqual(buildWorkIndex(rows, cache), buildWorkIndex(rows));
});
