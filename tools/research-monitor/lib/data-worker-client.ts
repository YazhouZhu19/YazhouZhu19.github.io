import type { PaperIndexSummary, PaperSearchIndex } from "./paper-index";
import type { VerifiedPublicData } from "./public-data-schema";
import type { PublicPaperSnapshot } from "./public-paper-loader";

export type DataWorkerRequest =
  | { type: "load"; id: number; baseUrl: string; knownGeneration?: string }
  | { type: "search"; id: number; generation: string; query: string }
  | { type: "accept"; id: number; generation: string }
  | { type: "cancel"; id: number };
export type DataWorkerResponse =
  | { type: "ready" }
  | { type: "papers"; id: number; generation: string; offset: number; papers: VerifiedPublicData["papers"] }
  | {
      type: "loaded";
      id: number;
      generation: string;
      metadata: Omit<VerifiedPublicData, "papers">;
      index: PaperIndexSummary;
      count: number;
      unchanged: boolean;
    }
  | { type: "searched"; id: number; generation: string; ids: string[] }
  | { type: "error"; id: number; name: string; message: string; kind?: "format" | "network" };
export type PaperDataResult = PublicPaperSnapshot & { index: PaperIndexSummary; mode: "worker" | "main" };
export type PaperSearchResult = { ids: string[]; generation: string };
export type DataWorkerPort = Pick<
  Worker,
  "postMessage" | "addEventListener" | "removeEventListener" | "terminate"
>;

class WorkerUnavailableError extends Error {
  constructor() {
    super("Paper data Worker unavailable");
    this.name = "WorkerUnavailableError";
  }
}
export class StalePaperGenerationError extends Error {
  constructor() {
    super("Paper search belongs to a previous snapshot");
    this.name = "StalePaperGenerationError";
  }
}
const cancelled = () => new DOMException("Paper request cancelled", "AbortError");

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

type Pending = {
  type: "load" | "search";
  generation?: string;
  papers: VerifiedPublicData["papers"];
  resolve(value: any): void;
  reject(error: unknown): void;
  cleanup(): void;
};
type Options = {
  baseUrl: string;
  workerFactory?: () => DataWorkerPort;
  fallbackLoad?: (signal?: AbortSignal) => Promise<PublicPaperSnapshot>;
  startupTimeoutMs?: number;
};

