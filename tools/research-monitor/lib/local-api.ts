import { z } from "zod";
import type { Collection, MonitorData, Team } from "@/lib/types";

// A single key keeps an import (collections and teams together) atomic.
export const LOCAL_DATA_KEY = "medical-research-monitor:personal:v1";
export const BACKUP_SCHEMA = "medical-research-monitor-personal";
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024;
export const LOCAL_ERRORS = {
  unavailable: "浏览器本地存储不可用，个人数据无法保存",
  quota: "浏览器本地存储空间不足，请先导出备份并释放空间",
  corrupt: "本地个人数据格式错误，已停止写入以保护原始数据",
  backup: "备份格式或版本无效，未更改本地数据",
  tooLarge: "个人数据超过大小限制，未更改本地数据",
  input: "输入格式无效，请检查内容和长度",
  publicData: "公开论文数据格式无效，请稍后重试",
  network: "公开论文数据加载失败，请稍后重试",
  missingPaper: "该论文记录不存在",
  unsupported: "当前静态页面不支持此操作",
} as const;

const stageSchema = z.enum(["待读", "已读", "选题候选", "暂不相关"]);
const kindSchema = z.enum(["持续关注", "竞争观察", "合作候选"]);
const timestamp = z.string().max(40).datetime({ offset: true });
const paperId = z.string().min(1).max(500);
const name = z.string().trim().min(1).max(160);
const collectionInput = z.object({ paperId, note: z.string().max(20000).default(""), stage: stageSchema.default("待读") }).strict();
const collectionSchema = z.object({ paperId, note: z.string().max(20000), stage: stageSchema, createdAt: timestamp, updatedAt: timestamp }).strict()
  .refine(v => Date.parse(v.updatedAt) >= Date.parse(v.createdAt));
const teamInput = z.object({ name, members: z.array(name).min(1).max(30), institution: z.string().max(250).default(""), kind: kindSchema.default("持续关注") }).strict();
const teamSchema = z.object({ id: z.string().uuid(), name, members: z.array(name).min(1).max(30), institution: z.string().max(250), kind: kindSchema, createdAt: timestamp }).strict();
const personalShape = {
  schema: z.literal(BACKUP_SCHEMA),
  version: z.literal(1),
  collections: z.array(collectionSchema).max(5000).refine(rows => new Set(rows.map(r => r.paperId)).size === rows.length),
  teams: z.array(teamSchema).max(500).refine(rows => new Set(rows.map(r => r.id)).size === rows.length),
};
const personalSchema = z.object(personalShape).strict();
export const backupSchema = z.object({ ...personalShape, exportedAt: timestamp }).strict();
export type PersonalBackup = z.infer<typeof backupSchema>;
type PersonalData = z.infer<typeof personalSchema>;

