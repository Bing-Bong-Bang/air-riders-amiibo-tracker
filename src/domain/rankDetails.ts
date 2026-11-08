// =============================================================
// Extra numbers for Rankings and the Stages view, from the same
// observations the leaderboard model uses (one format, counted, timed).
//
//   - typicalCourseMs / fullRunMs: turn a pace % into seconds.
//   - subjectDetails: consistency, disaster rate, strongest and
//     weakest stage for each ranked subject.
//   - stageOverview: per-stage facts (best, worst, noise, disasters,
//     how much the machine matters, coverage).
// =============================================================

import type { ID, Millis, PaceObservation } from "./schema";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Median time per stage. */
export function stageMedianTimes(obs: PaceObservation[]): Map<ID, Millis> {
  const by = new Map<ID, number[]>();
  for (const o of obs) by.set(o.stageId, [...(by.get(o.stageId) ?? []), o.timeMs]);
  return new Map([...by].map(([k, v]) => [k, median(v)]));
}

/** A typical course: the average of each stage's median time. */
export function typicalCourseMs(obs: PaceObservation[]): Millis | null {
  const meds = [...stageMedianTimes(obs).values()];
  return meds.length ? meds.reduce((a, b) => a + b, 0) / meds.length : null;
}

/**
 * Length of a full run over `stageIds`: measured stages use their median;
 * unraced ones are filled with the typical course, and counted.
 */
export function fullRunMs(obs: PaceObservation[], stageIds: ID[]): { ms: Millis; estimatedStages: number } | null {
  const meds = stageMedianTimes(obs);
  const typical = typicalCourseMs(obs);
  if (typical === null || !stageIds.length) return null;
  let ms = 0, estimatedStages = 0;
  for (const id of stageIds) {
    const m = meds.get(id);
    if (m === undefined) { estimatedStages++; ms += typical; } else ms += m;
  }
  return { ms, estimatedStages };
}

const cellKey = (o: PaceObservation) => `${o.stageId}\u0000${o.rider}\u0000${o.machine}`;

/** Median of each stage + rider + machine cell, used as "what this combo normally does". */
function cellMedians(obs: PaceObservation[]): Map<string, { median: number; n: number }> {
  const by = new Map<string, number[]>();
  for (const o of obs) by.set(cellKey(o), [...(by.get(cellKey(o)) ?? []), o.timeMs]);
  return new Map([...by].map(([k, v]) => [k, { median: median(v), n: v.length }]));
}

export interface SubjectDetails {
  /** Typical race-to-race spread as % of the time (pooled within each stage + rider + machine). Null with too few repeats. */
  spreadPct: number | null;
  /** Share of races more than `thresholdPct` slower than that combo's usual time on that stage. */
  disasterRate: number | null;
  /** Races in cells with 2+ races (what the two numbers above come from). */
  repeatRaces: number;
  /** Stage where it's furthest ahead of / behind the stage's typical time (2+ races there). */
  strongest: { stageId: ID; pct: number } | null;
  weakest: { stageId: ID; pct: number } | null;
  /** Fastest and slowest single races (most useful with one stage selected). */
  best: PaceObservation | null;
  worst: PaceObservation | null;
}

/**
 * Details per subject. `keyOf` maps an observation to the ranked key
 * (rider, character group, machine, or "rider|machine").
 */
