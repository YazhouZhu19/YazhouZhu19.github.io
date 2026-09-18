export type Author = { name: string; displayName?: string; orcid?: string | null; affiliations: string[] };
export type Paper = {
  id: string; title: string; abstract: string; originalAbstract?: string | null; authorString?: string | null; authors: Author[]; affiliations: string[];
  doi: string | null; pmid?: string | null; arxivId?: string | null;
  source: string; sources: string[]; sourceCollection?: string; status: "preprint" | "published" | "unknown";
  publishedAt: string; updatedAt: string | null; firstSeenAt: string; venue: string | null; url: string;
  version?: number | string | null; relatedDoi?: string | null; versions?: unknown[];
  tasks: string[]; modalities: string[]; organs: string[]; methods: string[]; humanSignals: string[];
  evidence: {label:string; excerpt:string}[]; tracks: string[]; reviewStatus: string;
  provenance: {queryUrl?:string;queryTrack?:string;collectedAt:string;sourceRecordId?:string}[];
};
export type SyncRun = { id:string; source:string; startedAt:string; completedAt:string; status:"ok"|"partial"|"error"; received:number; kept:number; added:number; updated:number; total:number|null; query:string; dateFrom:string; dateTo:string; error?:string; coverage:string };
export type Collection = {paperId:string;note:string;stage:string;createdAt:string;updatedAt:string};
export type Team = {id:string;name:string;members:string[];institution:string;kind:string;createdAt:string};
export type RequestLog = { url:string; collectedAt:string; source:string; runId?:string; track?:string; query?:string; status?:"ok"|"error"; httpStatus?:number; hitCount?:number; retrieved?:number; truncated?:boolean; error?:string; attempts?:number; [key:string]:unknown };
export type MonitorData = {publicDataAvailable?:boolean;personalStorageAvailable?:boolean;personalStorageReadable?:boolean;personalStorageError?:string;totalStored?:number;papers:Paper[];runs:SyncRun[];queryRuns:any[];requestLogs?:RequestLog[];collectedAt:string;storageAvailable:boolean;error?:string;lastSuccessfulSync:string|null;coverage:string;status?:"ok"|"partial"|"error";errors?:{source:string;message:string}[];[key:string]:unknown};
