// =============================================================
// Grand Prix scoring: which amiibo + machine is likely to score the
// most points over a Grand Prix in one format.
//
// Every counted race gives each logged amiibo its points for the place
// it finished (a retire with no place counts as last). A Grand Prix is
// (races − 1) normal races plus one final race worth `finalMultiplier`
// times as much; when the final is always on certain courses, the final
// uses that amiibo's average on those courses (once it has 3+ races
// there). Likely ranges and rank brackets come from re-running the sums
// on a few hundred reshuffled versions of the races (bootstrap).
//
// Places only mean something against the same kind of field, so this
// is fair when every setup meets every other one equally often.
// =============================================================

import { mulberry32 } from "./schema";
import type { Format, GrandPrixScoring, ID } from "./schema";
import { fieldSize } from "./insights";
import type { ResultRow } from "./insights";

export interface GpRow {
  key: string;                  // "profileId|machineId"
  profileId: ID;
  machineId: ID;
  races: number;
  avgPoints: number;
  /** Average points per race on the final courses (null when none were raced). */
  finalAvg: number | null;
  finalRaces: number;
  /** Expected Grand Prix total. */
  score: number;
  scoreLow: number;
  scoreHigh: number;
  rank: number;
  rankLow: number;
  rankHigh: number;
  winRate: number;
  avgPlace: number;
  retireRate: number;
  confidence: "high" | "medium" | "low";
}

/** Min races on the final courses before they replace the overall average for the final. */
export const FINAL_MIN_RACES = 3;
const REPS = 300;

/** The race's place for this entry, or null when it can't be scored. */
export function scoredPlace(row: ResultRow, format: Format): number | null {
  const { entry } = row;
  if (entry.placement !== undefined) return entry.placement;
  if (entry.status !== "finished") return fieldSize(row.race, format);
  return null;
}

export function pointsFor(place: number, table: number[]): number {
  return table[place - 1] ?? 0;
}

interface Scored { points: number; place: number; final: boolean; retired: boolean }

function gpScore(sample: Scored[], gp: GrandPrixScoring | undefined): { score: number; avg: number; finalAvg: number | null; finalN: number } {
  const avg = sample.reduce((a, s) => a + s.points, 0) / sample.length;
  const fin = sample.filter(s => s.final);
  const finalAvg = fin.length ? fin.reduce((a, s) => a + s.points, 0) / fin.length : null;
  if (!gp) return { score: avg, avg, finalAvg, finalN: fin.length };
  const finalUse = finalAvg !== null && fin.length >= FINAL_MIN_RACES ? finalAvg : avg;
  return { score: (gp.races - 1) * avg + gp.finalMultiplier * finalUse, avg, finalAvg, finalN: fin.length };
}

const pct = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/**
 * Rank every amiibo + machine in `rows` (one pool) by expected Grand
 * Prix points. Returns [] when the format has no points table.
 */
export function grandPrixTable(rows: ResultRow[], format: Format, minSample: number): GpRow[] {
  const table = format.pointsTable;
  if (!table?.length) return [];
  const gp = format.grandPrix;
  const finals = new Set(gp?.finalStageIds ?? []);

  const groups = new Map<string, Scored[]>();
  for (const r of rows) {
    if (r.entry.racer.kind !== "amiibo") continue;
    const place = scoredPlace(r, format);
    if (place === null) continue;
    const key = `${r.entry.racer.profileId}|${r.entry.machineId}`;
    const s: Scored = { points: pointsFor(place, table), place, final: finals.has(r.race.stageId), retired: r.entry.status !== "finished" };
    const list = groups.get(key);
    if (list) list.push(s); else groups.set(key, [s]);
  }
  const keys = [...groups.keys()];
  if (!keys.length) return [];

  const point = new Map(keys.map(k => [k, gpScore(groups.get(k)!, gp)]));
  const ordered = [...keys].sort((a, b) => point.get(b)!.score - point.get(a)!.score);

  // Bootstrap: resample each setup's races, re-score, re-rank.
  const rand = mulberry32(rows.length * 2654435761 + keys.length);
  const scores = new Map(keys.map(k => [k, [] as number[]]));
  const ranks = new Map(keys.map(k => [k, [] as number[]]));
  for (let i = 0; i < REPS; i++) {
    const rep = keys.map(k => {
      const src = groups.get(k)!;
      const sample = src.map(() => src[Math.floor(rand() * src.length)]);
      return { k, score: gpScore(sample, gp).score };
    });
    rep.forEach(x => scores.get(x.k)!.push(x.score));
    [...rep].sort((a, b) => b.score - a.score).forEach((x, idx) => ranks.get(x.k)!.push(idx + 1));
  }

  return ordered.map((k, idx) => {
    const list = groups.get(k)!;
    const p = point.get(k)!;
    const [profileId, machineId] = k.split("|");
    const rs = ranks.get(k)!;
    const rankLow = Math.min(idx + 1, pct(rs, 0.1)), rankHigh = Math.max(idx + 1, pct(rs, 0.9));
    const n = list.length;
    return {
      key: k, profileId, machineId, races: n,
      avgPoints: p.avg, finalAvg: p.finalAvg, finalRaces: p.finalN,
      score: p.score, scoreLow: pct(scores.get(k)!, 0.1), scoreHigh: pct(scores.get(k)!, 0.9),
      rank: idx + 1, rankLow, rankHigh,
      winRate: list.filter(s => s.place === 1).length / n,
      avgPlace: list.reduce((a, s) => a + s.place, 0) / n,
      retireRate: list.filter(s => s.retired).length / n,
      confidence: n < minSample ? "low" : rankLow === rankHigh ? "high" : "medium",
    };
  });
}
