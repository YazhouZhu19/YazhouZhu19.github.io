import { screenInformation } from "./information-screening";

// Comparison is user-triggered and kept off the UI thread for complete archives.
self.onmessage = (event: MessageEvent<Parameters<typeof screenInformation>[0]>) => {
  try {
    self.postMessage({ results: screenInformation(event.data) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Comparison failed" });
  }
};
