/** Revalidate a small public manifest without reparsing an unchanged snapshot. */
export function createManifestLoader<T>(
  url: string,
  options: {
    validate: (raw: unknown) => T;
    fetcher?: typeof fetch;
    maxBytes?: number;
  },
) {
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  let previous: { text: string; value: T; etag?: string } | undefined;
  return {
    async load(signal?: AbortSignal): Promise<T> {
      signal?.throwIfAborted();
      const headers = new Headers();
      if (previous?.etag) headers.set("If-None-Match", previous.etag);
      const response = await (options.fetcher ?? fetch)(url, {
        cache: "no-cache",
        credentials: "omit",
        headers,
        signal,
      });
      signal?.throwIfAborted();
      if (response.status === 304) {
        if (!previous) throw new Error("Manifest returned 304 without a validated prior response");
        return previous.value;
      }
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
      const declared = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel();
        throw new Error("Manifest exceeds the size limit");
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (!reader) throw new Error("Manifest has no response body");
      try {
        for (;;) {
          signal?.throwIfAborted();
          const result = await reader.read();
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > maxBytes) throw new Error("Manifest exceeds the size limit");
          chunks.push(result.value);
        }
      } catch (error) {
        try {
          await reader.cancel();
        } catch {
          /* Preserve the read failure. */
        }
        throw error;
      } finally {
        reader.releaseLock();
      }
      signal?.throwIfAborted();
      const joined = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
      // Some hosts do not support conditional requests. Reuse the validated
      // object even when they send the same body with a 200 response.
      const value = previous?.text === text ? previous.value : options.validate(JSON.parse(text));
      signal?.throwIfAborted();
      previous = { text, value, etag: response.headers.get("ETag") ?? undefined };
      return value;
    },
  };
}