/** Keep parsing/validation/indexing off the UI thread; fall back only on Worker transport failure. */
export function createDataWorkerClient(options: Options) {
  const baseUrl =
    typeof location === "undefined" ? options.baseUrl : new URL(options.baseUrl, location.href).href;
  let worker: DataWorkerPort | undefined;
  let ready: Promise<void> | undefined;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: unknown) => void) | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let unavailable = false,
    disposed = false,
    sequence = 0;
  let activeLoad: AbortController | undefined, activeSearch: AbortController | undefined;
  let latest: PaperDataResult | undefined;
  let fallbackIndex: { generation: string; index: PaperSearchIndex } | undefined;
  let fallbackLoader:
    | Awaited<ReturnType<(typeof import("./public-paper-loader"))["createPublicPaperLoader"]>>
    | undefined;
  const pending = new Map<number, Pending>();

  const detach = () => {
    if (!worker) return;
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onFailure);
    worker.removeEventListener("messageerror", onFailure);
    worker.terminate();
    worker = undefined;
  };
  const fail = () => {
    unavailable = true;
    if (startupTimer) clearTimeout(startupTimer);
    const error = new WorkerUnavailableError();
    readyReject?.(error);
    readyReject = undefined;
    readyResolve = undefined;
    for (const request of pending.values()) {
      request.cleanup();
      request.reject(error);
    }
    pending.clear();
    detach();
  };
  function onFailure() {
    fail();
  }
  function onMessage(event: Event) {
    const message = (event as MessageEvent<DataWorkerResponse>).data;
    if (message?.type === "ready") {
      if (startupTimer) clearTimeout(startupTimer);
      readyResolve?.();
      readyResolve = undefined;
      readyReject = undefined;
      return;
    }
    if (!message || !("id" in message)) return;
    const request = pending.get(message.id);
    if (!request) return; // Cancelled and superseded messages are never published.
    if (message.type === "papers") {
      if (
        request.type !== "load" ||
        message.offset !== request.papers.length ||
        (request.generation && request.generation !== message.generation)
      ) {
        fail();
        return;
      }
      request.generation = message.generation;
      request.papers.push(...message.papers);
      return;
    }
    if (message.type === "loaded") {
      const data =
        message.unchanged && latest?.generation === message.generation
          ? latest.data
          : { ...message.metadata, papers: request.papers };
      if (
        request.type !== "load" ||
        data.papers.length !== message.count ||
        (!message.unchanged && request.generation && request.generation !== message.generation)
      ) {
        fail();
        return;
      }
      try {
        worker?.postMessage({
          type: "accept",
          id: message.id,
          generation: message.generation,
        } satisfies DataWorkerRequest);
      } catch {
        fail();
        return;
      }
      pending.delete(message.id);
      request.cleanup();
      request.resolve({
        data,
        generation: message.generation,
        index: message.index,
        mode: "worker",
      } satisfies PaperDataResult);
    } else if (message.type === "searched") {
      pending.delete(message.id);
      request.cleanup();
      if (request.type !== "search" || request.generation !== message.generation)
        request.reject(new StalePaperGenerationError());
      else request.resolve({ ids: message.ids, generation: message.generation });
    } else if (message.type === "error") {
      pending.delete(message.id);
      request.cleanup();
      const error = new Error(message.message) as Error & { kind?: "format" | "network" };
      error.name = message.name;
      error.kind = message.kind;
      request.reject(error);
    }
  }
  async function ensureWorker(signal: AbortSignal) {
    signal.throwIfAborted();
    if (unavailable || disposed) throw new WorkerUnavailableError();
    if (!ready) {
      ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      void ready.catch(() => {}); // An aborted caller may leave startup running for the next caller.
      try {
        worker = options.workerFactory
          ? options.workerFactory()
          : new Worker(new URL("./data-worker.ts", import.meta.url), {
              type: "module",
              name: "oevryn-paper-data",
            });
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onFailure);
        worker.addEventListener("messageerror", onFailure);
        startupTimer = setTimeout(fail, options.startupTimeoutMs ?? 5000);
      } catch {
        fail();
      }
    }
    await abortable(ready, signal);
  }
  function rpc<T>(
    message: Exclude<DataWorkerRequest, { type: "cancel" | "accept" }>,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        pending.delete(message.id);
        signal.removeEventListener("abort", abort);
        try {
          worker?.postMessage({ type: "cancel", id: message.id } satisfies DataWorkerRequest);
        } catch {
          /* No publication follows cancellation. */
        }
        reject(signal.reason);
      };
      pending.set(message.id, {
        type: message.type,
        generation: message.type === "search" ? message.generation : undefined,
        papers: [],
        resolve,
        reject,
        cleanup: () => signal.removeEventListener("abort", abort),
      });
      signal.addEventListener("abort", abort, { once: true });
      try {
        worker!.postMessage(message);
      } catch {
        fail();
      }
    });
  }
  function operation(signal?: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    return { controller, release: () => signal?.removeEventListener("abort", abort) };
  }
  async function mainThreadLoad(signal: AbortSignal): Promise<PaperDataResult> {
    const { buildPaperIndexAsync } = await import("./paper-index");
    signal.throwIfAborted();
    let snapshot: PublicPaperSnapshot;
    if (options.fallbackLoad) snapshot = await options.fallbackLoad(signal);
    else {
      const { createPublicPaperLoader } = await import("./public-paper-loader");
      fallbackLoader ??= createPublicPaperLoader(baseUrl);
      snapshot = await fallbackLoader.load(signal);
    }
    signal.throwIfAborted();
    if (fallbackIndex?.generation !== snapshot.generation) {
      fallbackIndex = {
        generation: snapshot.generation,
        index: await buildPaperIndexAsync(snapshot.data.papers, signal),
      };
    }
    signal.throwIfAborted();
    return { ...snapshot, index: fallbackIndex.index.summary, mode: "main" };
  }

  return {
    async load(signal?: AbortSignal): Promise<PaperDataResult> {
      if (disposed) throw cancelled();
      activeLoad?.abort(cancelled());
      const current = operation(signal);
      activeLoad = current.controller;
      const ownSignal = current.controller.signal;
      try {
        let result: PaperDataResult;
        try {
          await ensureWorker(ownSignal);
          result = await rpc<PaperDataResult>(
            { type: "load", id: ++sequence, baseUrl, knownGeneration: latest?.generation },
            ownSignal,
          );
        } catch (error) {
          ownSignal.throwIfAborted();
          if (!(error instanceof WorkerUnavailableError)) throw error;
          result = await abortable(mainThreadLoad(ownSignal), ownSignal);
        }
        ownSignal.throwIfAborted();
        if (activeLoad !== current.controller) throw cancelled();
        latest = result;
        return result;
      } finally {
        current.release();
        if (activeLoad === current.controller) activeLoad = undefined;
      }
    },
    async search(
      query: string,
      options: { generation: string; signal?: AbortSignal },
    ): Promise<PaperSearchResult> {
      if (disposed) throw cancelled();
      if (!latest || latest.generation !== options.generation) throw new StalePaperGenerationError();
      activeSearch?.abort(cancelled());
      const current = operation(options.signal);
      activeSearch = current.controller;
      const ownSignal = current.controller.signal;
      const snapshot = latest;
      try {
        let result: PaperSearchResult | undefined;
        if (snapshot.mode === "worker" && !unavailable) {
          try {
            await ensureWorker(ownSignal);
            result = await rpc<PaperSearchResult>(
              { type: "search", id: ++sequence, generation: options.generation, query },
              ownSignal,
            );
          } catch (error) {
            ownSignal.throwIfAborted();
            if (!(error instanceof WorkerUnavailableError)) throw error;
          }
        }
        if (!result) {
          const { buildPaperIndexAsync, searchPaperIndex } = await import("./paper-index");
          if (fallbackIndex?.generation !== snapshot.generation) {
            fallbackIndex = {
              generation: snapshot.generation,
              index: await buildPaperIndexAsync(snapshot.data.papers, ownSignal),
            };
          }
          result = {
            generation: snapshot.generation,
            ids: await searchPaperIndex(fallbackIndex.index, query, ownSignal),
          };
        }
        ownSignal.throwIfAborted();
        if (latest.generation !== result.generation) throw new StalePaperGenerationError();
        return result;
      } finally {
        current.release();
        if (activeSearch === current.controller) activeSearch = undefined;
      }
    },
    cancel() {
      activeLoad?.abort(cancelled());
      activeSearch?.abort(cancelled());
    },
    dispose() {
      disposed = true;
      activeLoad?.abort(cancelled());
      activeSearch?.abort(cancelled());
      if (startupTimer) clearTimeout(startupTimer);
      readyReject?.(cancelled());
      readyReject = undefined;
      readyResolve = undefined;
      detach();
    },
  };
}
