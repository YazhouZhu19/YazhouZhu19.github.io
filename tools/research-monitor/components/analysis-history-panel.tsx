import { AnalysisHistory } from "./analysis-history";
import history from "../data/analysis-history.json";
import type { LongitudinalHistory } from "../lib/longitudinal-analysis";

// Lazy route content: the approved evidence snapshot is independent of live-source loading.
export function AnalysisHistoryPanel(props: {
  evidenceFilter: "all" | "sufficient" | "pending";
  query: string;
}) {
  return <AnalysisHistory history={history as LongitudinalHistory} {...props} />;
}
