import test from "node:test";
import assert from "node:assert/strict";
import { buildTeamDirectory, filterTeamDirectory } from "../lib/team-directory";
import { buildForesight } from "../lib/foresight";
import type { Author, Paper, Team } from "../lib/types";

const asOf = "2026-10-14";
const author = (name = "Alice Smith", patch: Partial<Author> = {}): Author => ({
  name,
  affiliations: ["Example University"],
  ...patch,
});
function paper(id: string, patch: Partial<Paper> = {}): Paper {
  return {
    id,
    title: "Medical imaging research",
    abstract: "",
    authors: [author()],
    affiliations: [],
    doi: null,
    source: "Europe PMC",
    sources: ["Europe PMC"],
    status: "published",
    publishedAt: "2026-10-01",
    updatedAt: null,
    firstSeenAt: "2026-10-14T01:00:00Z",
    venue: null,
    url: `https://example.org/${id}`,
    tasks: [],
    modalities: [],
    organs: [],
    methods: [],
    humanSignals: [],
    evidence: [],
    tracks: ["segmentation"],
    reviewStatus: "unreviewed",
    provenance: [],
    ...patch,
  };
}

test("directory requires classified papers with valid nonfuture publication dates", () => {
  const entries = buildTeamDirectory(
    [
      paper("valid"),
      paper("today", { publishedAt: asOf }),
      paper("timestamp", { publishedAt: "2026-10-10T12:30:00Z" }),
      paper("future", { publishedAt: "2026-10-15" }),
      paper("missing", { publishedAt: "" }),
      paper("short", { publishedAt: "2026-10" }),
      paper("rollover", { publishedAt: "2026-02-30" }),
      paper("malformed", { publishedAt: "2026-10-01-invalid" }),
      paper("padded", { publishedAt: " 2026-10-01 " }),
      paper("unclassified", { tracks: [] }),
    ],
    asOf,
  );
  assert.deepEqual(
    entries[0].papers.map((row) => row.id),
    ["today", "timestamp", "valid"],
  );
  assert.throws(() => buildTeamDirectory([], "2026-02-30"), /valid asOf/);
});

test("directory and foresight both exclude whitespace-padded publication dates", () => {
  const rows = [paper("valid"), paper("padded", { publishedAt: " 2026-10-01 " })];
  const [candidate] = buildTeamDirectory(rows, asOf);
  const result = buildForesight(rows, { now: new Date("2026-10-14T04:00:00Z") });
  assert.deepEqual(
    candidate.papers.map((row) => row.id),
    ["valid"],
  );
  assert.deepEqual(
    result.papers.map((row) => row.id),
    ["valid"],
  );
});

test("same-name distinct ORCIDs remain separate from one another and unknown identities", () => {
  const first = "0000-0001-2345-678X",
    second = "0000-0002-2345-6789";
  const entries = buildTeamDirectory(
    [
      paper("one", {
        authors: [author("Alice Smith", { orcid: ` https://www.orcid.org/${first.toLowerCase()}/ ` })],
      }),
      paper("one-other-record", { authors: [author("A. Smith", { orcid: first })] }),
      paper("two", { authors: [author("Alice Smith", { orcid: `https://orcid.org/${second}` })] }),
      paper("unknown", { authors: [author("Alice Smith")] }),
    ],
    asOf,
  );
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.find((entry) => entry.orcid === first)?.papers.map((row) => row.id),
    ["one", "one-other-record"],
  );
  assert.equal(entries[0].name, "Alice Smith");
  assert.equal(entries[0].member, first);
  assert.equal(entries[0].id, `directory:orcid:${first}`);
  assert.deepEqual(
    entries.find((entry) => entry.orcid === second)?.papers.map((row) => row.id),
    ["two"],
  );
  assert.equal(entries.find((entry) => !entry.orcid)?.id, "directory:name:alicesmith");
});

test("directory candidates retain their source papers when their normalized ORCID feeds foresight", () => {
  const orcid = "0000-0001-2345-678X";
  const rows = [
    orcid,
    ` https://www.orcid.org/${orcid.toLowerCase()}/ `,
    `\thttps://orcid.org/${orcid}/\n`,
  ].map((source, index) =>
    paper(`candidate-${index}`, { authors: [author("Alice Smith", { orcid: source })] }),
  );
  const [candidate] = buildTeamDirectory(rows, asOf);
  const team: Team = {
    id: candidate.id,
    name: candidate.name,
    members: [candidate.member],
    institution: "",
    kind: "持续关注",
    createdAt: asOf,
  };
  const result = buildForesight(candidate.papers, { team, now: new Date("2026-10-14T04:00:00Z") });
  assert.equal(candidate.member, orcid);
  assert.deepEqual(result.papers.map((row) => row.id).sort(), rows.map((row) => row.id).sort());
  assert.equal(result.current.length, 3);
});

