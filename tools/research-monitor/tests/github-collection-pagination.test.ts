import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectResearchSignals,
  githubDiscoveryFingerprint,
  githubRepositoryFromUrl,
  githubSearchPlan,
  GITHUB_BACKFILL_SEARCH_REQUEST_BUDGET,
  GITHUB_SEARCH_REQUEST_BUDGET,
  SignalRateLimitError,
  type SignalFetch,
} from "../lib/collect-signals";
import { GITHUB_DISCOVERY_GROUPS } from "../lib/github-discovery";
import { emptyResearchSignalsData, type GitHubDiscoveryState } from "../lib/research-signals";

const now = "2026-10-15T00:00:00.000Z";
const firstQuery = GITHUB_DISCOVERY_GROUPS[0].queries[0];
const repository = (name: string, description = "Medical imaging toolkit") => ({
  full_name: name,
  private: false,
  html_url: `https://github.com/${name}`,
  description,
  created_at: "2020-01-01T00:00:00Z",
  updated_at: now,
  pushed_at: now,
  topics: [],
  stargazers_count: 2,
  forks_count: 0,
  open_issues_count: 0,
  archived: false,
  license: null,
  language: "Python",
});
const response = (total = 0, items: unknown[] = [], incomplete = false) => ({
  status: 200,
  body: JSON.stringify({ total_count: total, items, incomplete_results: incomplete }),
});
const fakeFetch: SignalFetch = async (url) => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "api.github.com");
  if (parsed.pathname === "/search/repositories") return response();
  if (/\/(readme|releases\/latest)$/.test(parsed.pathname)) return { status: 404, body: "" };
  return { status: 200, body: JSON.stringify(repository(parsed.pathname.slice(7))) };
};
const options = { now: new Date(now), force: true, githubOnly: true, githubToken: "test" } as const;
const savedState = (queue: GitHubDiscoveryState["queue"]): GitHubDiscoveryState => ({
  catalogVersion: githubDiscoveryFingerprint(),
  cursor: 0,
  queue,
  completedQueries: 0,
  repositoryCursor: 0,
  cycles: 0,
});

test("empty-page discovery resumes beyond the previous request budget instead of restarting", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    fetchText: fakeFetch,
  });
  const state = first.data.discoveryState!.github!;
  assert.equal(state.lastRun!.searchRequests, GITHUB_SEARCH_REQUEST_BUDGET);
  assert.equal(state.cursor, GITHUB_SEARCH_REQUEST_BUDGET);
  const calls: URL[] = [];
  const second = await collectResearchSignals(first.data, {
    ...options,
    fetchText: async (url) => {
      if (url.includes("/search/repositories")) calls.push(new URL(url));
      return fakeFetch(url);
    },
  });
  const plan = githubSearchPlan(5000);
  assert.equal(calls[0].searchParams.get("q"), plan[state.cursor].query);
  assert.equal(calls[0].searchParams.get("sort"), plan[state.cursor].sort === "updated" ? "updated" : null);
  assert(second.data.discoveryState!.github!.completedQueries > state.completedQueries);
});

test("GitHub pages collect all 250 matches while other catalog queries continue", async () => {
  const pages: number[] = [];
  const result = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    fetchText: async (url) => {
      const parsed = new URL(url);
      if (
        parsed.pathname !== "/search/repositories" ||
        parsed.searchParams.get("q") !== firstQuery ||
        parsed.searchParams.has("sort")
      )
        return fakeFetch(url);
      const page = Number(parsed.searchParams.get("page"));
      pages.push(page);
      assert.equal(parsed.searchParams.get("per_page"), "100");
      return response(
        250,
        Array.from({ length: Math.min(100, 250 - (page - 1) * 100) }, (_, index) =>
          repository(`Pagination/imaging-${(page - 1) * 100 + index}`),
        ),
      );
    },
  });
  assert.deepEqual(pages, [1, 2, 3]);
  assert.equal(
    result.data.records.filter((record) => record.id.startsWith("github:pagination/")).length,
    250,
  );
  assert.equal(result.data.sources[0].status, "ok");
});

test("over-1000 results split into disjoint created-date windows and retain parent matches", async () => {
  const windowQueries: string[] = [];
  const result = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    fetchText: async (url) => {
      const parsed = new URL(url),
        query = parsed.searchParams.get("q") ?? "";
      if (
        parsed.pathname !== "/search/repositories" ||
        !query.startsWith(firstQuery) ||
        parsed.searchParams.has("sort")
      )
        return fakeFetch(url);
      if (!query.includes(" created:")) return response(2501, [repository("Split/parent-match")]);
      windowQueries.push(query);
      return response(1, [repository(`Split/window-${windowQueries.length}`)]);
    },
  });
  assert.equal(windowQueries.length, 2);
  const windows = windowQueries.map((query) =>
    query.match(/created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})/)!.slice(1),
  );
  assert.equal(windows[0][0], "2008-01-01");
  assert.equal(windows[1][1], now.slice(0, 10));
  assert.equal(Date.parse(windows[1][0]) - Date.parse(windows[0][1]), 86400000);
  assert(result.data.records.some((record) => record.id === "github:split/parent-match"));
  assert.equal(result.data.discoveryState!.github!.lastRun!.splitQueries, 1);
  assert.equal(result.data.discoveryState!.github!.lastRun!.truncatedQueries, 0);
});

