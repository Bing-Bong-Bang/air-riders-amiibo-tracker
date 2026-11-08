// =============================================================
// Trained amiibo vs baseline.
//
// A baseline amiibo is a "Balanced" one: the game's default AI. To see
// what training bought, a trained amiibo is compared with the baseline
// amiibo of the same rider, only where both raced the same stage on the
// same machine in the same format. Each matched pair gives a gap in
// median times; the overall gap is their weighted average, weighted by
// how many races sit on each side (harmonic weight), so a pair with 1
// baseline race can't swing the result.
// =============================================================

import type { ID, Millis } from "./schema";
import type { ResultRow } from "./insights";

export interface BaselineSide { races: number; medianMs: Millis }

export interface BaselinePair {
  stageId: ID;
  machineId: ID;
  mine: BaselineSide;
  base: BaselineSide;
  /** mine − baseline; negative means the trained amiibo is faster. */
  deltaMs: number;
  deltaPct: number;
}

export interface BaselineComparison {
  pairs: BaselinePair[];
  /** Weighted average gap per course; null with no matched pairs. */
  deltaMs: number | null;
  deltaPct: number | null;
  /** Rough 95% range half-width for deltaMs; null when it can't be estimated. */
  marginMs: number | null;
  matchedMine: number;
  matchedBase: number;
  /** The trained amiibo's timed races with no baseline on that stage + machine. */
  unmatchedMine: number;
  confidence: "none" | "low" | "medium" | "high";
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function variance(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1);
}

/** Finished, timed results keyed by "stage|machine". */
export type PairKey = (r: ResultRow) => string;
/** Default pairing: same stage on the same machine. */
export const byStageAndMachine: PairKey = r => `${r.race.stageId}|${r.entry.machineId}`;
/** Same stage, any machine: for comparing two machines head to head. */
export const byStage: PairKey = r => `${r.race.stageId}|`;

function timesByPair(rows: ResultRow[], keyOf: PairKey): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const r of rows) {
    if (r.entry.status !== "finished" || r.entry.finishTimeMs === null) continue;
    const k = keyOf(r);
    const list = out.get(k) ?? [];
    list.push(r.entry.finishTimeMs);
    out.set(k, list);
  }
  return out;
}

/**
 * Compare `mine` (one trained amiibo's rows) with `baseline` (rows of the
 * baseline amiibo of the same rider), all from one format.
 */
export function compareWithBaseline(mine: ResultRow[], baseline: ResultRow[], keyOf: PairKey = byStageAndMachine): BaselineComparison {
  const a = timesByPair(mine, keyOf);
  const b = timesByPair(baseline, keyOf);
  const pairs: BaselinePair[] = [];
  let unmatchedMine = 0;
  for (const [k, xs] of a) {
    const ys = b.get(k);
    if (!ys) { unmatchedMine += xs.length; continue; }
    const [stageId, machineId] = k.split("|");
    const mm = median(xs), mb = median(ys);
    pairs.push({
      stageId, machineId,
      mine: { races: xs.length, medianMs: mm },
      base: { races: ys.length, medianMs: mb },
      deltaMs: mm - mb,
      deltaPct: (mm - mb) / mb,
    });
  }
  const matchedMine = pairs.reduce((s, p) => s + p.mine.races, 0);
  const matchedBase = pairs.reduce((s, p) => s + p.base.races, 0);
  if (!pairs.length) {
    return { pairs, deltaMs: null, deltaPct: null, marginMs: null, matchedMine, matchedBase, unmatchedMine, confidence: "none" };
  }

  const weight = (p: BaselinePair) => 1 / (1 / p.mine.races + 1 / p.base.races);
  const W = pairs.reduce((s, p) => s + weight(p), 0);
  const deltaMs = pairs.reduce((s, p) => s + weight(p) * p.deltaMs, 0) / W;
  const deltaPct = pairs.reduce((s, p) => s + weight(p) * p.deltaPct, 0) / W;

  // Spread: within-pair variance of times, pooled across pairs (as a
  // share of the pair's median so short and long courses pool fairly).
  let ss = 0, df = 0;
  for (const p of pairs) {
    const k = `${p.stageId}|${p.machineId}`;
    for (const [xs, med] of [[a.get(k)!, p.mine.medianMs], [b.get(k)!, p.base.medianMs]] as const) {
      const v = variance(xs.map(x => x / med));
      if (v !== null) { ss += v * (xs.length - 1); df += xs.length - 1; }
    }
  }
  let marginMs: number | null = null;
  if (df >= 2) {
    const relVar = ss / df;
    // Medians are ~1.25× noisier than means for normal-ish data.
    const se2 = pairs.reduce((s, p) => {
      const w = weight(p) / W;
      const avg = (p.mine.medianMs + p.base.medianMs) / 2;
      return s + w * w * 1.5625 * relVar * avg * avg * (1 / p.mine.races + 1 / p.base.races);
    }, 0);
    marginMs = 1.96 * Math.sqrt(se2);
  }

  const fewer = Math.min(matchedMine, matchedBase);
  const clear = marginMs !== null && Math.abs(deltaMs) > marginMs;
  const confidence = fewer < 5 || marginMs === null ? "low" : fewer >= 16 && clear ? "high" : "medium";
  return { pairs, deltaMs, deltaPct, marginMs, matchedMine, matchedBase, unmatchedMine, confidence };
}
