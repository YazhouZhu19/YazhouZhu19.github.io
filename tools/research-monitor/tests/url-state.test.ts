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
    const state = { ...DEFAULT_URL_STATE, view, track: view === "foresight" ? "segmentation" : "all" };
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
  assert.deepEqual(initialWorkspaceUrlState(hash), { ...DEFAULT_URL_STATE, view: "github" });
  assert.equal(initialWorkspaceUrlState(hash.replace("from=github", "from=feed")).view, "dashboard");
  assert.equal(initialWorkspaceUrlState(hash.replace("from=github", "from=__proto__")).view, "dashboard");
  assert.equal(parseWorkspaceHash("#/news?drill=test&from=teams").drill, undefined);
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
