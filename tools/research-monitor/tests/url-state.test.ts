import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceHistory,
  DEFAULT_URL_STATE,
  initialWorkspaceUrlState,
  languageHref,
  parseWorkspaceHash,
  serializeWorkspaceHash,
  WORKSPACE_ROUTES,
  type WorkspaceHistoryTarget,
  type WorkspaceUrlState,
} from "../lib/url-state";

test("every workspace view has a language-independent, round-trippable hash", () => {
  for (const view of Object.keys(WORKSPACE_ROUTES) as WorkspaceUrlState["view"][]) {
    const state = parseWorkspaceHash(`#${WORKSPACE_ROUTES[view]}`);
    assert.deepEqual(parseWorkspaceHash(serializeWorkspaceHash(state)), state);
  }
  assert.equal(
    serializeWorkspaceHash({ ...DEFAULT_URL_STATE, view: "feed", period: "all" }),
    "#/papers/library",
  );
});

test("filters, Unicode queries and optional scope round-trip without becoming URL delimiters", () => {
  const state: WorkspaceUrlState = {
    view: "feed",
    track: "segmentation",
    period: "90",
    source: "Europe PMC",
    search: "脑肿瘤 & MRI? 100% #一区",
    scope: "core",
    task: "segmentation",
    modality: "MRI",
    organ: "Brain",
    method: "Transformer",
    status: "preprint",
    human: "interaction",
    sort: "oldest",
  };
  assert.deepEqual(parseWorkspaceHash(serializeWorkspaceHash(state)), state);
  assert.equal(serializeWorkspaceHash(DEFAULT_URL_STATE), "#/papers/overview");
});

test("unknown routes, invalid track/window and hostile prototype keys fall back safely", () => {
  for (const hash of ["", "#", "#/missing", "#/papers/library/other"]) {
    assert.deepEqual(parseWorkspaceHash(hash), DEFAULT_URL_STATE);
  }
  assert.deepEqual(parseWorkspaceHash("#/papers/library?track=__proto__&days=-3&unrelated=yes"), {
    ...DEFAULT_URL_STATE,
    view: "feed",
    period: "all",
  });
});

test("drill links contain metadata only and fresh documents fall back to their overview", () => {
  const state: WorkspaceUrlState = {
    ...DEFAULT_URL_STATE,
    view: "feed",
    drill: { label: "分割 · 近30天", origin: "github" },
  };
  const hash = serializeWorkspaceHash(state);
  assert.deepEqual(parseWorkspaceHash(hash), state);
  assert.deepEqual(initialWorkspaceUrlState(hash), parseWorkspaceHash("#/github"));
  assert.equal(initialWorkspaceUrlState(hash.replace("from=github", "from=feed")).view, "dashboard");
  assert.equal(initialWorkspaceUrlState(hash.replace("from=github", "from=__proto__")).view, "dashboard");
  assert.deepEqual(parseWorkspaceHash("#/news?drill=test&from=teams").drill, {
    label: "test",
    origin: "news",
  });
});

test("both language links preserve the entire hash", () => {
  const hash = "#/papers/library?track=segmentation&q=%E8%84%91";
  assert.equal(languageHref("/research-monitor/", hash), `/research-monitor/${hash}`);
  assert.equal(languageHref("/research-monitor/en/", hash), `/research-monitor/en/${hash}`);
});

function historyFixture() {
  const entries = [{ hash: "#/papers/overview", historyState: { unrelated: "kept" } as unknown }];
  let index = 0;
  const writes: ("push" | "replace")[] = [];
  const target: WorkspaceHistoryTarget = {
    read: () => entries[index],
    write: (method, hash, historyState) => {
      writes.push(method);
      if (method === "push") {
        entries.splice(++index);
        entries.push({ hash, historyState });
      } else entries[index] = { hash, historyState };
    },
  };
  return { target, writes, entries, back: () => index--, forward: () => index++ };
}

