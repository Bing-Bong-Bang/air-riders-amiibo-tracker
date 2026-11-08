// The selected game mode. Air Ride and Top Ride are fully separate
// datasets; every mode-aware page reads from here.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TrackedMode } from "../domain/schema";

export const MODES: { id: TrackedMode; label: string; short: string }[] = [
  { id: "air_ride", label: "Air Ride", short: "AR" },
  { id: "top_ride", label: "Top Ride", short: "TR" },
];

export function modeLabel(mode: TrackedMode): string {
  return MODES.find(m => m.id === mode)?.label ?? mode;
}

const STORAGE_KEY = "air-riders-tracker.mode";

function readStoredMode(): TrackedMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "air_ride" || v === "top_ride") return v;
  } catch { /* storage unavailable */ }
  return "air_ride";
}

interface ModeContextValue {
  mode: TrackedMode;
  setMode: (mode: TrackedMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<TrackedMode>(readStoredMode);
  const setMode = useCallback((next: TrackedMode) => {
    setModeState(next);
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ModeContext.Provider value={value}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const ctx = useContext(ModeContext);
  if (!ctx) throw new Error("useMode must be used inside <ModeProvider>.");
  return ctx;
}
