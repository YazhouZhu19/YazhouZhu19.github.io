import { createContext, useContext } from "react";
import type { SignalKind } from "@/lib/signals-snapshot";
import type { ResearchSignalsData } from "@/lib/research-signals";

export type SignalsAccess = {
  ensureKind: (kind: SignalKind) => Promise<ResearchSignalsData | null>;
  loaded: Record<SignalKind, boolean>;
  loading: boolean;
  error: boolean;
};
export const SignalsContext = createContext<SignalsAccess | null>(null);
export const useSignalsAccess = () => useContext(SignalsContext);