test("view switches push, filters replace, and back/forward restore the matching filters", () => {
  const h = historyFixture();
  let restored: WorkspaceUrlState | undefined;
  const controller = createWorkspaceHistory(
    h.target,
    () => "g1",
    (state) => {
      restored = state;
    },
  );
  const library = { ...DEFAULT_URL_STATE, view: "feed" as const };
  controller.commit(library, null);
  const filtered = { ...library, track: "segmentation", period: "90" };
  controller.commit(filtered, null);
  controller.commit({ ...filtered, view: "teams" }, null);
  assert.deepEqual(h.writes, ["push", "replace", "push"]);
  h.back();
  controller.restore();
  assert.deepEqual(restored, filtered);
  // An effect from the preceding render cannot undo a popstate that is still being applied.
  controller.commit({ ...filtered, view: "teams" }, null);
  assert.equal(h.target.read().hash, serializeWorkspaceHash(filtered));
  controller.commit(filtered, null);
  assert.deepEqual(h.target.read().historyState, { unrelated: "kept" });
  h.forward();
  controller.restore();
  assert.equal(restored?.view, "teams");
});

test("drill IDs survive document-local history only while their snapshot generation matches", () => {
  const h = historyFixture();
  let generation = "g1";
  let restored: { state: WorkspaceUrlState; drill: { ids: string[]; label: string } | null } | undefined;
  const controller = createWorkspaceHistory(
    h.target,
    () => generation,
    (state, drill) => {
      restored = { state, drill };
    },
  );
  const drill = { label: "Model evaluation", ids: ["paper-secret-1", "paper-secret-2"] };
  const state: WorkspaceUrlState = {
    ...DEFAULT_URL_STATE,
    view: "feed",
    drill: { label: drill.label, origin: "analysis" },
  };
  controller.commit(state, drill);
  assert.ok(!JSON.stringify(h.entries).includes("paper-secret-1"));
  controller.commit({ ...DEFAULT_URL_STATE, view: "teams" }, drill);
  h.back();
  controller.restore();
  assert.equal(restored?.drill, drill);
  controller.commit(state, drill);
  generation = "g2";
  h.forward();
  controller.restore();
  controller.commit(restored!.state, null);
  h.back();
  controller.restore();
  assert.equal(restored?.state.view, "analysis");
  assert.equal(restored?.drill, null);
  assert.equal(h.target.read().hash, "#/papers/leads");
});

test("new documents cannot restore old history tokens even when the snapshot is unchanged", () => {
  const h = historyFixture();
  const state: WorkspaceUrlState = {
    ...DEFAULT_URL_STATE,
    view: "feed",
    drill: { label: "Topic", origin: "foresight" },
  };
  createWorkspaceHistory(
    h.target,
    () => "g1",
    () => {},
  ).commit(state, { label: "Topic", ids: ["a"] });
  let restored: WorkspaceUrlState | undefined;
  createWorkspaceHistory(
    h.target,
    () => "g1",
    (next) => {
      restored = next;
    },
  ).restore();
  assert.equal(restored?.view, "foresight");
  assert.ok(!h.target.read().hash.includes("drill="));
});

test("a new drill with the same label after reload cannot reuse an earlier document's IDs", () => {
  const h = historyFixture();
  const state: WorkspaceUrlState = {
    ...DEFAULT_URL_STATE,
    view: "feed",
    drill: { label: "Same label", origin: "teams" },
  };
  createWorkspaceHistory(
    h.target,
    () => "g1",
    () => {},
  ).commit(state, {
    label: "Same label",
    ids: ["old"],
  });
  let restoredDrill: unknown;
  const nextDocument = createWorkspaceHistory(
    h.target,
    () => "g1",
    (_, drill) => {
      restoredDrill = drill;
    },
  );
  nextDocument.commit(state, { label: "Same label", ids: ["new"] });
  h.back();
  nextDocument.restore();
  assert.equal(restoredDrill, null);
  assert.ok(!h.target.read().hash.includes("drill="));
});

test("dashboard defaults and seven-day discovery windows restore without changing their meaning", () => {
  assert.equal(parseWorkspaceHash("#/papers/overview").period, "30");
  assert.equal(parseWorkspaceHash("#/papers/leads").period, "30");
  assert.equal(parseWorkspaceHash("#/papers/library").period, "all");
  const state: WorkspaceUrlState = { ...DEFAULT_URL_STATE, period: "7", clock: "discovery" };
  assert.deepEqual(parseWorkspaceHash(serializeWorkspaceHash(state)), state);
  assert.equal(parseWorkspaceHash("#/papers/overview?days=all").period, "all");
});

