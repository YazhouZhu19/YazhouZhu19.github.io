export const MANIFEST_POLL_MS = 5 * 60_000;
export function manifestPollDelay(failures: number) {
  return Math.min(60 * 60_000, MANIFEST_POLL_MS * 2 ** Math.min(Math.max(0, failures), 4));
}

type VisibilitySource = Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;

/** One check at a time; hidden tabs wait for visibility instead of polling. */
export function startManifestPolling(
  check: () => Promise<boolean>,
  options: {
    visibility?: VisibilitySource;
    schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    unschedule?: (timer: ReturnType<typeof setTimeout>) => void;
  } = {},
) {
  const visibility = options.visibility ?? document;
  const schedule = options.schedule ?? setTimeout;
  const unschedule = options.unschedule ?? clearTimeout;
  let stopped = false;
  let running = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function clear() {
    if (timer !== undefined) unschedule(timer);
    timer = undefined;
  }
  function queue() {
    clear();
    if (!stopped && visibility.visibilityState === "visible") {
      timer = schedule(() => { timer = undefined; void run(); }, manifestPollDelay(failures));
    }
  }
  async function run() {
    if (stopped || running || visibility.visibilityState !== "visible") return;
    running = true;
    clear();
    try { failures = await check() ? 0 : failures + 1; }
    catch { failures += 1; }
    finally { running = false; queue(); }
  }
  function onVisibility() {
    clear();
    if (visibility.visibilityState === "visible") void run();
  }
  visibility.addEventListener("visibilitychange", onVisibility);
  queue();
  return () => {
    stopped = true;
    clear();
    visibility.removeEventListener("visibilitychange", onVisibility);
  };
}
