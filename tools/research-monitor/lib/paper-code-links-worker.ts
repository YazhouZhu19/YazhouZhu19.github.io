import { analyzePaperCodeLinks } from "./paper-code-links";
self.onmessage = (event: MessageEvent<Parameters<typeof analyzePaperCodeLinks>[0]>) => {
  try {
    self.postMessage({ result: analyzePaperCodeLinks(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Association failed" });
  }
};