test("editing filters cannot promote old drill IDs to a newer snapshot generation", () => {
  const h = historyFixture();
  let generation = "g1";
  let restored: WorkspaceUrlState | undefined;
  const controller = createWorkspaceHistory(
    h.target,
    () => generation,
    (state) => {
      restored = state;
    },
  );
  const drill = { label: "Topic", ids: ["old"] };
  const state: WorkspaceUrlState = {
    ...DEFAULT_URL_STATE,
    view: "feed",
    drill: { label: drill.label, origin: "dashboard" },
  };
  controller.commit(state, drill);
  generation = "g2";
  controller.commit({ ...state, search: "new filter" }, drill);
  controller.commit({ ...DEFAULT_URL_STATE, view: "teams" }, drill);
  h.back();
  controller.restore();
  assert.equal(restored?.view, "dashboard");
  assert.equal(restored?.search, "new filter");
});

test("GitHub and news restore independent public browse controls without paper filter leakage", () => {
  for (const hash of [
    "#/github?q=%E8%84%91%20%26%20MRI&category=diagnostic-tasks&relevance=direct&range=custom&from=2026-01-01&to=2026-10-20&clock=creation&sort=stars&tab=library&early=1",
    "#/news?q=foundation%3F%20%23model&category=foundation-multimodal&relevance=candidate&range=90&clock=discovery&sort=oldest&tab=library&group=0",
  ]) {
    const parsed = parseWorkspaceHash(hash);
    assert.deepEqual(parseWorkspaceHash(serializeWorkspaceHash(parsed)), parsed);
    assert.deepEqual(initialWorkspaceUrlState(hash), parsed);
    assert.equal(parsed.source, "all");
    assert.equal(parsed.search, "");
    assert.equal(parsed.track, "all");
    const polluted = {
      ...parsed,
      source: "secret source",
      search: "private paper search",
      task: "diagnosis",
      ids: ["private-id"],
      apiKey: "secret-key",
    };
    const serialized = serializeWorkspaceHash(polluted);
    assert.ok(
      !serialized.includes("secret") && !serialized.includes("private") && !serialized.includes("task="),
    );
  }
  const github = parseWorkspaceHash("#/github").sourceBrowse!;
  const news = parseWorkspaceHash("#/news").sourceBrowse!;
  assert.equal(github.clock, "activity");
  assert.equal(news.clock, "publication");
  assert.equal(github.tab, "overview");
  assert.equal(github.range, 30);
  assert.equal(github.includeEarly, false);
  assert.equal(news.groupEvents, true);
});

test("source enum and date validation rejects unknown and cross-source controls", () => {
  const github = parseWorkspaceHash(
    "#/github?category=__proto__&relevance=__proto__&range=365&clock=publication&sort=invalid&tab=analyze&from=2026-02-30&to=bad&early=true&group=0",
  ).sourceBrowse!;
  assert.deepEqual(github, parseWorkspaceHash("#/github").sourceBrowse);
  const news = parseWorkspaceHash(
    "#/news?category=diagnostic-tasks&clock=creation&sort=stars&early=1&tab=compare&analyze=1&apiKey=secret&compareIds=repo-1",
  ).sourceBrowse!;
  assert.deepEqual(news, parseWorkspaceHash("#/news").sourceBrowse);
  const reversed = parseWorkspaceHash("#/news?range=custom&from=2026-10-20&to=2026-01-01").sourceBrowse!;
  assert.equal(reversed.from, "2026-10-20");
  assert.equal(reversed.to, "2026-01-01");
  assert.equal(reversed.range, "custom");
});

test("public PI selection and directory filters round-trip, while private watchlist IDs never do", () => {
  const hash = "#/teams?scope=all&track=segmentation&sort=works&q=Alex&author=directory%3Aname%3Aalexexample";
  const state = parseWorkspaceHash(hash);
  assert.deepEqual(parseWorkspaceHash(serializeWorkspaceHash(state)), state);
  assert.equal(state.teamDirectory?.author, "directory:name:alexexample");
  assert.equal(state.teamDirectory?.sort, "works");
  assert.equal(parseWorkspaceHash("#/teams?author=private-watchlist-123").teamDirectory?.author, "");
  assert.equal(
    parseWorkspaceHash("#/teams?author=directory%3Aorcid%3A0000-0002-1825-0097").teamDirectory?.author,
    "directory:orcid:0000-0002-1825-0097",
  );
  assert.equal(parseWorkspaceHash("#/teams?author=directory%3Aorcid%3Anot-valid").teamDirectory?.author, "");
  const saved = {
    ...state,
    teamDirectory: { ...state.teamDirectory!, tab: "saved" as const, author: "private-watchlist-123" },
  };
  assert.ok(!serializeWorkspaceHash(saved).includes("author="));
  assert.equal(parseWorkspaceHash(serializeWorkspaceHash(saved)).teamDirectory?.tab, "saved");
});

