// =============================================================
// Is a course good for competition? Two scores per course, within
// one format:
//
// - Skill: on the same machine, how often does the better amiibo
//   finish ahead? For every pair of amiibo raced on the same machine
//   (3+ races each), the share of race-vs-race match-ups the faster one
//   wins, averaged. 50% = a coin flip, 100% = the better one always
//   wins. Because the "better" one is picked from the same races, equal
//   amiibo still score a little above 50%, so a shuffle test (re-deal
//   the times among the amiibo a few hundred times) says whether the
//   score is real or could be luck.
//
// - Machine balance: how many machines are competitive. Each machine's
//   pace is estimated with the amiibo held equal (log time = amiibo +
//   machine, fitted on that course), and a machine within
//   BALANCE_PCT of the fastest counts as competitive.
// =============================================================

import type { ID } from "./schema";

export interface CourseSample { stageId: ID; amiibo: string; machine: ID; timeMs: number }

export interface SkillScore {
  /** Share of match-ups the better amiibo wins, 0.5–1. */
  winShare: number;
  /** Pairs of amiibo compared (same machine, 3+ races each). */
  pairs: number;
  verdict: "real" | "luck";
}

export interface MachineBalance {
  /** Each machine's gap from the fastest, %, fastest first; with its race count. */
  machines: { machine: ID; gapPct: number; races: number }[];
  /** How many are within BALANCE_PCT of the fastest. */
  competitive: number;
}

export interface CourseScore {
  stageId: ID;
  skill: SkillScore | null;
  balance: MachineBalance | null;
}

export const MIN_RACES = 3;
export const BALANCE_PCT = 2;
const SHUFFLES = 200;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Share of (a, b) race pairs where a is faster; ties count half. */
function beatShare(a: number[], b: number[]): number {
  let w = 0;
  for (const x of a) for (const y of b) w += x < y ? 1 : x === y ? 0.5 : 0;
  return w / (a.length * b.length);
}

/** Average, over amiibo pairs within each machine group, of the better one's win share. */
function skillStat(groups: number[][][]): { share: number; pairs: number } {
  let sum = 0, pairs = 0;
  for (const g of groups) {
    for (let i = 0; i < g.length; i++) {
      for (let j = i + 1; j < g.length; j++) {
        const p = beatShare(g[i], g[j]);
        sum += Math.max(p, 1 - p);
        pairs++;
      }
    }
  }
  return { share: pairs ? sum / pairs : 0, pairs };
}

function skillScore(samples: CourseSample[], seed: number): SkillScore | null {
  // machine → amiibo → times
  const byMachine = new Map<ID, Map<string, number[]>>();
  for (const s of samples) {
    const m = byMachine.get(s.machine) ?? new Map<string, number[]>();
    m.set(s.amiibo, [...(m.get(s.amiibo) ?? []), s.timeMs]);
    byMachine.set(s.machine, m);
  }
  const groups = [...byMachine.values()]
    .map(m => [...m.values()].filter(t => t.length >= MIN_RACES))
    .filter(g => g.length >= 2);
  if (!groups.length) return null;
  const observed = skillStat(groups);

  // Shuffle test: deal each machine's times back out at random, same group sizes.
  const rnd = seeded(seed);
  let atLeast = 0;
  for (let k = 0; k < SHUFFLES; k++) {
    const shuffled = groups.map(g => {
      const pool = g.flat();
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      let at = 0;
      return g.map(t => pool.slice(at, (at += t.length)));
    });
    if (skillStat(shuffled).share >= observed.share - 1e-9) atLeast++;
  }
  const p = (atLeast + 1) / (SHUFFLES + 1);
  return { winShare: observed.share, pairs: observed.pairs, verdict: p < 0.05 ? "real" : "luck" };
}

function machineBalance(samples: CourseSample[]): MachineBalance | null {
  // One cell per amiibo + machine with 3+ races: its median log time.
  const cells = new Map<string, { amiibo: string; machine: ID; times: number[] }>();
  for (const s of samples) {
    const k = `${s.amiibo}|${s.machine}`;
    const c = cells.get(k) ?? { amiibo: s.amiibo, machine: s.machine, times: [] };
    c.times.push(s.timeMs);
    cells.set(k, c);
  }
  const used = [...cells.values()].filter(c => c.times.length >= MIN_RACES)
    .map(c => ({ ...c, y: Math.log(median(c.times)) }));
  const machineIds = [...new Set(used.map(c => c.machine))];
  if (machineIds.length < 2) return null;

  // Keep only machines linked to another machine through some amiibo,
  // or the comparison would mix in who rode it.
  const amiiboMachines = new Map<string, Set<ID>>();
  for (const c of used) amiiboMachines.set(c.amiibo, (amiiboMachines.get(c.amiibo) ?? new Set()).add(c.machine));
  const linked = new Set<ID>();
  for (const ms of amiiboMachines.values()) if (ms.size >= 2) ms.forEach(m => linked.add(m));
  const cellsLinked = used.filter(c => linked.has(c.machine) && (amiiboMachines.get(c.amiibo)?.size ?? 0) >= 2);
  const machines = [...linked];
  if (machines.length < 2) return null;

  // Additive fit by alternating means: y = amiibo + machine.
  const a = new Map<string, number>(), m = new Map<ID, number>(machines.map(id => [id, 0]));
  for (let it = 0; it < 50; it++) {
    const aSum = new Map<string, [number, number]>();
    for (const c of cellsLinked) {
      const s = aSum.get(c.amiibo) ?? [0, 0];
      aSum.set(c.amiibo, [s[0] + c.y - (m.get(c.machine) ?? 0), s[1] + 1]);
    }
    aSum.forEach(([s, n], k) => a.set(k, s / n));
    const mSum = new Map<ID, [number, number]>();
    for (const c of cellsLinked) {
      const s = mSum.get(c.machine) ?? [0, 0];
      mSum.set(c.machine, [s[0] + c.y - (a.get(c.amiibo) ?? 0), s[1] + 1]);
    }
    mSum.forEach(([s, n], k) => m.set(k, s / n));
  }
  const best = Math.min(...m.values());
  const races = (id: ID) => cellsLinked.filter(c => c.machine === id).reduce((n, c) => n + c.times.length, 0);
  const list = machines
    .map(id => ({ machine: id, gapPct: (Math.exp((m.get(id) ?? 0) - best) - 1) * 100, races: races(id) }))
    .sort((x, y) => x.gapPct - y.gapPct);
  return { machines: list, competitive: list.filter(x => x.gapPct <= BALANCE_PCT).length };
}

export function courseScores(samples: CourseSample[], stageIds: ID[]): CourseScore[] {
  return stageIds.map((stageId, i) => {
    const mine = samples.filter(s => s.stageId === stageId);
    return { stageId, skill: skillScore(mine, 7919 * (i + 1) + mine.length), balance: machineBalance(mine) };
  });
}
