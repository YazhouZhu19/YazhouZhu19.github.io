import type { DataWorkerRequest, DataWorkerResponse } from "./data-worker-client";
import { buildPaperIndexAsync, searchPaperIndex, type PaperSearchIndex } from "./paper-index";
import { createPublicPaperLoader, PublicDataLoadError, type PublicPaperSnapshot } from "./public-paper-loader";

type State = PublicPaperSnapshot & { index: PaperSearchIndex };

/** Exposed for protocol tests; personal storage and credentials never enter this runtime. */
export function createDataWorkerRuntime(send: (message: DataWorkerResponse) => void, options: {
  load?: (baseUrl: string, signal: AbortSignal) => Promise<PublicPaperSnapshot>;
} = {}) {
  let loader: ReturnType<typeof createPublicPaperLoader> | undefined, baseUrl: string | undefined;
  let loadRequest: { id: number; controller: AbortController } | undefined;
  const searches = new Map<number, AbortController>();
  const staged = new Map<number, State>();
  const accepted = new Map<string, State>();
  let disposed = false;
  const abortError = () => new DOMException("Paper request cancelled", "AbortError");
  const errorReply = (id: number, error: unknown) => {
    if (disposed) return;
    send({ type: "error", id, name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : "Paper data request failed",
      kind: error instanceof PublicDataLoadError ? error.kind : undefined });
  };
  async function load(message: Extract<DataWorkerRequest, { type: "load" }>) {
    loadRequest?.controller.abort(abortError());
    staged.clear();
    const current = { id: message.id, controller: new AbortController() };
    loadRequest = current;
    const signal = current.controller.signal;
    try {
      if (baseUrl !== message.baseUrl) {
        baseUrl = message.baseUrl;
        loader = createPublicPaperLoader(baseUrl);
      }
      const snapshot = options.load ? await options.load(message.baseUrl, signal) : await loader!.load(signal);
      signal.throwIfAborted();
      const index = accepted.get(snapshot.generation)?.index ?? await buildPaperIndexAsync(snapshot.data.papers, signal);
      signal.throwIfAborted();
      if (loadRequest !== current || disposed) throw abortError();
      staged.set(message.id, { ...snapshot, index });
      const unchanged = snapshot.generation === message.knownGeneration;
      const { papers, ...metadata } = snapshot.data;
      if (!unchanged) {
        // Structured clone is paid in bounded chunks instead of one large UI-thread task.
        for (let offset = 0; offset < papers.length; offset += 128) {
          signal.throwIfAborted();
          send({ type: "papers", id: message.id, generation: snapshot.generation, offset, papers: papers.slice(offset, offset + 128) });
          if (offset && offset % 512 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
      signal.throwIfAborted();
      send({ type: "loaded", id: message.id, generation: snapshot.generation, metadata, index: index.summary, count: papers.length, unchanged });
    } catch (error) {
      staged.delete(message.id);
      errorReply(message.id, error);
    } finally {
      if (loadRequest === current) loadRequest = undefined;
    }
  }
  async function search(message: Extract<DataWorkerRequest, { type: "search" }>) {
    const controller = new AbortController();
    searches.set(message.id, controller);
    try {
      const state = accepted.get(message.generation);
      if (!state) {
        const error = new Error("Paper search belongs to a previous snapshot");
        error.name = "StalePaperGenerationError";
        throw error;
      }
      const ids = await searchPaperIndex(state.index, message.query, controller.signal);
      controller.signal.throwIfAborted();
      if (!disposed) send({ type: "searched", id: message.id, generation: message.generation, ids });
    } catch (error) { errorReply(message.id, error); }
    finally { searches.delete(message.id); }
  }
  return {
    handle(message: DataWorkerRequest) {
      if (disposed) return;
      if (message.type === "load") void load(message);
      else if (message.type === "search") void search(message);
      else if (message.type === "cancel") {
        if (loadRequest?.id === message.id) loadRequest.controller.abort(abortError());
        searches.get(message.id)?.abort(abortError());
        staged.delete(message.id);
      } else if (message.type === "accept") {
        const state = staged.get(message.id);
        if (state?.generation !== message.generation) return;
        accepted.delete(message.generation);
        accepted.set(message.generation, state);
        staged.delete(message.id);
        // A previous accepted generation supports searches during a UI snapshot switch.
        while (accepted.size > 2) accepted.delete(accepted.keys().next().value!);
      }
    },
    dispose() {
      disposed = true;
      loadRequest?.controller.abort(abortError());
      for (const controller of searches.values()) controller.abort(abortError());
      searches.clear(); staged.clear(); accepted.clear();
    },
  };
}

const workerScope = globalThis as unknown as {
  postMessage?: (message: DataWorkerResponse) => void;
  addEventListener?: (type: "message", handler: (event: MessageEvent<DataWorkerRequest>) => void) => void;
};
if (typeof document === "undefined" && typeof workerScope.postMessage === "function" && typeof workerScope.addEventListener === "function") {
  const runtime = createDataWorkerRuntime(message => workerScope.postMessage!(message));
  workerScope.addEventListener("message", event => runtime.handle(event.data));
  workerScope.postMessage({ type: "ready" });
}
