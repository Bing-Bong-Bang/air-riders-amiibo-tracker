// =============================================================
// Summaries used by the trial page and the personal stat pages.
//
// Times can only be compared on the same stage, so cross-stage numbers
// use placements and "pace vs field": each finish time as a % of that
// stage's median time in the same set of races (−2% = 2% faster than
// a typical finish there).
// =============================================================

import { distributionStats } from "./schema";
import type { DistributionStats, Format, ID, Millis, Race, RaceEntry } from "./schema";

export interface ResultRow {
  race: Race;
  entry: RaceEntry;
}

export interface GroupSummary {
  key: string;
  races: number;
  finished: number;
  wins: number;
  podiums: number;
  /** Races that recorded a placement. */
  placed: number;
  avgPlace: number | null;
  winRate: number | null;
  podiumRate: number | null;
  /** Average riders per race (CPUs included), for placement context. */
  avgFieldSize: number | null;
  /** Raw time stats. Only meaningful when every row is on the same stage. */
  times: DistributionStats | null;
  /** Average % vs the stage median (lower = faster). Works across stages. */
  pacePct: number | null;
  avgGapMs: Millis | null;
  dnfRate: number | null;
  /** Races at or under a target time, when one is set. */
  hits?: { targetMs: Millis; count: number } | null;
}

/** Riders in the race (CPUs included), as best we know. */
export function fieldSize(race: Race, format: Format | undefined): number {
  return format?.settings.numberOfRiders ?? race.riderCount ?? race.entries.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Median finish time per stage across the given rows. */
export function stageMedians(rows: ResultRow[]): Map<ID, Millis> {
  const byStage = new Map<ID, Millis[]>();
  for (const { race, entry } of rows) {
    if (entry.status !== "finished" || entry.finishTimeMs === null) continue;
    const list = byStage.get(race.stageId);
    if (list) list.push(entry.finishTimeMs); else byStage.set(race.stageId, [entry.finishTimeMs]);
  }
  return new Map([...byStage].map(([k, v]) => [k, median(v)]));
}

export function groupRows(rows: ResultRow[], keyOf: (r: ResultRow) => string): Map<string, ResultRow[]> {
  const out = new Map<string, ResultRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  return out;
}

export function summarize(
  key: string,
  rows: ResultRow[],
  medians: Map<ID, Millis>,
  formatOf: (r: Race) => Format | undefined = () => undefined,
): GroupSummary {
  const ordered = [...rows].sort((a, b) => a.race.racedAt.localeCompare(b.race.racedAt));
  const finished = ordered.filter(r => r.entry.status === "finished" && r.entry.finishTimeMs !== null);
  const placed = ordered.filter(r => r.entry.placement !== undefined);
  const places = placed.map(r => r.entry.placement as number);
  const wins = places.filter(p => p === 1).length;
  const paces = finished
    .map(r => {
      const m = medians.get(r.race.stageId);
      return m ? ((r.entry.finishTimeMs as number) / m - 1) * 100 : null;
    })
    .filter((v): v is number => v !== null);
  const gaps = ordered.map(r => r.entry.gapToFirstMs).filter((g): g is Millis => g != null);
  const n = ordered.length;
  return {
    key,
    races: n,
    finished: finished.length,
    wins,
    podiums: places.filter(p => p <= 3).length,
    placed: placed.length,
    avgPlace: mean(places),
    winRate: placed.length ? wins / placed.length : null,
    podiumRate: placed.length ? places.filter(p => p <= 3).length / placed.length : null,
    avgFieldSize: placed.length ? mean(placed.map(r => fieldSize(r.race, formatOf(r.race)))) : null,
    times: distributionStats(
      finished.map(r => r.entry.finishTimeMs as Millis), undefined,
      ordered[0] ? formatOf(ordered[0].race)?.disasterThresholdPct ?? 5 : 5,
    ),
    pacePct: mean(paces),
    avgGapMs: mean(gaps),
    dnfRate: n ? ordered.filter(r => r.entry.status === "retired" || r.entry.status === "dnf").length / n : null,
  };
}

/** Flatten races into one row per entry, keeping only counted races/entries. */
export function rowsOf(races: Race[], keep: (race: Race, entry: RaceEntry) => boolean = (r, e) => r.includeInStats && e.includeInStats): ResultRow[] {
  return races.flatMap(race => race.entries.filter(entry => keep(race, entry)).map(entry => ({ race, entry })));
}

/**
 * Rank groups best-first: by average placement when there are placements,
 * otherwise by pace vs field. Ties broken by more races.
 */
export function rankSummaries(rows: GroupSummary[]): GroupSummary[] {
  const score = (g: GroupSummary) => g.avgPlace ?? (g.pacePct !== null ? 100 + g.pacePct : Infinity);
  return [...rows].sort((a, b) => score(a) - score(b) || b.races - a.races);
}
