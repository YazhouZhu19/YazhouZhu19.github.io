import { analyzeResearch } from "./integrated-analysis";
self.onmessage = (event: MessageEvent<Parameters<typeof analyzeResearch>[0]>) => {
  try {
    self.postMessage({ result: analyzeResearch(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Analysis failed" });
  }
};
