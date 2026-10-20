import { createManifestLoader } from "./manifest-loader";
import { monitorDataSchema, type VerifiedPublicData } from "./public-data-schema";
import { createShardCache } from "./shard-cache";
import {
  parseSnapshotManifest,
  resolveSnapshot,
  SnapshotFormatError,
  type SnapshotManifest,
} from "./snapshot";

export class PublicDataLoadError extends Error {
  constructor(
    public readonly kind: "format" | "network",
    options?: ErrorOptions,
  ) {
    super(kind === "format" ? "Invalid public paper data" : "Public paper data unavailable", options);
    this.name = "PublicDataLoadError";
  }
}
export type PublicPaperSnapshot = { data: VerifiedPublicData; generation: string };
type PaperLoaderOptions = { fetcher?: typeof fetch; shardCache?: ReturnType<typeof createShardCache> };

/** The same reader runs in a module Worker or, when unsupported, on the main thread. */
export function createPublicPaperLoader(baseUrl: string, options: PaperLoaderOptions = {}) {
  const fetcher: typeof fetch = options.fetcher ?? ((input, init) => fetch(input, init));
  const cache = options.shardCache ?? createShardCache("papers");
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const endpoints = ["public-papers-v3.json", "public-papers-v2.json", "papers.json"].map((file) => {
    const url = `${root}data/${file}`;
    const loader = createManifestLoader(url, {
      fetcher,
      validate: (raw) => {
        if (raw && typeof raw === "object" && "schema" in raw) return parseSnapshotManifest(raw);
        if (!monitorDataSchema.safeParse(raw).success)
          throw new SnapshotFormatError("Invalid legacy paper snapshot");
        return raw;
      },
    });
    return { url, loader };
  });
  let verified: { url: string; raw: unknown; key?: string; snapshot: PublicPaperSnapshot } | undefined;
  const identity = crypto.randomUUID();
  let serial = 0;
  let newestRequest = 0;

  return {
    async load(signal?: AbortSignal): Promise<PublicPaperSnapshot> {
      signal?.throwIfAborted();
      const request = ++newestRequest;
      let lastError: unknown;
      let sawFormatError = false;
      for (const endpoint of endpoints) {
        signal?.throwIfAborted();
        const attempt = new AbortController();
        const abort = () => attempt.abort(signal?.reason);
        signal?.addEventListener("abort", abort, { once: true });
        try {
          const raw = await endpoint.loader.load(attempt.signal);
          attempt.signal.throwIfAborted();
          if (request !== newestRequest) throw new DOMException("Superseded paper load", "AbortError");
          const isManifest = !!raw && typeof raw === "object" && "schema" in raw;
          const key = isManifest ? JSON.stringify(raw) : undefined;
          if (verified?.url === endpoint.url && (verified.raw === raw || (key && verified.key === key)))
            return verified.snapshot;
          const manifest: SnapshotManifest | undefined = isManifest ? parseSnapshotManifest(raw) : undefined;
          const shards = new Map(manifest?.shards.map((shard) => [shard.path, shard]));
          const decoded = await resolveSnapshot(raw, async (path) => {
            attempt.signal.throwIfAborted();
            const shard = shards.get(path);
            if (!shard) throw new SnapshotFormatError("Unlisted paper shard");
            return cache.read(
              shard,
              async () => {
                const response = await fetcher(`${root}data/${path}`, {
                  cache: "force-cache",
                  credentials: "omit",
                  signal: attempt.signal,
                });
                if (!response.ok) throw new PublicDataLoadError("network");
                return response.text();
              },
              attempt.signal,
            );
          });
          attempt.signal.throwIfAborted();
          const result = monitorDataSchema.safeParse(decoded);
          if (!result.success) throw new SnapshotFormatError("Invalid decoded public paper data");
          // Old records and endpoints retain identical public validation behavior.
          if (manifest) await cache.commitGeneration(manifest.shards, attempt.signal);
          attempt.signal.throwIfAborted();
          if (request !== newestRequest) throw new DOMException("Superseded paper load", "AbortError");
          const snapshot = { data: result.data, generation: `${identity}:${++serial}` };
          verified = { url: endpoint.url, raw, key, snapshot };
          return snapshot;
        } catch (error) {
          attempt.abort(error);
          signal?.throwIfAborted();
          if (error instanceof Error && error.name === "AbortError") throw error;
          if (request !== newestRequest) throw new DOMException("Superseded paper load", "AbortError");
          sawFormatError ||= error instanceof SnapshotFormatError || error instanceof SyntaxError;
          lastError = error;
        } finally {
          signal?.removeEventListener("abort", abort);
        }
      }
      throw new PublicDataLoadError(sawFormatError ? "format" : "network", { cause: lastError });
    },
  };
}