test("normalizes unverified names, deduplicates paper IDs and never mutates source data", () => {
  const repeated = paper("same", { authors: [author("Alice Smith"), author("Alice Smith")] });
  const rows = [repeated, { ...repeated }, paper("second", { authors: [author("Alice-Smith")] })];
  const original = JSON.stringify(rows);
  const entries = buildTeamDirectory(rows, asOf);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].papers.length, 2);
  assert.equal(entries[0].orcid, null);
  assert.equal(
    entries[0].papers.find((row) => row.id === "same"),
    repeated,
  );
  filterTeamDirectory(entries, { track: "segmentation", query: "" });
  assert.equal(JSON.stringify(rows), original);
});

test("direction selection recomputes paper counts, tags, affiliations and rank within that scope", () => {
  const rows = [
    paper("alice-seg", { authors: [author("Alice Smith", { affiliations: ["Segmentation Lab"] })] }),
    paper("alice-foundation-1", {
      tracks: ["foundation"],
      authors: [author("Alice Smith", { affiliations: ["Foundation Lab"] })],
    }),
    paper("alice-foundation-2", {
      tracks: ["foundation"],
      authors: [author("Alice Smith", { affiliations: ["Foundation Lab"] })],
    }),
    paper("bob-seg-1", { authors: [author("Bob Jones")] }),
    paper("bob-seg-2", { authors: [author("Bob Jones")] }),
  ];
  const entries = buildTeamDirectory(rows, asOf);
  assert.equal(entries[0].name, "Alice Smith");
  assert.deepEqual(
    filterTeamDirectory(entries, { track: "segmentation", query: "" }).map((entry) => [
      entry.name,
      entry.papers.length,
    ]),
    [["Bob Jones", 2]],
  );
  const search = filterTeamDirectory(entries, { track: "segmentation", query: "alice" });
  assert.equal(search[0].papers.length, 1);
  assert.deepEqual(search[0].tracks, ["segmentation"]);
  assert.deepEqual(search[0].affiliations, ["Segmentation Lab"]);
  assert.equal(filterTeamDirectory(entries, { track: "segmentation", query: "Foundation Lab" }).length, 0);
  assert.equal(
    filterTeamDirectory(entries, { track: "foundation", query: "Foundation Lab" })[0].papers.length,
    2,
  );
  assert.deepEqual(filterTeamDirectory(entries, { track: "missing", query: "" }), []);
  assert.equal(entries[0].papers.length, 3);
});

test("default lists exclude single-paper and abbreviated names while explicit searches can find them", () => {
  const rows = [
    ...["one", "two"].flatMap((id) => [
      paper(`initials-${id}`, { authors: [author("Li Y")] }),
      paper(`full-${id}`),
      paper(`orcid-${id}`, { authors: [author("A. Jones", { orcid: "0000-0002-2345-6789" })] }),
    ]),
    paper("single", { authors: [author("Single Author")] }),
  ];
  const entries = buildTeamDirectory(rows, asOf);
  assert.deepEqual(
    filterTeamDirectory(entries, { track: "all", query: "" }).map((entry) => entry.name),
    ["A. Jones", "Alice Smith"],
  );
  assert.equal(filterTeamDirectory(entries, { track: "all", query: "li y" })[0].abbreviated, true);
  assert.equal(filterTeamDirectory(entries, { track: "all", query: "Single Author" })[0].papers.length, 1);
  assert.equal(
    filterTeamDirectory(entries, { track: "all", query: "0000-0002-2345-6789" })[0].name,
    "A. Jones",
  );
  assert.equal(
    filterTeamDirectory(entries, { track: "all", query: "https://www.orcid.org/0000-0002-2345-6789" })[0]
      .name,
    "A. Jones",
  );
});

test("paper count is the primary rank before known identity and full-name tie breakers", () => {
  const rows = [
    paper("a"),
    paper("b"),
    paper("c"),
    paper("orcid-a", { authors: [author("A. Jones", { orcid: "0000-0002-2345-6789" })] }),
    paper("orcid-b", { authors: [author("A. Jones", { orcid: "0000-0002-2345-6789" })] }),
    paper("initial-a", { authors: [author("Li Y")] }),
    paper("initial-b", { authors: [author("Li Y")] }),
    paper("full-a", { authors: [author("Zelda Long")] }),
    paper("full-b", { authors: [author("Zelda Long")] }),
  ];
  assert.deepEqual(
    buildTeamDirectory(rows, asOf).map((entry) => entry.name),
    ["Alice Smith", "A. Jones", "Zelda Long", "Li Y"],
  );
});
