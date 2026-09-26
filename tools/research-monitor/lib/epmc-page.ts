import { parseJsonResponse } from "./parse";

export type EpmcPage = { hits: any[]; total: number; next?: string; exhausted: boolean };

/**
 * Europe PMC ends cursor pagination by omitting the next cursor or echoing it.
 * The core record count can be lower than hitCount, so hitCount alone cannot
 * distinguish a terminal page from a failed response. Keep both counts for
 * coverage reporting instead of treating a confirmed terminal page as a fault.
 */
export function parseEpmcPage(body: string, requestedCursor: string, receivedBefore: number): EpmcPage {
  const data = parseJsonResponse(body, "Europe PMC");
  if (!data || !Number.isSafeInteger(data.hitCount) || data.hitCount < 0 || !Array.isArray(data.resultList?.result)) {
    throw new Error("Europe PMC 返回了无法识别的结果");
  }
  if (data.nextCursorMark != null && (typeof data.nextCursorMark !== "string" || !data.nextCursorMark.trim())) {
    throw new Error("Europe PMC 返回了无效的下一页游标");
  }
  const hits = data.resultList.result;
  const next = data.nextCursorMark ?? undefined;
  const exhausted = !next || next === requestedCursor;

  if (!hits.length && data.hitCount > 0) {
    const confirmedTerminal = receivedBefore > 0 && requestedCursor !== "*"
      && data.request?.cursorMark === requestedCursor && exhausted
      && (next === requestedCursor || !data.nextPageUrl);
    if (!confirmedTerminal) throw new Error("Europe PMC 声明仍有结果，但返回空页");
  }

  return { hits, total: data.hitCount, next, exhausted };
}
