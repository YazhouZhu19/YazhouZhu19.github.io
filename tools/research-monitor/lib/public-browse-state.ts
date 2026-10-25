import type { SignalsManifest } from "./signals-snapshot";

/** Shareable browsing context only. Selection sets, analysis inputs and credentials stay local. */
export type SourceKind = "github" | "news";
/** Document-local selection: never serialized by the public URL helpers. */
export type SourceBrowseDrill = {
  label: string;
  ids: string[];
  global?: boolean;
  exactIds?: boolean;
  snapshotGeneration?: string;
};
export type SourceBrowseState = {
  query: string;
  category: string;
  relevance: "direct" | "candidate" | "all";
  from: string;
  to: string;
  sort: "latest" | "oldest" | "title" | "stars" | "forks";
  tab: "overview" | "library";
  range: 7 | 30 | 90 | "all" | "custom";
  clock: "activity" | "creation" | "publication" | "discovery";
  includeEarly: boolean;
  groupEvents: boolean;
};
export type PublicTeamState = {
  query: string;
  track: string;
  sort: "senior" | "works";
  author: string;
  tab: "directory" | "saved";
};

// Keep route validation independent of the lazy discovery/catalog modules.
// A test compares these IDs with the actual browse categories.
export const SOURCE_CATEGORY_IDS: Record<SourceKind, readonly string[]> = {
  github: [
    "diagnostic-tasks",
    "image-formation",
    "spatial-temporal",
    "foundation-multimodal",
    "learning-trustworthiness",
    "radiomics-treatment",
    "radiology-nuclear",
    "ultrasound-specialties",
    "pathology-microscopy",
    "organ-disease",
    "data-annotation-evaluation",
    "software-workflows",
    "general-resources",
  ],
  news: [
    "foundation-multimodal",
    "radiology-nuclear",
    "ultrasound-cardiovascular",
    "pathology-microscopy",
    "specialty-imaging",
    "neuroimaging",
    "segmentation-detection",
    "data-software",
    "clinical-trustworthiness",
    "general-progress",
  ],
};

export function defaultSourceBrowseState(kind: SourceKind): SourceBrowseState {
  return {
    query: "",
    category: "all",
    relevance: "all",
    from: "",
    to: "",
    sort: "latest",
    tab: "overview",
    range: 30,
    clock: kind === "github" ? "activity" : "publication",
    includeEarly: false,
    groupEvents: true,
  };
}

export function defaultPublicTeamState(): PublicTeamState {
  return { query: "", track: "all", sort: "senior", author: "", tab: "directory" };
}

export function publicAuthorId(value: string): string {
  return /^directory:orcid:\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(value) ||
    /^directory:name:[\p{L}\p{M}\p{N} .'-]{1,160}$/u.test(value)
    ? value
    : "";
}

export function publicTeamState(preferences: {
  teamId: string;
  query?: string;
  directoryTrack?: string;
  directorySort?: "senior" | "works";
  listSource?: "directory" | "saved";
}): PublicTeamState {
  const tab = preferences.listSource ?? "directory";
  return {
    query: preferences.query ?? "",
    track: preferences.directoryTrack ?? "all",
    sort: preferences.directorySort ?? "senior",
    author: tab === "directory" ? publicAuthorId(preferences.teamId) : "",
    tab,
  };
}

export function teamPreferencesFromPublic(state: PublicTeamState) {
  return {
    teamId: state.tab === "directory" ? publicAuthorId(state.author) : "",
    query: state.query,
    directoryTrack: state.track,
    directorySort: state.sort,
    listSource: state.tab,
  };
}

function validDay(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const time = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(time.getTime()) && time.toISOString().slice(0, 10) === value ? value : "";
}

export function parseSourceBrowseState(kind: SourceKind, params: URLSearchParams): SourceBrowseState {
  const state = defaultSourceBrowseState(kind);
  state.query = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  if (SOURCE_CATEGORY_IDS[kind].includes(category)) state.category = category;
  const relevance = params.get("relevance");
  if (relevance === "direct" || relevance === "candidate") state.relevance = relevance;
  const range = params.get("range");
  if (range === "7" || range === "30" || range === "90") state.range = Number(range) as 7 | 30 | 90;
  else if (range === "all" || range === "custom") state.range = range;
  // Do not silently reorder reversed bounds: the existing UI explains invalid windows.
  state.from = validDay(params.get("from"));
  state.to = validDay(params.get("to"));
  const clock = params.get("clock");
  if (kind === "github" && (clock === "activity" || clock === "creation")) state.clock = clock;
  if (kind === "news" && (clock === "publication" || clock === "discovery")) state.clock = clock;
  const sort = params.get("sort");
  if (
    sort === "latest" ||
    sort === "oldest" ||
    sort === "title" ||
    (kind === "github" && (sort === "stars" || sort === "forks"))
  )
    state.sort = sort;
  if (params.get("tab") === "library") state.tab = "library";
  state.includeEarly = kind === "github" && params.get("early") === "1";
  state.groupEvents = kind !== "news" || params.get("group") !== "0";
  return state;
}

export function writeSourceBrowseState(kind: SourceKind, state: SourceBrowseState, params: URLSearchParams) {
  const defaults = defaultSourceBrowseState(kind);
  if (state.query) params.set("q", state.query);
  if (state.category !== "all") params.set("category", state.category);
  if (state.relevance !== "all") params.set("relevance", state.relevance);
  if (state.from) params.set("from", state.from);
  if (state.to) params.set("to", state.to);
  if (state.range !== 30) params.set("range", String(state.range));
  if (state.clock !== defaults.clock) params.set("clock", state.clock);
  if (state.sort !== "latest") params.set("sort", state.sort);
  if (state.tab !== "overview") params.set("tab", state.tab);
  if (kind === "github" && state.includeEarly) params.set("early", "1");
  if (kind === "news" && !state.groupEvents) params.set("group", "0");
}

/** Only changes to this kind can invalidate its document-local selection. */
export function sourceBrowseGeneration(
  manifest: SignalsManifest | null,
  kind: SourceKind,
): string | undefined {
  if (!manifest) return undefined;
  return JSON.stringify([
    kind,
    manifest.schema,
    manifest.counts[kind],
    manifest.shards
      .filter((shard) => shard.kind === kind)
      .map((shard) => [shard.bucket, shard.sha256, shard.count]),
    manifest.discoveryState?.[kind]?.catalogVersion,
    kind === "github" ? manifest.overview.github.quality?.version : manifest.overview.news.events?.version,
  ]);
}
