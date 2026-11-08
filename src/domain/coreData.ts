// =============================================================
// Core records: the counted results every stats view reads.
//
// A result counts when its race, its entry, its trial (if any) and its
// run (if any) are all included, and its run wasn't forfeited. Results
// are grouped by format, because formats never mix.
// =============================================================

import { getAll, getAllByIndex } from "../db/database";
import { countsForStats } from "./schema";
import type {
  FigurePlayerSnapshot, ID, Machine, PaceObservation, Race, Rider, TrackedMode,
} from "./schema";
import type { ResultRow } from "./insights";

export async function loadCoreRows(mode: TrackedMode): Promise<Map<ID, ResultRow[]>> {
  const [races, trials, runs] = await Promise.all([getAllByIndex("races", "mode", mode), getAll("testSets"), getAll("runs")]);
  const trialById = new Map(trials.map(t => [t.id, t]));
  const runById = new Map(runs.map(r => [r.id, r]));
  const byFormat = new Map<ID, ResultRow[]>();
  for (const race of races as Race[]) {
    const testSet = race.testSetId ? trialById.get(race.testSetId) : undefined;
    const run = race.runId ? runById.get(race.runId) : undefined;
    for (const entry of race.entries) {
      if (!countsForStats(race, entry, ["amiibo"], run, testSet)) continue;
      const list = byFormat.get(race.formatId) ?? [];
      list.push({ race, entry });
      byFormat.set(race.formatId, list);
    }
  }
  return byFormat;
}

/** What the "rider" side of an observation means. */
export type RiderKey = "rider" | "characterGroup" | "profile";

export interface ObservationFilter {
  stageId?: ID;                 // one stage only
  includeLegendaries: boolean;  // Dragoon / Hydra
  latestVersionOnly: boolean;   // each amiibo's newest version only
  riderKey: RiderKey;
  gameVersion?: string;         // one game version only; omit for all
  excludeProfileIds?: Set<ID>;  // e.g. baseline amiibo
  onlyProfileIds?: Set<ID>;     // e.g. baseline amiibo only
}

/**
 * Finished, timed results as model observations. Results without a
 * time (e.g. placement-only entries) can't feed the pace model and are
 * left out; `skippedUntimed` says how many.
 */
export function buildObservations(
  rows: ResultRow[],
  filter: ObservationFilter,
  ref: {
    riderById: Map<ID, Rider>;
    machineById: Map<ID, Machine>;
    snapshotsByProfile: Map<ID, FigurePlayerSnapshot[]>;
  },
): { obs: PaceObservation[]; skippedUntimed: number } {
  const latest = new Set([...ref.snapshotsByProfile.values()].map(list => list[0]?.id).filter(Boolean));
  const obs: PaceObservation[] = [];
  let skippedUntimed = 0;
  for (const { race, entry } of rows) {
    if (filter.stageId && race.stageId !== filter.stageId) continue;
    if (filter.gameVersion && race.gameVersion !== filter.gameVersion) continue;
    if (filter.excludeProfileIds && entry.racer.kind === "amiibo" && filter.excludeProfileIds.has(entry.racer.profileId)) continue;
    if (filter.onlyProfileIds && !(entry.racer.kind === "amiibo" && filter.onlyProfileIds.has(entry.racer.profileId))) continue;
    if (!filter.includeLegendaries && ref.machineById.get(entry.machineId)?.isLegendary) continue;
    if (filter.latestVersionOnly && entry.racer.kind === "amiibo" && !latest.has(entry.racer.snapshotId)) continue;
    if (entry.status !== "finished") continue;
    if (entry.finishTimeMs === null) { skippedUntimed++; continue; }
    const rider =
      filter.riderKey === "profile" ? (entry.racer.kind === "amiibo" ? entry.racer.profileId : entry.racer.playerId)
      : filter.riderKey === "characterGroup" ? (ref.riderById.get(entry.riderId)?.characterGroup ?? entry.riderId)
      : entry.riderId;
    obs.push({
      stageId: race.stageId, rider, machine: entry.machineId, timeMs: entry.finishTimeMs,
      profileId: entry.racer.kind === "amiibo" ? entry.racer.profileId : undefined, racedAt: race.racedAt,
    });
  }
  return { obs, skippedUntimed };
}

/** Game versions present in these results, newest first. */
export function gameVersionsIn(rows: ResultRow[]): string[] {
  const set = new Set(rows.map(r => r.race.gameVersion).filter((v): v is string => !!v));
  return [...set].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

/** Which amiibo count: trained ones (default), baseline ones, or both. */
export type AmiiboScope = "trained" | "baseline" | "both";

/** The observation-filter fields for an amiibo scope. */
export function scopeFilter(scope: AmiiboScope, profiles: { id: ID; isBaseline?: boolean }[]): Pick<ObservationFilter, "excludeProfileIds" | "onlyProfileIds"> {
  const baseline = new Set(profiles.filter(p => p.isBaseline).map(p => p.id));
  if (scope === "baseline") return { onlyProfileIds: baseline };
  if (scope === "trained") return { excludeProfileIds: baseline };
  return {};
}

/** Does this row fall in the amiibo scope? (For pages that work on rows, not observations.) */
export function inScope(scope: AmiiboScope, baselineIds: Set<ID>, r: ResultRow): boolean {
  const isBase = r.entry.racer.kind === "amiibo" && baselineIds.has(r.entry.racer.profileId);
  return scope === "both" || (scope === "baseline" ? isBase : !isBase);
}
