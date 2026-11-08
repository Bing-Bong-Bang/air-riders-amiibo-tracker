// Shared City Trial data for every City Trial page.

import { getAll } from "../../db/database";
import type { CtFormat, CtMatch, CtSession, StadiumRun } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import { useLiveQuery } from "../../hooks/useLiveQuery";
import type { LiveQueryResult } from "../../hooks/useLiveQuery";

export interface CtData {
  formats: CtFormat[];
  formatById: Map<ID, CtFormat>;
  sessions: CtSession[];        // newest first
  sessionById: Map<ID, CtSession>;
  matches: CtMatch[];           // newest first
  runs: StadiumRun[];           // newest first
}

export async function loadCtData(): Promise<CtData> {
  const [formats, sessions, matches, runs] = await Promise.all([
    getAll("ctFormats"), getAll("ctSessions"), getAll("ctMatches"), getAll("stadiumRuns"),
  ]);
  formats.sort((a, b) => Number(!!b.isDefaultRules) - Number(!!a.isDefaultRules) || a.name.localeCompare(b.name));
  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  matches.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  runs.sort((a, b) => b.playedAt.localeCompare(a.playedAt));
  return {
    formats, formatById: new Map(formats.map(f => [f.id, f])),
    sessions, sessionById: new Map(sessions.map(s => [s.id, s])),
    matches, runs,
  };
}

export function useCtData(): LiveQueryResult<CtData> {
  return useLiveQuery(loadCtData, [], ["ctFormats", "ctSessions", "ctMatches", "stadiumRuns"]);
}

/** The format most worth showing first: the one with the most matches, else the default rules. */
export function busiestFormat(d: CtData): CtFormat | undefined {
  const counts = new Map<ID, number>();
  for (const m of d.matches) counts.set(m.formatId, (counts.get(m.formatId) ?? 0) + 1);
  const live = d.formats.filter(f => !f.isArchived);
  if (!counts.size) return live.find(f => f.isDefaultRules) ?? live[0];
  return [...live].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))[0];
}

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

/** Remembered between visits on this browser only: who you last logged, and per-session "counts" choices. */
export const memory = {
  lastPicks: (): ID[] => { try { return JSON.parse(lsGet("air-riders-tracker.ct.lastPicks") ?? "[]"); } catch { return []; } },
  setLastPicks: (ids: ID[]) => lsSet("air-riders-tracker.ct.lastPicks", JSON.stringify(ids)),
  lastFormat: () => lsGet("air-riders-tracker.ct.lastFormat"),
  setLastFormat: (id: ID) => lsSet("air-riders-tracker.ct.lastFormat", id),
  /** The session you're logging into, kept until you pick another, finish it or delete it. */
  activeSession: (): ID | null => lsGet("air-riders-tracker.ct.activeSession"),
  setActiveSession: (id: ID | null) => { try { if (id) localStorage.setItem("air-riders-tracker.ct.activeSession", id); else localStorage.removeItem("air-riders-tracker.ct.activeSession"); } catch { /* storage unavailable */ } },
  sessionCounts: (sessionId: ID | "") => lsGet(`air-riders-tracker.ct.sessionCounts.${sessionId || "none"}`) !== "0",
  setSessionCounts: (sessionId: ID | "", v: boolean) => lsSet(`air-riders-tracker.ct.sessionCounts.${sessionId || "none"}`, v ? "1" : "0"),
};