// Public records are separately validated and never stored in personal backups.
const shortText = z.string().max(2000);
const labels = z.array(shortText).max(500);
const publicUrl = z.string().max(12000).url().refine(value => /^https?:\/\//i.test(value));
const dateText = z.string().max(40).refine(value => value === "" || Number.isFinite(Date.parse(value)));
const count = z.number().int().nonnegative();
const paperSchema = z.object({
  id: paperId, title: z.string().min(1).max(20000), abstract: z.string().max(500000),
  authors: z.array(z.object({ name: shortText, displayName: shortText.optional(), orcid: shortText.nullable().optional(), affiliations: labels })).max(5000),
  affiliations: labels, doi: shortText.nullable(), pmid: shortText.nullable().optional(), arxivId: shortText.nullable().optional(),
  source: shortText, sources: labels, sourceCollection: shortText.optional(), status: z.enum(["preprint", "published", "unknown"]),
  publishedAt: dateText, updatedAt: dateText.nullable(), firstSeenAt: timestamp, venue: shortText.nullable(), url: publicUrl,
  version: z.union([z.number().finite(), shortText]).nullable().optional(), relatedDoi: shortText.nullable().optional(),
  versions: z.array(z.object({ id: shortText.optional(), source: shortText.optional(), versionNumber: z.union([z.number().finite(), shortText]).optional(), firstPublishDate: dateText.optional() })).max(1000).optional(),
  tasks: labels, modalities: labels, organs: labels, methods: labels, humanSignals: labels,
  evidence: z.array(z.object({ label: shortText, excerpt: z.string().max(20000) })).max(500), tracks: labels, reviewStatus: shortText,
  provenance: z.array(z.object({ queryUrl: publicUrl.optional(), queryTrack: shortText.optional(), collectedAt: timestamp, sourceRecordId: shortText.optional() })).max(10000),
});
const runSchema = z.object({
  id: shortText, source: shortText, startedAt: timestamp, completedAt: timestamp, status: z.enum(["ok", "partial", "error"]),
  received: count, kept: count, added: count, updated: count, total: count.nullable(), query: z.string().max(50000),
  dateFrom: dateText, dateTo: dateText, error: z.string().max(10000).optional(), coverage: z.string().max(10000),
});
const querySchema = z.object({
  source: shortText, track: shortText, retrieved: count, hitCount: count.nullable(), startDate: dateText, endDate: dateText,
  dateField: shortText, query: z.string().max(50000), collectedAt: timestamp, url: publicUrl.optional(),
});
export const monitorDataSchema = z.object({
  totalStored: count.optional(), papers: z.array(paperSchema).max(100000), runs: z.array(runSchema).max(10000), queryRuns: z.array(querySchema).max(10000),
  collectedAt: timestamp, storageAvailable: z.boolean().optional(), error: z.string().max(10000).optional(),
  lastSuccessfulSync: timestamp.nullable(), coverage: z.string().max(10000),
});
export type LocalMonitorData = MonitorData & {
  publicDataAvailable: true;
  personalStorageAvailable: boolean;
  personalStorageReadable: boolean;
  personalStorageError?: string;
};
export type LocalStorageStatus = { available: boolean; readable: boolean; error?: string };

function localError(error: unknown): Error {
  if (error instanceof Error && Object.values(LOCAL_ERRORS).some(message => error.message === message)) return error;
  const errorName = error && typeof error === "object" && "name" in error ? error.name : "";
  return new Error(errorName === "QuotaExceededError" || errorName === "NS_ERROR_DOM_QUOTA_REACHED" ? LOCAL_ERRORS.quota : LOCAL_ERRORS.unavailable);
}

function storage(): Storage {
  try {
    if (typeof window === "undefined" || !window.localStorage) throw new Error(LOCAL_ERRORS.unavailable);
    return window.localStorage;
  } catch (error) { throw localError(error); }
}

function emptyData(): PersonalData {
  return { schema: BACKUP_SCHEMA, version: 1, collections: [], teams: [] };
}

function byteLength(value: string): number { return new TextEncoder().encode(value).byteLength; }

function checkedStringify(value: unknown, invalidMessage: string): string {
  let text: string;
  try { text = JSON.stringify(value); } catch { throw new Error(invalidMessage); }
  if (typeof text !== "string") throw new Error(invalidMessage);
  if (byteLength(text) > MAX_BACKUP_BYTES) throw new Error(LOCAL_ERRORS.tooLarge);
  return text;
}

function readData(target = storage()): PersonalData {
  let raw: string | null;
  try { raw = target.getItem(LOCAL_DATA_KEY); } catch (error) { throw localError(error); }
  if (raw === null) return emptyData();
  if (byteLength(raw) > MAX_BACKUP_BYTES) throw new Error(LOCAL_ERRORS.corrupt);
  try { return personalSchema.parse(JSON.parse(raw)); } catch { throw new Error(LOCAL_ERRORS.corrupt); }
}

function ensureWritable(target: Storage): void {
  const probe = `${LOCAL_DATA_KEY}:probe:${crypto.randomUUID()}`;
  try {
    target.setItem(probe, "1");
    if (target.getItem(probe) !== "1") throw new Error(LOCAL_ERRORS.unavailable);
    target.removeItem(probe);
  } catch (error) {
    try { target.removeItem(probe); } catch { /* Retain the original failure. */ }
    throw localError(error);
  }
}

export function getLocalStorageStatus(): LocalStorageStatus {
  let target: Storage;
  try { target = storage(); readData(target); } catch (error) { return { available: false, readable: false, error: localError(error).message }; }
  try { ensureWritable(target); return { available: true, readable: true }; }
  catch (error) { return { available: false, readable: true, error: localError(error).message }; }
}

function writeData(target: Storage, data: PersonalData): void {
  // Validate and serialize before touching the stored value. Web Storage setItem
  // is atomic: a quota failure leaves the previous entire snapshot intact.
  const result = personalSchema.safeParse(data);
  if (!result.success) throw new Error(LOCAL_ERRORS.input);
  // Reserve the export timestamp too, so every accepted local snapshot remains
  // exportable under the same file-size limit.
  checkedStringify({ ...result.data, exportedAt: new Date().toISOString() }, LOCAL_ERRORS.input);
  const text = checkedStringify(result.data, LOCAL_ERRORS.input);
  try {
    target.setItem(LOCAL_DATA_KEY, text);
    if (target.getItem(LOCAL_DATA_KEY) !== text) throw new Error(LOCAL_ERRORS.unavailable);
  } catch (error) { throw localError(error); }
}

export function validateBackup(parsed: unknown): PersonalBackup {
  // Strict schemas reject extra keys (including __proto__/constructor), and
  // parsing produces a fresh whitelist-only object; never merge imported data.
  const result = backupSchema.safeParse(parsed);
  if (!result.success) throw new Error(LOCAL_ERRORS.backup);
  checkedStringify(result.data, LOCAL_ERRORS.backup);
  return result.data;
}

export function exportBackup(): PersonalBackup {
  const backup = { ...readData(), exportedAt: new Date().toISOString() };
  return validateBackup(backup);
}

/** Call only after the UI explicitly confirms replacement of local data. */
export function importBackup(parsed: unknown): { collections: number; teams: number } {
  const backup = validateBackup(parsed);
  const target = storage();
  ensureWritable(target);
  writeData(target, { schema: backup.schema, version: backup.version, collections: backup.collections, teams: backup.teams });
  return { collections: backup.collections.length, teams: backup.teams.length };
}

/** Removes only this application's personal data; never clears the origin. */
export function clearLocalData(): void {
  const target = storage();
  try {
    target.removeItem(LOCAL_DATA_KEY);
    if (target.getItem(LOCAL_DATA_KEY) !== null) throw new Error(LOCAL_ERRORS.unavailable);
  } catch (error) { throw localError(error); }
}

let knownPaperIds: Set<string> | undefined;
async function readPublicData(init?: RequestInit): Promise<LocalMonitorData> {
  let raw: unknown;
  try {
    const response = await fetch(import.meta.env.BASE_URL + "data/papers.json", { cache: "no-cache", credentials: "omit", signal: init?.signal });
    if (!response.ok) throw new Error(LOCAL_ERRORS.network);
    raw = await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new Error(LOCAL_ERRORS.network);
  }
  const result = monitorDataSchema.safeParse(raw);
  if (!result.success) throw new Error(LOCAL_ERRORS.publicData);
  knownPaperIds = new Set(result.data.papers.map(paper => paper.id));
  const personal = getLocalStorageStatus();
  return {
    ...result.data, storageAvailable: true, publicDataAvailable: true,
    personalStorageAvailable: personal.available, personalStorageReadable: personal.readable, personalStorageError: personal.error,
  };
}

function parseBody<T extends z.ZodTypeAny>(schema: T, init?: RequestInit): z.output<T> {
  try {
    if (typeof init?.body !== "string" || byteLength(init.body) > 100000) throw new Error(LOCAL_ERRORS.input);
    return schema.parse(JSON.parse(init.body));
  } catch { throw new Error(LOCAL_ERRORS.input); }
}

type CollectionResponse = { collections: Collection[]; ok?: true };
type TeamResponse = { teams: Team[]; team?: Team; ok?: true };
export function api(url: "/api/papers", init?: RequestInit): Promise<LocalMonitorData>;
export function api(url: "/api/collections", init?: RequestInit): Promise<CollectionResponse>;
export function api(url: "/api/teams", init?: RequestInit): Promise<TeamResponse>;
export function api(url: string, init?: RequestInit): Promise<LocalMonitorData | CollectionResponse | TeamResponse>;
export async function api(url: string, init?: RequestInit): Promise<LocalMonitorData | CollectionResponse | TeamResponse> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (url === "/api/papers" && method === "GET") return readPublicData(init);
  if ((url !== "/api/collections" && url !== "/api/teams") || !["GET", "POST", "DELETE"].includes(method)) throw new Error(LOCAL_ERRORS.unsupported);
  const target = storage();
  const data = readData(target);
  if (method === "GET") return url === "/api/collections"
    ? { collections: data.collections.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) }
    : { teams: data.teams.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) };

  if (url === "/api/collections") {
    if (method === "POST") {
      const value = parseBody(collectionInput, init);
      if (!knownPaperIds) await readPublicData();
      if (!knownPaperIds?.has(value.paperId)) throw new Error(LOCAL_ERRORS.missingPaper);
      // Fetching the public snapshot may yield; reread to preserve intervening
      // changes made by another tab before doing the synchronous write.
      const current = readData(target);
      const existing = current.collections.find(row => row.paperId === value.paperId);
      const now = new Date().toISOString();
      const updatedAt = existing && Date.parse(existing.updatedAt) > Date.parse(now) ? existing.updatedAt : now;
      const saved = { ...value, createdAt: existing?.createdAt ?? now, updatedAt };
      current.collections = [saved, ...current.collections.filter(row => row.paperId !== value.paperId)];
      writeData(target, current);
      return { ok: true, collections: current.collections };
    }
    const { paperId: id } = parseBody(z.object({ paperId }).strict(), init);
    data.collections = data.collections.filter(row => row.paperId !== id);
    writeData(target, data);
    return { ok: true, collections: data.collections };
  }
  if (method === "POST") {
    const value = parseBody(teamInput, init);
    const team = { ...value, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    data.teams.unshift(team);
    writeData(target, data);
    return { ok: true, team, teams: data.teams };
  }
  const { id } = parseBody(z.object({ id: z.string().uuid() }).strict(), init);
  data.teams = data.teams.filter(row => row.id !== id);
  writeData(target, data);
  return { ok: true, teams: data.teams };
}