test("one history controller restores source tabs and PI filters without a stale render overwriting them", () => {
  const h = historyFixture();
  let restored: WorkspaceUrlState | undefined;
  const history = createWorkspaceHistory(
    h.target,
    () => "g1",
    (next) => {
      restored = next;
    },
  );
  const github = parseWorkspaceHash("#/github?range=90&category=diagnostic-tasks");
  const githubLibrary = parseWorkspaceHash(
    "#/github?range=90&category=diagnostic-tasks&tab=library&sort=forks",
  );
  const filtered = { ...githubLibrary, sourceBrowse: { ...githubLibrary.sourceBrowse!, query: "CT & MRI" } };
  const news = parseWorkspaceHash("#/news?tab=library&group=0&clock=discovery");
  const teams = parseWorkspaceHash(
    "#/teams?track=segmentation&sort=works&q=Alex&author=directory%3Aname%3Aalexexample",
  );
  history.commit(github, null);
  history.commit(githubLibrary, null);
  history.commit(filtered, null);
  history.commit(news, null);
  history.commit(teams, null);
  assert.deepEqual(h.writes, ["push", "push", "replace", "push", "push"]);
  h.back();
  history.restore();
  assert.deepEqual(restored, news);
  history.commit(teams, null);
  assert.equal(h.target.read().hash, serializeWorkspaceHash(news));
  history.commit(news, null);
  h.back();
  history.restore();
  assert.deepEqual(restored, filtered);
  history.commit(filtered, null);
  h.forward();
  history.restore();
  history.commit(restored!, null);
  h.forward();
  history.restore();
  assert.deepEqual(restored, teams);
  history.commit(teams, null);
  const writes = h.writes.length;
  history.commit(teams, null);
  assert.equal(h.writes.length, writes);
});

test("source drill shared links return to the same overview without broadening a library selection", () => {
  for (const kind of ["github", "news"] as const) {
    const state = parseWorkspaceHash(`#/${kind}?tab=library&range=90&q=MRI&drill=October%20subset`);
    assert.deepEqual(state.drill, { label: "October subset", origin: kind });
    const restored = initialWorkspaceUrlState(serializeWorkspaceHash(state));
    assert.equal(restored.view, kind);
    assert.equal(restored.sourceBrowse?.tab, "overview");
    assert.equal(restored.sourceBrowse?.range, 90);
    assert.equal(restored.sourceBrowse?.query, "MRI");
    assert.equal(restored.drill, undefined);
    assert.ok(!serializeWorkspaceHash(restored).includes("drill="));
  }
});

test("same-document source drill restoration is tied to source generation, independently of papers", () => {
  const h = historyFixture();
  let sourceGeneration = "source-1",
    paperGeneration = "paper-1";
  let restored: { state: WorkspaceUrlState; drill: unknown } | undefined;
  const history = createWorkspaceHistory(
    h.target,
    (view) => (view === "github" || view === "news" ? sourceGeneration : paperGeneration),
    (state, drill) => {
      restored = { state, drill };
    },
  );
  const state = parseWorkspaceHash("#/github?tab=library&range=all&sort=forks&drill=Top%20forks");
  const drill = { label: "Top forks", ids: ["private-repo-1"], exactIds: true };
  history.commit(state, drill);
  history.commit(parseWorkspaceHash("#/news"), null);
  paperGeneration = "paper-2";
  h.back();
  history.restore();
  assert.equal(restored?.drill, drill);
  history.commit(restored!.state, drill);
  assert.ok(!JSON.stringify(h.entries).includes("private-repo-1"));
  sourceGeneration = "source-2";
  // Editing an old drill cannot bless its IDs with a newer source generation.
  history.commit({ ...state, sourceBrowse: { ...state.sourceBrowse!, sort: "stars" } }, drill);
  history.commit(parseWorkspaceHash("#/news"), null);
  h.back();
  history.restore();
  assert.equal(restored?.drill, null);
  assert.equal(restored?.state.view, "github");
  assert.equal(restored?.state.sourceBrowse?.tab, "overview");
  assert.equal(restored?.state.sourceBrowse?.sort, "stars");
  history.commit(restored!.state, null);
  assert.ok(!h.target.read().hash.includes("drill="));
});
