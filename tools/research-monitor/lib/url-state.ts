import { TRACKS } from "./classify";
import type { DashboardDrill } from "./dashboard";
import {
  defaultPublicTeamState,
  defaultSourceBrowseState,
  parseSourceBrowseState,
  publicAuthorId,
  writeSourceBrowseState,
  type PublicTeamState,
  type SourceBrowseState,
} from "./public-browse-state";

export const WORKSPACE_ROUTES = {
  dashboard: "/papers/overview",
  feed: "/papers/library",
  analysis: "/papers/leads",
  github: "/github",
  news: "/news",
  foresight: "/outlook",
  teams: "/teams",
  saved: "/saved",
  sources: "/sources",
} as const;
export type WorkspaceView = keyof typeof WORKSPACE_ROUTES;
export type WorkspaceUrlState = {
  view: WorkspaceView;
  track: string;
  period: string;
  source: string;
  search: string;
  scope?: string;
  task?: string;
  modality?: string;
  organ?: string;
  method?: string;
  status?: string;
  human?: string;
  sort?: string;
  clock?: "publication" | "discovery";
  sourceBrowse?: SourceBrowseState;
  teamDirectory?: PublicTeamState;
  drill?: { label: string; origin: WorkspaceView };
};
export const DEFAULT_URL_STATE: WorkspaceUrlState = {
  view: "dashboard",
  track: "all",
  period: "30",
  source: "all",
  search: "",
  scope: "core",
};
const periods = new Set(["all", "7", "30", "90", "365"]);
const extraFilters = ["task", "modality", "organ", "method", "status", "human", "sort"] as const;
const drillStateKey = "researchMonitorDrill";
const defaultPeriod = (view: string) => (view === "dashboard" || view === "analysis" ? "30" : "all");

export function workspaceView(value: string): WorkspaceView {
  return Object.hasOwn(WORKSPACE_ROUTES, value) ? (value as WorkspaceView) : "dashboard";
}