export function subjectDetails(
  obs: PaceObservation[], keyOf: (o: PaceObservation) => string, thresholdPct = 5,
): Map<string, SubjectDetails> {
  const cells = cellMedians(obs);
  const stageMeds = stageMedianTimes(obs);
  const bySubject = new Map<string, PaceObservation[]>();
  for (const o of obs) bySubject.set(keyOf(o), [...(bySubject.get(keyOf(o)) ?? []), o]);

  const out = new Map<string, SubjectDetails>();
  for (const [key, list] of bySubject) {
    // Spread and disasters: relative to the combo's own usual time on that stage.
    let ss = 0, df = 0, disasters = 0, repeat = 0;
    const byCell = new Map<string, number[]>();
    for (const o of list) byCell.set(cellKey(o), [...(byCell.get(cellKey(o)) ?? []), o.timeMs]);
    for (const [k, times] of byCell) {
      if (times.length < 2) continue;
      const m = cells.get(k)!.median;
      const rel = times.map(t => t / m);
      const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
      ss += rel.reduce((a, r) => a + (r - mean) ** 2, 0);
      df += rel.length - 1;
      disasters += times.filter(t => t > m * (1 + thresholdPct / 100)).length;
      repeat += times.length;
    }

    // Strongest / weakest stage: average gap to the stage's median time.
    const byStage = new Map<ID, number[]>();
    for (const o of list) {
      const sm = stageMeds.get(o.stageId);
      if (sm) byStage.set(o.stageId, [...(byStage.get(o.stageId) ?? []), (o.timeMs / sm - 1) * 100]);
    }
    const stagePaces = [...byStage]
      .filter(([, v]) => v.length >= 2)
      .map(([stageId, v]) => ({ stageId, pct: v.reduce((a, b) => a + b, 0) / v.length }))
      .sort((a, b) => a.pct - b.pct);

    const sorted = [...list].sort((a, b) => a.timeMs - b.timeMs);
    out.set(key, {
      best: sorted[0] ?? null,
      worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
      spreadPct: df >= 2 ? Math.sqrt(ss / df) * 100 : null,
      disasterRate: repeat ? disasters / repeat : null,
      repeatRaces: repeat,
      strongest: stagePaces.length >= 2 ? stagePaces[0] : null,
      weakest: stagePaces.length >= 2 ? stagePaces[stagePaces.length - 1] : null,
    });
  }
  return out;
}

// -------------------------------------------------------------
// Stages
// -------------------------------------------------------------

export interface StageOverview {
  stageId: ID;
  races: number;
  best: PaceObservation | null;
  worst: PaceObservation | null;
  medianMs: Millis | null;
  /** The combo with the fastest median (2+ races), and that median. */
  bestCombo: { rider: string; machine: ID; medianMs: Millis; n: number } | null;
  /** Typical race-to-race spread there, % (pooled within combos). */
  noisePct: number | null;
  disasterRate: number | null;
  /**
   * How much the machine matters: median-time gap between the fastest
   * and second-fastest machine there (each machine's best rider, 2+ races).
   */
  machineGap: { fastest: ID; second: ID; gapMs: Millis } | null;
  ridersTried: number;
  machinesTried: number;
}

export function stageOverview(obs: PaceObservation[], stageIds: ID[], thresholdPct = 5): StageOverview[] {
  return stageIds.map(stageId => {
    const list = obs.filter(o => o.stageId === stageId);
    if (!list.length) {
      return { stageId, races: 0, best: null, worst: null, medianMs: null, bestCombo: null, noisePct: null, disasterRate: null, machineGap: null, ridersTried: 0, machinesTried: 0 };
    }
    const sorted = [...list].sort((a, b) => a.timeMs - b.timeMs);
    const combos = new Map<string, number[]>();
    for (const o of list) {
      const k = `${o.rider}|${o.machine}`;
      combos.set(k, [...(combos.get(k) ?? []), o.timeMs]);
    }
    let ss = 0, df = 0, disasters = 0, repeat = 0;
    const comboMeds: { rider: string; machine: ID; medianMs: Millis; n: number }[] = [];
    for (const [k, times] of combos) {
      if (times.length < 2) continue;
      const [rider, machine] = k.split("|");
      const m = median(times);
      comboMeds.push({ rider, machine, medianMs: m, n: times.length });
      const rel = times.map(t => t / m);
      const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
      ss += rel.reduce((a, r) => a + (r - mean) ** 2, 0);
      df += rel.length - 1;
      disasters += times.filter(t => t > m * (1 + thresholdPct / 100)).length;
      repeat += times.length;
    }
    comboMeds.sort((a, b) => a.medianMs - b.medianMs);
    // Each machine at its best: the fastest combo median using it.
    const perMachine = new Map<ID, number>();
    for (const c of comboMeds) if (!perMachine.has(c.machine)) perMachine.set(c.machine, c.medianMs);
    const machines = [...perMachine].sort((a, b) => a[1] - b[1]);
    return {
      stageId,
      races: list.length,
      best: sorted[0],
      worst: sorted[sorted.length - 1],
      medianMs: median(list.map(o => o.timeMs)),
      bestCombo: comboMeds[0] ?? null,
      noisePct: df >= 2 ? Math.sqrt(ss / df) * 100 : null,
      disasterRate: repeat ? disasters / repeat : null,
      machineGap: machines.length >= 2 ? { fastest: machines[0][0], second: machines[1][0], gapMs: machines[1][1] - machines[0][1] } : null,
      ridersTried: new Set(list.map(o => o.rider)).size,
      machinesTried: new Set(list.map(o => o.machine)).size,
    };
  });
}