test("incomplete search responses are split even when total_count is below 1000", async () => {
  const result = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    fetchText: async (url) => {
      const parsed = new URL(url),
        query = parsed.searchParams.get("q") ?? "";
      if (
        parsed.pathname === "/search/repositories" &&
        query === firstQuery &&
        !parsed.searchParams.has("sort")
      )
        return response(5, [repository("Incomplete/imaging")], true);
      return fakeFetch(url);
    },
  });
  assert.equal(result.data.discoveryState!.github!.lastRun!.splitQueries, 1);
  assert.equal(result.data.discoveryState!.github!.lastRun!.incompleteQueries, 1);
});

test("later pages split their window when incomplete or newly over the result cap", async () => {
  for (const incomplete of [true, false]) {
    const pages: number[] = [],
      windows: string[] = [];
    const result = await collectResearchSignals(emptyResearchSignalsData(now), {
      ...options,
      fetchText: async (url) => {
        const parsed = new URL(url),
          query = parsed.searchParams.get("q") ?? "";
        if (
          parsed.pathname !== "/search/repositories" ||
          !query.startsWith(firstQuery) ||
          parsed.searchParams.has("sort")
        )
          return fakeFetch(url);
        if (query.includes(" created:")) {
          windows.push(query);
          return response(1, [repository(`LaterPage/window-${windows.length}`)]);
        }
        const page = Number(parsed.searchParams.get("page"));
        pages.push(page);
        if (page === 1)
          return response(
            200,
            Array.from({ length: 100 }, (_, index) => repository(`LaterPage/first-${index}`)),
          );
        return response(incomplete ? 200 : 2001, [repository("LaterPage/partial-second-page")], incomplete);
      },
    });
    assert.deepEqual(pages, [1, 2]);
    assert.equal(windows.length, 2, "the incomplete later page must resume through smaller windows");
    assert.equal(result.data.discoveryState!.github!.lastRun!.splitQueries, 1);
    assert.equal(result.data.discoveryState!.github!.lastRun!.incompleteQueries, Number(incomplete));
    assert.equal(
      result.data.records.filter((record) => record.id.startsWith("github:laterpage/")).length,
      103,
      "parent and earlier-page discoveries remain saved",
    );
  }
});

test("an incomplete later page in a single-day window remains queued until a complete response", async () => {
  const previous = emptyResearchSignalsData(now);
  const task: GitHubDiscoveryState["queue"][number] = {
    groupId: GITHUB_DISCOVERY_GROUPS[0].id,
    query: firstQuery,
    sort: "best-match",
    page: 2,
    from: "2026-10-14",
    to: "2026-10-14",
  };
  previous.discoveryState = { github: savedState([task]) };
  const isWindow = (url: string) =>
    new URL(url).searchParams.get("q") === `${firstQuery} created:2026-10-14..2026-10-14`;
  const first = await collectResearchSignals(previous, {
    ...options,
    fetchText: async (url) =>
      isWindow(url) ? response(200, [repository("IncompleteDay/partial-match")], true) : fakeFetch(url),
  });
  assert.deepEqual(
    first.data.discoveryState!.github!.queue.filter(
      (item) => item.query === firstQuery && item.from === task.from,
    ),
    [task],
  );
  assert.equal(first.data.sources[0].status, "partial");
  const second = await collectResearchSignals(first.data, {
    ...options,
    fetchText: async (url) =>
      isWindow(url)
        ? response(
            200,
            Array.from({ length: 100 }, (_, index) => repository(`IncompleteDay/recovered-${index}`)),
          )
        : fakeFetch(url),
  });
  assert(
    !second.data.discoveryState!.github!.queue.some(
      (item) => item.query === firstQuery && item.from === task.from,
    ),
  );
  assert.equal(
    second.data.records.filter((record) => record.id.startsWith("github:incompleteday/")).length,
    101,
  );
  assert(
    first.data.records.every((record) => second.data.records.some((current) => current.id === record.id)),
  );
});