export function parseWorkspaceHash(hash: string): WorkspaceUrlState {
  const raw = hash.replace(/^#/, "");
  const separator = raw.indexOf("?");
  const path = separator < 0 ? raw : raw.slice(0, separator);
  const query = separator < 0 ? "" : raw.slice(separator + 1);
  const view = Object.entries(WORKSPACE_ROUTES).find(([, route]) => route === path)?.[0];
  if (!view) return { ...DEFAULT_URL_STATE };
  const params = new URLSearchParams(query);
  const scope = params.get("scope");
  const publicBase = {
    ...DEFAULT_URL_STATE,
    view: workspaceView(view),
    period: defaultPeriod(view),
    scope: scope === "adjacent" || scope === "all" ? scope : "core",
  };
  if (view === "github" || view === "news") {
    const sourceBrowse = parseSourceBrowseState(view, params);
    const label = params.get("drill");
    if (label) sourceBrowse.tab = "library";
    return {
      ...publicBase,
      sourceBrowse,
      ...(label ? { drill: { label, origin: view } } : {}),
    };
  }
  if (view === "teams") {
    const directory = defaultPublicTeamState();
    const track = params.get("track") ?? "all";
    directory.track = Object.hasOwn(TRACKS, track) ? track : "all";
    directory.query = params.get("q") ?? "";
    directory.sort = params.get("sort") === "works" ? "works" : "senior";
    directory.tab = params.get("tab") === "saved" ? "saved" : "directory";
    directory.author = directory.tab === "directory" ? publicAuthorId(params.get("author") ?? "") : "";
    return { ...publicBase, teamDirectory: directory };
  }
  const track = params.get("track") ?? (view === "foresight" ? "segmentation" : "all");
  const period = params.get("days") ?? defaultPeriod(view);
  const label = params.get("drill");
  const validTrack = track === "all" || Object.hasOwn(TRACKS, track) ? track : "all";
  const extra: Partial<WorkspaceUrlState> = {};
  for (const key of extraFilters) {
    const value = params.get(key);
    if (value && value !== (key === "sort" ? "newest" : "all")) extra[key] = value;
  }
  return {
    view: workspaceView(view),
    track: view === "foresight" && validTrack === "all" ? "segmentation" : validTrack,
    period: periods.has(period) ? period : defaultPeriod(view),
    source: params.get("source") || "all",
    search: params.get("q") ?? "",
    scope: scope === "adjacent" || scope === "all" ? scope : "core",
    ...(params.get("clock") === "discovery" ? { clock: "discovery" as const } : {}),
    ...extra,
    ...(view === "feed" && label
      ? { drill: { label, origin: workspaceView(params.get("from") ?? "dashboard") } }
      : {}),
  };
}

export function serializeWorkspaceHash(state: WorkspaceUrlState): string {
  const params = new URLSearchParams();
  if (state.view === "github" || state.view === "news" || state.view === "teams") {
    if (state.scope && state.scope !== "core") params.set("scope", state.scope);
    if (state.view === "teams") {
      const directory = state.teamDirectory ?? defaultPublicTeamState();
      if (directory.track !== "all") params.set("track", directory.track);
      if (directory.query) params.set("q", directory.query);
      if (directory.sort !== "senior") params.set("sort", directory.sort);
      if (directory.tab === "saved") params.set("tab", "saved");
      const author = directory.tab === "directory" ? publicAuthorId(directory.author) : "";
      if (author) params.set("author", author);
    } else {
      writeSourceBrowseState(state.view, state.sourceBrowse ?? defaultSourceBrowseState(state.view), params);
      if (state.drill) {
        params.set("tab", "library");
        params.set("drill", state.drill.label);
      }
    }
    const query = params.toString();
    return `#${WORKSPACE_ROUTES[state.view]}${query ? `?${query}` : ""}`;
  }
  if (state.track !== "all") params.set("track", state.track);
  if (state.period !== defaultPeriod(state.view)) params.set("days", state.period);
  if (state.source !== "all") params.set("source", state.source);
  if (state.search) params.set("q", state.search);
  if (state.scope && state.scope !== "core") params.set("scope", state.scope);
  if (state.clock === "discovery") params.set("clock", state.clock);
  for (const key of extraFilters) {
    const value = state[key];
    if (value && value !== (key === "sort" ? "newest" : "all")) params.set(key, value);
  }
  if (state.view === "feed" && state.drill) {
    params.set("drill", state.drill.label);
    params.set("from", state.drill.origin);
  }
  const query = params.toString();
  return `#${WORKSPACE_ROUTES[state.view]}${query ? `?${query}` : ""}`;
}

export function withoutUnrestorableDrill(state: WorkspaceUrlState): WorkspaceUrlState {
  if (!state.drill) return state;
  const { drill, ...rest } = state;
  if (state.view === "github" || state.view === "news") {
    return {
      ...rest,
      sourceBrowse: { ...(rest.sourceBrowse ?? defaultSourceBrowseState(state.view)), tab: "overview" },
    };
  }
  if (drill.origin === "github" || drill.origin === "news") {
    return {
      ...DEFAULT_URL_STATE,
      view: drill.origin,
      period: "all",
      scope: rest.scope,
      sourceBrowse: defaultSourceBrowseState(drill.origin),
    };
  }
  if (drill.origin === "teams") {
    return {
      ...DEFAULT_URL_STATE,
      view: "teams",
      period: "all",
      scope: rest.scope,
      teamDirectory: defaultPublicTeamState(),
    };
  }
  return {
    ...rest,
    view: drill.origin === "feed" ? "dashboard" : drill.origin,
    track: drill.origin === "foresight" && rest.track === "all" ? "segmentation" : rest.track,
  };
}

export function initialWorkspaceUrlState(hash: string): WorkspaceUrlState {
  // IDs are deliberately absent from shared links, so a fresh document uses the originating overview.
  return withoutUnrestorableDrill(parseWorkspaceHash(hash));
}

export function languageHref(path: string, hash: string): string {
  return path.split("#", 1)[0] + (hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "");
}

type LocationState = { hash: string; historyState: unknown };
export type WorkspaceHistoryTarget = {
  read: () => LocationState;
  write: (method: "push" | "replace", hash: string, state: Record<string, unknown>) => void;
};
type RememberedDrill = { drill: DashboardDrill; origin: WorkspaceView; generation: string };

function historyFields(state: unknown): Record<string, unknown> {
  return state !== null && typeof state === "object" && !Array.isArray(state)
    ? { ...(state as Record<string, unknown>) }
    : {};
}

/** A hash/history adapter with document-local drill IDs and snapshot-generation checks. */
export function createWorkspaceHistory(
  target: WorkspaceHistoryTarget,
  getGeneration: (view: WorkspaceView) => string | undefined,
  onRestore: (state: WorkspaceUrlState, drill: DashboardDrill | null) => void,
) {
  let previous = initialWorkspaceUrlState(target.read().hash);
  let pendingRestore: string | null = null;
  let currentDrill: DashboardDrill | null = null;
  let currentDrillKey: string | undefined;
  let nextKey = 0;
  const documentKey = globalThis.crypto.randomUUID();
  const remembered = new Map<string, RememberedDrill>();
  const provenance = new WeakMap<DashboardDrill, RememberedDrill>();

  function commit(state: WorkspaceUrlState, drill: DashboardDrill | null) {
    const hash = serializeWorkspaceHash(state);
    // popstate batches several React setters; never write the preceding render back over it.
    if (pendingRestore && pendingRestore !== hash) return;
    pendingRestore = null;
    const location = target.read();
    const fields = historyFields(location.historyState);
    const generation = getGeneration(state.view);
    if (state.drill && drill && drill !== currentDrill && generation) {
      currentDrillKey = `${documentKey}:${++nextKey}`;
      const original = provenance.get(drill) ?? { drill, origin: state.drill.origin, generation };
      provenance.set(drill, original);
      remembered.set(currentDrillKey, original);
      currentDrill = drill;
    }
    const entryKey = state.drill ? currentDrillKey : undefined;
    const sameTab =
      previous.view === state.view &&
      ((state.view !== "github" && state.view !== "news") ||
        (previous.sourceBrowse?.tab ?? "overview") === (state.sourceBrowse?.tab ?? "overview")) &&
      (state.view !== "teams" ||
        (previous.teamDirectory?.tab ?? "directory") === (state.teamDirectory?.tab ?? "directory"));
    const method = sameTab ? "replace" : "push";
    previous = state;
    if (location.hash === hash && fields[drillStateKey] === entryKey) return;
    if (entryKey) fields[drillStateKey] = entryKey;
    else delete fields[drillStateKey];
    target.write(method, hash, fields);
  }

  function restore() {
    const location = target.read();
    let state = parseWorkspaceHash(location.hash);
    const fields = historyFields(location.historyState);
    const key = fields[drillStateKey];
    const saved = typeof key === "string" ? remembered.get(key) : undefined;
    const drill =
      state.drill &&
      saved &&
      saved.generation === getGeneration(state.view) &&
      saved.origin === state.drill.origin &&
      saved.drill.label === state.drill.label
        ? saved.drill
        : null;
    if (state.drill && !drill) {
      state = withoutUnrestorableDrill(state);
      delete fields[drillStateKey];
    }
    const hash = serializeWorkspaceHash(state);
    if (location.hash !== hash) target.write("replace", hash, fields);
    previous = state;
    pendingRestore = hash;
    currentDrill = drill;
    currentDrillKey = drill && typeof key === "string" ? key : undefined;
    onRestore(state, drill);
  }

  return { commit, restore };
}