test("a saturated single-day window stops at page 10 and reports unresolved truncation", async () => {
  const previous = emptyResearchSignalsData(now);
  previous.discoveryState = {
    github: savedState([
      {
        groupId: GITHUB_DISCOVERY_GROUPS[0].id,
        query: firstQuery,
        sort: "best-match",
        page: 1,
        from: "2026-10-14",
        to: "2026-10-14",
      },
    ]),
  };
  const pages: number[] = [];
  const result = await collectResearchSignals(previous, {
    ...options,
    fetchText: async (url) => {
      const parsed = new URL(url);
      if (!parsed.searchParams.get("q")?.includes("created:2026-10-14..2026-10-14")) return fakeFetch(url);
      const page = Number(parsed.searchParams.get("page"));
      pages.push(page);
      return response(
        1001,
        Array.from({ length: 100 }, (_, index) =>
          repository(`SingleDay/medical-${(page - 1) * 100 + index}`),
        ),
      );
    },
  });
  assert.deepEqual(pages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(
    result.data.records.filter((record) => record.id.startsWith("github:singleday/")).length,
    1000,
  );
  assert.equal(result.data.discoveryState!.github!.lastRun!.truncatedQueries, 1);
  assert.match(result.data.sources[0].coverage, /未解决截断 1/);
});

test("a rate-limited search is queued and retried on a later run without losing old records", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    fetchText: async (url) => {
      if (url.includes("/search/repositories")) throw new SignalRateLimitError(60000);
      return fakeFetch(url);
    },
  });
  assert.equal(first.data.discoveryState!.github!.queue.length, 1);
  const queued = first.data.discoveryState!.github!.queue[0];
  const queries: string[] = [];
  const second = await collectResearchSignals(first.data, {
    ...options,
    fetchText: async (url) => {
      const query = new URL(url).searchParams.get("q");
      if (query) queries.push(query);
      return fakeFetch(url);
    },
  });
  assert(queries.slice(0, 2).includes(queued.query));
  assert(
    first.data.records.every((record) => second.data.records.some((current) => current.id === record.id)),
  );
});

test("backfill uses the larger bounded budget and advances a recently cached snapshot", async () => {
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    fetchText: fakeFetch,
  });
  let calls = 0;
  const second = await collectResearchSignals(first.data, {
    ...options,
    force: false,
    discoveryMode: "backfill",
    fetchText: async (url) => {
      calls++;
      return fakeFetch(url);
    },
  });
  assert(calls <= 300);
  assert(second.data.discoveryState!.github!.lastRun!.searchRequests > GITHUB_SEARCH_REQUEST_BUDGET);
  assert(
    second.data.discoveryState!.github!.lastRun!.searchRequests <= GITHUB_BACKFILL_SEARCH_REQUEST_BUDGET,
  );
});

test("paper-linked repositories rotate and safe URLs never become arbitrary network destinations", async () => {
  const links = Array.from(
    { length: 21 },
    (_, index) => `https://github.com/Paper/code-${String(index).padStart(2, "0")}/tree/main`,
  );
  const unsafe = [
    "http://github.com/lab/code",
    "https://github.com.evil.example/lab/code",
    "https://token@github.com/lab/code",
    "https://api.github.com/repos/lab/code",
    "https://github.com/topics/imaging",
    "https://github.com:444/lab/code",
    "https://localhost/lab/code",
    "javascript:alert(1)",
  ];
  for (const url of unsafe) assert.equal(githubRepositoryFromUrl(url), null, url);
  assert.equal(githubRepositoryFromUrl("https://github.com/Lab/Code.git"), "Lab/Code");
  const fetchText: SignalFetch = async (url) => {
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "api.github.com");
    if (parsed.pathname.startsWith("/repos/Paper/") && !/\/(readme|releases\/latest)$/.test(parsed.pathname))
      return {
        status: 200,
        body: JSON.stringify(repository(parsed.pathname.slice(7), "Companion implementation")),
      };
    return fakeFetch(url);
  };
  const first = await collectResearchSignals(emptyResearchSignalsData(now), {
    ...options,
    repositoryUrls: [...links, ...unsafe],
    fetchText,
  });
  assert.equal(first.data.records.filter((record) => record.id.startsWith("github:paper/")).length, 20);
  const second = await collectResearchSignals(first.data, { ...options, repositoryUrls: links, fetchText });
  const projects = second.data.records.filter((record) => record.id.startsWith("github:paper/"));
  assert.equal(projects.length, 21);
  assert(
    projects.every(
      (project) =>
        project.relevance?.level === "candidate" && project.relevance.reasons.includes("paper-linked"),
    ),
  );
});

test("saved state with a stale catalog or noncatalog query cannot inject a search", async () => {
  const previous = emptyResearchSignalsData(now);
  previous.discoveryState = {
    github: savedState([{ groupId: "segmentation", query: "untrusted-query", sort: "best-match", page: 1 }]),
  };
  const queries: string[] = [];
  const result = await collectResearchSignals(previous, {
    ...options,
    fetchText: async (url) => {
      const query = new URL(url).searchParams.get("q");
      if (query) queries.push(query);
      return fakeFetch(url);
    },
  });
  assert(!queries.includes("untrusted-query"));
  assert.equal(result.data.discoveryState!.github!.catalogVersion, githubDiscoveryFingerprint());
});
