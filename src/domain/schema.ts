// =============================================================
// Kirby Air Riders Tracker — Data Schema (Step 1, rev 9)
//
// Hierarchy:  Mode  →  Format  →  Race  →  Entries (1–6 racers)
//   - Mode:   Air Ride | Top Ride (fully separate). City Trial + CPU tracking deferred.
//   - Format: a rule set you test ("retirement on, default laps, 4 racers")
//   - Race:   one result you enter (stage + 1–6 entries, 1–8 in Top Ride)
//   - Entry:  one racer's rider, machine, time, placement, notes
//
// Solo and multi-racer results share ONE shape: a solo format is
// just a format with trackedSeats = 1, so every stats view works on both.
//
// Conventions: times stored as integer ms (the game shows hundredths,
// "01:25.72" = 85720 ms) · UUID ids · ISO dates
// =============================================================

import type { CtFormat, CtMatch, CtSession, StadiumRun } from "./cityTrial";

export type ID = string;
export type ISODate = string;
export type Millis = number;

export interface BaseRecord {
  id: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// =============================================================
// MODES
// =============================================================
export type GameMode = "air_ride" | "top_ride" | "city_trial";

/**
 * Modes that currently have formats, menus and stats. City Trial is
 * deferred. Every format, stage, race, test trial and leaderboard
 * belongs to exactly ONE mode, and nothing is ever compared across
 * modes: Squeakers' Warp Star results in Air Ride and in Top Ride are
 * separate datasets, even though it's the same amiibo.
 */
export type TrackedMode = "air_ride" | "top_ride";

// =============================================================
// FORMATS — the main container your stats live in
// =============================================================
/**
 * In-game rule settings. `null` = "up to user discretion" (not
 * enforced by this format), matching how category rules are written.
 */
/** Racers in one race: up to 6 in Air Ride, up to 8 in Top Ride. */
export type Seats = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Most riders a race can have in each mode. */
export function maxRidersFor(mode: TrackedMode): Seats {
  return mode === "top_ride" ? 8 : 6;
}

export interface InGameSettings {
  gameTempo: "normal" | "slow" | null;            // the game has no "fast"
  numberOfRiders: Seats | null;                   // seats in the game, incl. CPUs
  ruleType: "laps" | "time" | null;               // "Rules: Laps"
  laps: "default" | number | null;
  boostAssist: boolean | null;
  specialAssist: boolean | null;
  enemies: boolean | null;
  retirement: boolean | null;
  // ---- Top Ride only (absent on Air Ride formats) ----
  items?: "off" | "few" | "normal" | "many" | null;
  itemRestrictions?: "normal" | "safety" | "attack" | "surprise" | null;
  /** Stage hazards. */
  features?: "all" | "limited" | null;
  antiReverse?: boolean | null;
  /** Top Ride's boost assist has three levels (Air Ride's is on/off). */
  boostAssistLevel?: "off" | "weak" | "strong" | null;
  /** Any setting not modelled above, keyed by its in-game label. */
  other?: Record<string, string | number | boolean>;
}

/**
 * A CPU the rules force into the race only to fill a seat
 * (e.g. Lv1 Kirby, Warp Star, Handicap 4). This is a RULE of the
 * format, shown on the setup checklist. CPU results are not logged.
 */
export interface FillerCpuSpec {
  riderId: ID;
  machineId: ID;
  cpuLevel: number;
  handicap: number;
  count: number;
}

/** How races group into a scored attempt. */
export type RunStructure =
  | { kind: "single_race" }                 // every race stands alone
  | {
      kind: "course_set";                   // e.g. every course once, IGT summed
      stageIds: ID[];                       // courses required for a complete run
      anyOrder: boolean;
      eachStageOnce: boolean;
      sameRacerThroughout: boolean;         // same amiibo/player all run
      machineMayChange: boolean;
    };

export interface Format extends BaseRecord {
  mode: TrackedMode;
  name: string;                 // "Solo amiibo — All Courses IGT"
  settings: InGameSettings;
  /**
   * Racers you log per race. CPUs in the race are not logged
   * (CPU tracking is deferred), so this can be less than
   * settings.numberOfRiders; placements still use the in-game order.
   */
  trackedSeats: Seats;
  /**
   * When true, a race may log anywhere from 1 to trackedSeats racers
   * (e.g. the default rules, where a race can have 2–6 riders).
   * When false/absent, every race logs exactly trackedSeats racers.
   */
  flexibleSeats?: boolean;
  /** The game's default rule set for this mode (one per mode, seeded). */
  isDefaultRules?: boolean;
  allowedRacerKinds: RacerKind[];          // solo amiibo category: ["amiibo"]
  fillerCpu?: FillerCpuSpec;
  scoring: "time" | "placement";           // what ranks a result
  timing: "igt" | "rta";                   // in-game time vs real time
  runStructure: RunStructure;
  /** Points by placement index (0 = 1st). Placement scoring only. */
  pointsTable?: number[];
  /**
   * What "best" means when this format drives recommendations:
   *  - mean_time  → lowest average (summed-time speedruns)
   *  - pb_chance  → lowest 10th-percentile time (highest ceiling)
   *  - placement  → lowest expected placement (races against others)
   */
  objective: "mean_time" | "pb_chance" | "placement";
  /**
   * Winner Index = median × w.median + stdDev × w.stdDev.
   * Default { median: 0.7, stdDev: 0.3 }. For ranking, only the ratio
   * matters: the default means each second of spread costs 0.43 s.
   */
  winnerIndexWeights: { median: number; stdDev: number };
  /** A race is a "disaster" when slower than the median by more than this %. Default 5. */
  disasterThresholdPct: number;
  forbidsGlitches: boolean;
  requiresVideo: boolean;
  description?: string;         // paste the full category rules here
  isArchived: boolean;
}

// =============================================================
// GAME ROSTER — 10 riders × 7 machines = 70 combos
// =============================================================
export interface Rider extends BaseRecord {
  name: string;                 // "Kirby (Snow Bowl)"
  /**
   * Groups variants for roll-up views. The four Kirby colors share
   * characterGroup "Kirby"; everyone else (Sword Kirby too) is their own group.
   */
  characterGroup: string;
  hasAmiibo: boolean;
  sortOrder: number;
  color?: string;
  /** Short note shown with the name, e.g. the colors that give this special. */
  description?: string;
  /**
   * The amiibo figure behind this rider. Riders sharing a figure are
   * colors of one figure (the four Kirby specials). An amiibo's color is
   * chosen when it's added, so it always races as that rider.
   */
  amiiboFigure?: string;
  /** Your own observations about this character (shown on its stats page). */
  notes?: string;
}

/** Can an amiibo trained as rider `a` race as rider `b`? (Same figure, e.g. another Kirby color.) */
export function sameFigure(a: Rider | undefined, b: Rider | undefined): boolean {
  if (!a || !b) return false;
  return a.id === b.id || (!!a.amiiboFigure && a.amiiboFigure === b.amiiboFigure);
}

export interface Machine extends BaseRecord {
  name: string;
  isLegendary: boolean;         // Dragoon, Hydra
  hasAmiibo: boolean;
  sortOrder: number;
  color?: string;
  /** Your own observations about this machine (shown on its page). */
  notes?: string;
}

/** A course/stage. Belongs to one mode (Air Ride courses ≠ Top Ride stages). */
export interface Stage extends BaseRecord {
  mode: TrackedMode;
  name: string;
  sortOrder: number;            // in-game order within its mode
  defaultLaps?: number;
  isArchived: boolean;
  /** Your own observations about this course (shown on its page). */
  notes?: string;
}

export interface Player extends BaseRecord {
  name: string;
  isMe: boolean;
  isArchived: boolean;
}

// =============================================================
// AMIIBO PROFILES — profile → snapshots (figure optional)
//
// The roster is fixed (10 riders), but you can have any number of
// trained PROFILES per rider:
//   "Dedede A", "Dedede B", "Dedede C"   → three profiles, riderId = Dedede
//   train Dedede A some more, then test   → new SNAPSHOT (v2) of Dedede A
//   wipe a figure and start a new one     → new profile; old one "retired"
//
// Stats can then compare profiles side by side (groupBy "profile"),
// or one profile against its own past versions (groupBy "snapshot").
// =============================================================

/** A physical figure. Optional: track it only if you want to know which figure holds which profile. */
export interface AmiiboFigure extends BaseRecord {
  riderId: ID;
  label: string;                // "Kirby #2"
  isArchived: boolean;
}

export interface AmiiboMachineFigure extends BaseRecord {
  machineId: ID;
  label: string;
  isArchived: boolean;
}

/**
 * One trained amiibo racer, e.g. Kirby "Squeakers". Many profiles per
 * rider are allowed. A profile is mode-independent (the same amiibo can
 * race Air Ride and Top Ride), but its RESULTS are always split by mode.
 */
export interface FigurePlayerProfile extends BaseRecord {
  riderId: ID;                  // which of the 10 riders
  nickname: string;             // the amiibo's in-game name; unique among active profiles
  personality?: string;         // the personality the game assigned it
  figureId?: ID;                // the physical figure it lives on, if tracked
  /** The profile this one was copied or restarted from, to trace lineages. */
  derivedFromProfileId?: ID;
  trainingGoal?: string;
  /**
   * A baseline amiibo: personality "Balanced" (level 50 with learning off
   * the whole time), i.e. the game's default AI. Used as the yardstick
   * for trained amiibo of the same rider, and left out of Rankings and
   * Best picks unless asked for.
   */
  isBaseline?: boolean;
  /**
   * Machine proficiency, 0–100, by City Trial machine id. Missing
   * machines (or no map at all) are maxed at 100.
   */
  machineProficiency?: Record<string, number>;
  status: "active" | "retired";
  retiredAt?: ISODate;
  notes?: string;
}

/**
 * A version of a profile: saved each time the amiibo is retrained, so
 * results can be compared version to version. Every logged amiibo is
 * assumed fully trained (level 50, 100 proficiency on every machine),
 * so no level or proficiency is recorded.
 */
export interface FigurePlayerSnapshot extends BaseRecord {
  profileId: ID;
  version: number;              // 1, 2, 3… within the profile
  takenAt: ISODate;
  /** What changed since the previous version (empty for v1). */
  trainingSinceLast?: string;
}

// =============================================================
// RESULTS
// =============================================================
/**
 * Racers that get logged. CPUs are deliberately NOT a racer kind yet:
 * they can use any character and machine, so tracking them is deferred
 * until the core app runs well (like City Trial).
 */
export type RacerKind = "human" | "amiibo";

/** Finishing place, CPUs included: up to 6 in Air Ride, 8 in Top Ride. */
export type Placement = Seats;

/** Who occupied a logged seat. */
export type Racer =
  | { kind: "human"; playerId: ID }
  | { kind: "amiibo"; profileId: ID; snapshotId: ID; machineFigureId?: ID };

export type FinishStatus = "finished" | "retired" | "dnf" | "dq";

export interface RaceEntry {
  id: ID;
  racer: Racer;
  riderId: ID;
  machineId: ID;
  /** Required when format.scoring is "placement"; optional otherwise. */
  placement?: Placement;
  status: FinishStatus;
  finishTimeMs: Millis | null;
  lapTimesMs?: Millis[];        // optional splits
  /** Recomputed on save; multi-racer only. */
  gapToFirstMs?: Millis | null;
  /** Per-racer stats switch (e.g. exclude one racer who disconnected). */
  includeInStats: boolean;
  /** Which test-set seat this entry fills (test-set races only). */
  testSetSeatId?: ID;
  /** Random events that hit this racer (enemy pattern, pitfall, hazard…). */
  incidentTagIds?: ID[];
  notes?: string;
}

export interface Race extends BaseRecord {
  /** Copied from the format and indexed, so every query can filter by mode first. */
  mode: TrackedMode;
  formatId: ID;
  stageId: ID;
  racedAt: ISODate;
  sessionId?: ID;               // optional grouping of one sitting
  runId?: ID;                   // set when the format uses a course_set run
  testSetId?: ID;               // set when the race belongs to a test set
  entries: RaceEntry[];         // format.trackedSeats, or 1..trackedSeats if flexibleSeats
  /**
   * Riders in the race, CPUs included, when the format doesn't fix it
   * (numberOfRiders "Any"). Gives placements context: 3rd of 6 vs 3rd of 3.
   */
  riderCount?: number;
  /**
   * The race winner's time, for when 1st place was an unlogged CPU.
   * Lets "gap to 1st" still be calculated for the logged racers.
   */
  firstPlaceTimeMs?: Millis;
  /** Master switch: unchecked = this whole race is ignored by stats. */
  includeInStats: boolean;
  /** A glitch/clip happened in this race (forfeits its run if forbidden). */
  glitchOccurred?: boolean;
  /**
   * Trial races only: keep this race for your records? Every trial race
   * shows in the trial's own stats; only kept ones reach the core records.
   * Undefined = follow the trial's default (TestSet.includeInStats).
   */
  keepInRecords?: boolean;
  /** Game version the race was played on (AppSettings.gameVersion when logged). */
  gameVersion?: string;
  notes?: string;
}

export type RunStatus = "in_progress" | "complete" | "forfeit" | "abandoned";

/**
 * One full attempt at a course_set format: one race per required
 * course, same racer throughout, total = sum of course IGTs.
 * The total is computed from its races, never typed in.
 * A "forfeit" run drops ALL of its races from every stat.
 */
export interface Run extends BaseRecord {
  formatId: ID;
  racer: Racer;                 // the single amiibo/player for the whole run
  startedAt: ISODate;
  status: RunStatus;
  forfeitReason?: string;       // "accidental clip on course 4"
  videoUrl?: string;
  submitted?: boolean;          // sent to the leaderboard
  includeInStats: boolean;
  notes?: string;
}

/** Optional: groups races from one sitting ("Tuesday practice", "GP night"). */
/**
 * A session: a named batch of races in one format (a test, a night of
 * racing, tournament prep). Races join it from Log race; each race still
 * chooses on its own whether it counts in your records.
 */
export interface Session extends BaseRecord {
  formatId: ID;
  name: string;
  date: ISODate;
  notes?: string;
  mode?: TrackedMode;
  /** Optional target, e.g. 10 races. */
  plannedRaces?: number | null;
  status?: "in_progress" | "complete";
}

// -------------------------------------------------------------
// TEST SETS — controlled batches for A/B comparisons
// -------------------------------------------------------------

/**
 * One racer's fixed slot in a test trial. The lineup is locked for
 * the whole trial, so every race compares like with like.
 */
export interface TestSetSeat {
  id: ID;
  racer: Racer;                 // amiibo snapshot (or human)
  riderId: ID;
  machineId: ID;
  label?: string;               // defaults to the amiibo's name, e.g. "Squeakers"
  /** False to show this seat in the trial but keep it out of meta stats. */
  includeInStats: boolean;
}

/**
 * A trial: a session of races with a fixed lineup you choose when you
 * start it, e.g. "5 amiibo, all on Hop Star, default rules".
 *
 * Parameters set at creation:
 *  - format   → the in-game rules (usually the default rules)
 *  - stage    → one fixed stage, or omitted to race on any stages
 *  - lineup   → 1–6 seats, each an amiibo + machine, locked for the trial
 *  - plannedRaces → any number, or null for open-ended
 *
 * Trial races are ordinary races of the format. includeInStats decides
 * whether they also count in the core records, and can be switched any
 * time. The trial page shows live stats overall and per stage.
 */
export interface TestSet extends BaseRecord {
  mode: TrackedMode;            // copied from the format
  formatId: ID;
  /** Fixed stage, or undefined when the trial moves between stages. */
  stageId?: ID;
  seats: TestSetSeat[];         // format.trackedSeats, or up to it if flexibleSeats
  plannedRaces: number | null;  // null = open-ended
  label: string;                // "Squeakers + Winged, baseline"
  experimentId?: ID;            // links trials you want compared
  status: "in_progress" | "complete";
  /** Default for "keep for records" on races without their own choice (Race.keepInRecords). */
  includeInStats: boolean;
  notes?: string;
}

/** One seat's running numbers, shown in the trial's live panel. */
export interface SeatLiveStats {
  seatId: ID;
  racesCounted: number;
  finished: number;
  // ---- times ----
  /** Full time distribution (null until at least one finished race). */
  times: DistributionStats | null;
  lastTimeMs: Millis | null;    // most recent race, for the "just happened" row
  trend: Millis[];              // finish times in race order, for a sparkline
  laps: LapSplit | null;        // when lap splits were entered
  // ---- placement (multi-seat trials) ----
  avgPlacement: number | null;
  winRate: number | null;
  podiumRate: number | null;
  avgPoints: number | null;
  avgGapToFirstMs: Millis | null;
  placementCounts: number[];    // [1sts, 2nds, 3rds, 4ths, 5ths, 6ths]
  // ---- reliability ----
  dnfRate: number | null;
  incidentCounts: { tagId: ID; count: number }[];
}

/** Everything the live panel needs, recomputed after each saved race. */
export interface TestSetLiveStats {
  testSetId: ID;
  racesDone: number;
  plannedRaces: number | null;
  progress: number | null;      // 0–1, null when open-ended
  seats: SeatLiveStats[];
  /** Spread of the winning time race to race: the stage's randomness for this lineup. */
  winningTimeStdDevMs: Millis | null;
  /** With this trial's spread, the smallest gap N races per set can reliably detect. */
  detectableDifferenceMs: Millis | null;
}

/**
 * Groups test sets that differ in ONE variable, for side-by-side
 * comparison: "Dedede on Floria Fields: Winged Star vs Warp Star".
 */
export interface Experiment extends BaseRecord {
  formatId: ID;
  name: string;
  /** The variable that changes between its sets. */
  variable: "machine" | "rider" | "snapshot" | "stage" | "lineup" | "other";
  hypothesis?: string;          // "Warp Star is faster on the hairpins"
  conclusion?: string;          // filled in once you've looked at the data
  notes?: string;
}

// -------------------------------------------------------------
// INCIDENT TAGS — label the random stuff
// -------------------------------------------------------------

/**
 * A reusable label for a random event, e.g. "Enemy blocked jump",
 * "Fell in pit", "Hit by hazard". Tag races with them, and the stage
 * view can show how much time each event costs and how often it happens.
 */
export interface IncidentTag extends BaseRecord {
  name: string;
  kind: "enemy" | "hazard" | "pitfall" | "collision" | "ai_mistake" | "other";
  stageId?: ID;                 // stage-specific tag; omitted = usable anywhere
  isArchived: boolean;
}

// =============================================================
// STATS — derived on the fly, never stored
// Defined here only to prove the schema can answer the questions.
// =============================================================
export type StatsGroupBy =
  | "rider" | "characterGroup" | "machine" | "combo" | "stage"
  | "profile"     // Squeakers vs Dedede B vs Dedede C
  | "snapshot"    // Squeakers v1 vs v2 vs v3
  | "testSet" | "incidentTag";

/**
 * Every stats query names its mode AND exactly one format of that
 * mode. Air Ride and Top Ride have separate menus and never share
 * results, and formats within a mode never mix either.
 */
export interface StatsQuery {
  mode: TrackedMode;
  formatId: ID;                 // must belong to `mode`
  stageId?: ID;                 // filter to one stage
  riderId?: ID;                 // filter to one rider, e.g. all Dedede profiles
  profileIds?: ID[];            // filter to chosen profiles, e.g. Squeakers + Dedede B
  groupBy: StatsGroupBy;
  racerPools: RacerKind[];      // default ["amiibo"]
  minSample: number;            // flag groups with too few races
}

// -------------------------------------------------------------
// LEADERBOARDS — "who is best overall?"
// -------------------------------------------------------------
//
// The problem with simple averages: if Kirby's times were mostly on
// Warp Star and Waddle Dee's mostly on Winged Star, or mostly on
// different stages, comparing their average times mixes up the rider
// with the machine and the stage.
//
// The fix (the "adjusted pace" model): every logged time is treated as
//
//     time = stage's base time × rider effect × machine effect
//
// and all three are estimated together from ALL your results in the
// format. The rider effect is then "how much faster or slower this
// rider is than average, on the same stage, on the same machine".
// The machine effect is the same with riders held equal. That makes
// "is Kirby generally faster than Waddle Dee?" and "is Warp Star
// generally faster than Winged Star?" fair questions, even when you
// haven't tested every combo on every stage.
//
// Shown as a percentage: −1.8% = 1.8% faster than the average rider
// (or machine). Lower is better. Each row also gets:
//  - a 95% range (from resampling your results), so you can tell a
//    real lead from noise
//  - a rank range ("2nd, could be 1st–4th")
//  - coverage: how many stages and partners it has data with
//
// Combos get one extra number, SYNERGY: how much better or worse the
// combo does than its rider and machine would predict separately
// (e.g. a rider who is average overall but great on Hop Star).

export type LeaderboardSubject = "rider" | "characterGroup" | "machine" | "combo";

export interface LeaderboardQuery {
  mode: TrackedMode;
  formatId: ID;                 // one format only
  subject: LeaderboardSubject;
  stageId?: ID;                 // "best on Floria Fields"; omit for all stages
  /**
   * "latest" uses only each profile's newest snapshot, so old,
   * less-trained versions don't drag a rider's ranking down.
   */
  snapshotScope: "all" | "latest";
  profileIds?: ID[];            // limit to chosen profiles
  includeLegendaries: boolean;  // Dragoon / Hydra on or off
  minSample: number;
}

export interface LeaderboardRow {
  key: string;                  // rider id, character group, machine id, or "riderId|machineId"
  rank: number;                 // 1 = fastest
  /** Adjusted pace vs the average, in % (lower = faster). The main ranking number. */
  pacePct: number;
  paceLowPct: number;           // 95% range
  paceHighPct: number;
  rankLow: number;              // rank range across resamples
  rankHigh: number;
  /** Plain average vs each stage's median, with no adjustment, for comparison. */
  rawPacePct: number;
  sampleSize: number;
  stagesCovered: number;
  /** Machines tried (for a rider) or riders tried (for a machine). */
  partnersCovered: number;
  /** Combos only: % better (−) or worse (+) than rider + machine predict. */
  synergyPct?: number;
  /** "low" = too few races; "medium" = rank could still move; "high" = rank is stable. */
  confidence: "low" | "medium" | "high";
}

/** One finished, counted result fed into the leaderboard model. */
export interface PaceObservation {
  stageId: ID;
  rider: string;                // riderId, or character group when ranking groups
  machine: string;              // machineId
  timeMs: Millis;
  /** Who raced it (amiibo profile id) and when; for naming records. */
  profileId?: ID;
  racedAt?: string;
}

/**
 * Metrics per group, all computed within one format.
 * Raw times can't be compared across stages (a long course isn't
 * "worse"), so cross-stage rankings use normalised times: each time
 * as % above that stage's median within the same format.
 */
export interface StatsRow {
  key: string;                  // rider/machine/combo/stage id
  sampleSize: number;
  lowSample: boolean;           // sampleSize < minSample
  // ---- timing ----
  /** Full distribution; raw-ms values are meaningful only with a stage filter. */
  times?: DistributionStats;
  normalisedPace?: number;      // e.g. +1.8 = 1.8% slower than stage median (cross-stage)
  laps?: LapSplit;
  // ---- placement (multi-racer formats) ----
  expectedPlacement?: number;   // EV of placement = Σ placement × P(placement)
  winRate?: number;
  podiumRate?: number;
  avgPoints?: number;
  avgGapToFirstMs?: Millis;     // mean of Δt = t_racer − t_1st
  // ---- reliability ----
  dnfRate?: number;             // share of entries with status "retired" | "dnf"
  incidentRate?: number;        // share of races with at least one incident tag
  incidents?: IncidentImpact[];
}

/** How often an incident happens and what it costs. */
export interface IncidentImpact {
  tagId: ID;
  frequency: number;            // share of races it appeared in
  /** Mean time with the incident − median time of clean races. */
  avgTimeCostMs: Millis | null;
}

/** Lap 1 (includes the start) vs the average later lap. */
export interface LapSplit {
  n: number;                    // races with splits
  lap1MeanMs: Millis;
  laterLapMeanMs: Millis;
}

/** Multi-racer only: how often A finished ahead of B when both raced. */
export interface HeadToHead {
  aKey: string;
  bKey: string;
  racesTogether: number;
  aAheadRate: number;
}

/**
 * Stage randomness view (groupBy "stage"). Separates the spread that
 * comes from the stage itself from the spread caused by choosing
 * different riders and machines.
 */
export interface StageVarianceRow {
  stageId: ID;
  sampleSize: number;
  bestTimeMs: Millis;           // best time ever, with who set it
  bestTimeRaceId: ID;
  medianTimeMs: Millis;
  p10Ms: Millis;                // fast end, ignoring flukes
  p90Ms: Millis;                // slow end, ignoring single disasters
  iqrMs: Millis;                // middle-50% spread
  totalStdDevMs: Millis;        // all results pooled
  disasterRate: number;         // share of races > median + format.disasterThresholdPct
  /**
   * Pooled spread WITHIN identical setups (same snapshot + rider +
   * machine, test sets especially). This is the stage's inherent
   * randomness: what's left when nothing you control changes.
   */
  inherentStdDevMs: Millis | null;
  coefficientOfVariation: number; // inherentStdDev / median, so stages of different length compare
  /** How often each incident happens here and what it costs on average. */
  incidents: IncidentImpact[];
}

/** Side-by-side result of two test sets (e.g. Winged Star vs Warp Star). */
export interface SetComparison {
  setAId: ID;
  setBId: ID;
  medianDiffMs: Millis;         // B − A; negative = B faster
  /** 95% bootstrap interval for the median difference. */
  ciLowMs: Millis;
  ciHighMs: Millis;
  /** True when the interval excludes 0, i.e. the gap is bigger than the noise. */
  isClearDifference: boolean;
  effectSize: number;           // Cohen's d: ~0.2 small, ~0.5 medium, ~0.8 large
}

export interface AppSettings {
  id: "settings";
  /** Pools for the "what's good" meta stats. */
  defaultRacerPools: RacerKind[]; // ["amiibo"]
  minSample: number;              // e.g. 5
  defaultFormatId?: ID;
  /**
   * The world-record format for each mode. It drives the
   * Recommendations tab (best combo per stage + best run plan).
   */
  recordFormatIds: Partial<Record<TrackedMode, ID>>;
  /** The game version races are being logged on, e.g. "1.3.4". New races are stamped with it. */
  gameVersion?: string;
}

/** The game version when version tracking was added; earlier races are assumed to be on it. */
export const INITIAL_GAME_VERSION = "1.3.4";

// -------------------------------------------------------------
// DISTRIBUTION STATS — the per-group time stats
// -------------------------------------------------------------

/**
 * Every time-based stat for one group of results. Chosen so that no
 * number drifts just because one group has more races than another:
 * percentiles replace "worst", "top 3 average" and "range" for ranking;
 * best/worst are kept as records only.
 */
export interface DistributionStats {
  n: number;
  meanMs: Millis;               // includes every mistake → summed-time formats
  medianMs: Millis;             // the typical race
  stdDevMs: Millis | null;      // sample SD (n − 1); null when n < 2
  cvPct: number | null;         // stdDev / mean × 100, compares stages of any length
  meanCiLowMs: Millis | null;   // 95% range for the mean (t-distribution)
  meanCiHighMs: Millis | null;
  p10Ms: Millis;                // ceiling: 10% of races are faster
  fastest20MeanMs: Millis;      // average of the fastest 20% (at least 1 race)
  p90Ms: Millis;                // disaster floor: 10% of races are slower
  iqrMs: Millis | null;         // middle-50% spread; null when n < 4
  disasterRate: number;         // share of races slower than median × (1 + threshold)
  bestMs: Millis;               // record only, don't rank by it
  worstMs: Millis;              // record only, don't rank by it
  /** Slope of time vs race order (ms per race). + = getting slower. null when n < 3. */
  trendMsPerRace: number | null;
  winnerIndex: number;
}

export const DEFAULT_WINNER_INDEX_WEIGHTS = { median: 0.7, stdDev: 0.3 };

/** Winner Index for a set of times. Lower is better. */
export function winnerIndex(
  values: number[], weights: { median: number; stdDev: number } = DEFAULT_WINNER_INDEX_WEIGHTS,
): number | null {
  if (values.length === 0) return null;
  return median(values) * weights.median + (sampleStdDev(values) ?? 0) * weights.stdDev;
}

function sampleStdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / (xs.length - 1));
}

/** Linear-interpolated quantile of an ascending-sorted array (p in 0–1). */
function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const T_95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
  2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
  2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];

/** Two-sided 95% t critical value; small samples get wider ranges. */
function tCritical95(df: number): number {
  return df <= 30 ? T_95[Math.max(1, df) - 1] : 1.96 + 2.4 / df;
}

/**
 * All distribution stats for times given IN RACE ORDER (the order is
 * used for the trend). Returns null when there are no times.
 */
export function distributionStats(
  timesInOrder: Millis[],
  weights: { median: number; stdDev: number } = DEFAULT_WINNER_INDEX_WEIGHTS,
  disasterThresholdPct = 5,
): DistributionStats | null {
  const n = timesInOrder.length;
  if (n === 0) return null;
  const sorted = [...timesInOrder].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  const med = quantile(sorted, 0.5);
  const sd = sampleStdDev(sorted);
  const half = sd === null ? null : (tCritical95(n - 1) * sd) / Math.sqrt(n);
  const fastCount = Math.max(1, Math.round(n * 0.2));

  let trend: number | null = null;
  if (n >= 3) {
    const xMean = (n - 1) / 2;
    let num = 0;
    let den = 0;
    timesInOrder.forEach((t, i) => { num += (i - xMean) * (t - mean); den += (i - xMean) ** 2; });
    trend = num / den;
  }

  return {
    n,
    meanMs: mean,
    medianMs: med,
    stdDevMs: sd,
    cvPct: sd === null ? null : (sd / mean) * 100,
    meanCiLowMs: half === null ? null : mean - half,
    meanCiHighMs: half === null ? null : mean + half,
    p10Ms: quantile(sorted, 0.1),
    fastest20MeanMs: sorted.slice(0, fastCount).reduce((a, b) => a + b, 0) / fastCount,
    p90Ms: quantile(sorted, 0.9),
    iqrMs: n >= 4 ? quantile(sorted, 0.75) - quantile(sorted, 0.25) : null,
    disasterRate: sorted.filter(t => t > med * (1 + disasterThresholdPct / 100)).length / n,
    bestMs: sorted[0],
    worstMs: sorted[n - 1],
    trendMsPerRace: trend,
    winnerIndex: med * weights.median + (sd ?? 0) * weights.stdDev,
  };
}

/**
 * Sample-size planning (95% confidence, 80% power).
 * racesNeededPerSet: races per set to reliably detect `differenceMs`.
 * detectableDifferenceMs: smallest gap `racesPerSet` can reliably detect.
 */
export function racesNeededPerSet(stdDevMs: Millis, differenceMs: Millis): number {
  return Math.ceil(15.68 * (stdDevMs / differenceMs) ** 2);
}
export function detectableDifferenceMs(stdDevMs: Millis, racesPerSet: number): Millis {
  return 2.8 * stdDevMs * Math.sqrt(2 / racesPerSet);
}

/** Lap 1 vs later laps, from entries that have at least 2 splits. */
export function lapSplit(entries: RaceEntry[]): LapSplit | null {
  const withSplits = entries.filter(e => e.status === "finished" && (e.lapTimesMs?.length ?? 0) >= 2);
  if (withSplits.length === 0) return null;
  const lap1 = withSplits.map(e => (e.lapTimesMs as Millis[])[0]);
  const later = withSplits.flatMap(e => (e.lapTimesMs as Millis[]).slice(1));
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { n: withSplits.length, lap1MeanMs: avg(lap1), laterLapMeanMs: avg(later) };
}

/** Frequency and time cost of each incident tag among these entries. */
export function incidentImpact(entries: RaceEntry[]): IncidentImpact[] {
  const finished = entries.filter(e => e.status === "finished" && e.finishTimeMs !== null);
  const clean = finished.filter(e => !e.incidentTagIds?.length).map(e => e.finishTimeMs as Millis);
  const cleanMedian = clean.length ? median(clean) : null;
  const tags = new Set(entries.flatMap(e => e.incidentTagIds ?? []));
  return [...tags].map(tagId => {
    const hit = entries.filter(e => e.incidentTagIds?.includes(tagId));
    const hitTimes = hit.filter(e => e.status === "finished" && e.finishTimeMs !== null).map(e => e.finishTimeMs as Millis);
    return {
      tagId,
      frequency: entries.length ? hit.length / entries.length : 0,
      avgTimeCostMs: cleanMedian !== null && hitTimes.length
        ? hitTimes.reduce((a, b) => a + b, 0) / hitTimes.length - cleanMedian
        : null,
    };
  });
}

/**
 * Head-to-head records from multi-racer races. `keyOf` decides what is
 * compared (profile, rider, combo…). Placement decides who was ahead.
 */
export function headToHead(races: Race[], keyOf: (e: RaceEntry) => string): HeadToHead[] {
  const tally = new Map<string, { together: number; aAhead: number }>();
  for (const race of races) {
    const placed = race.entries.filter(e => e.placement !== undefined);
    for (let i = 0; i < placed.length; i++) {
      for (let j = 0; j < placed.length; j++) {
        const a = keyOf(placed[i]);
        const b = keyOf(placed[j]);
        if (a >= b) continue; // each unordered pair once, a < b
        const t = tally.get(`${a}\u0000${b}`) ?? { together: 0, aAhead: 0 };
        t.together++;
        if (Number(placed[i].placement) < Number(placed[j].placement)) t.aAhead++;
        tally.set(`${a}\u0000${b}`, t);
      }
    }
  }
  return [...tally].map(([pair, t]) => {
    const [aKey, bKey] = pair.split("\u0000");
    return { aKey, bKey, racesTogether: t.together, aAheadRate: t.aAhead / t.together };
  });
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Small seeded RNG so the same data always gives the same interval. */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compare two sets of finish times (ms). Uses a bootstrap for the
 * median difference, which works with small sets like 10 vs 10 and
 * doesn't assume times are normally distributed.
 */
export function compareSamples(
  a: Millis[], b: Millis[], setAId: ID, setBId: ID, iterations = 5000,
): SetComparison | null {
  if (a.length < 2 || b.length < 2) return null;
  const rand = mulberry32(a.length * 7919 + b.length);
  const resample = (xs: number[]) => xs.map(() => xs[Math.floor(rand() * xs.length)]);
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i++) diffs.push(median(resample(b)) - median(resample(a)));
  diffs.sort((x, y) => x - y);
  const ciLowMs = diffs[Math.floor(iterations * 0.025)];
  const ciHighMs = diffs[Math.floor(iterations * 0.975)];

  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const variance = (xs: number[]) => {
    const m = mean(xs);
    return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  };
  const pooledSd = Math.sqrt(
    ((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (a.length + b.length - 2),
  );

  return {
    setAId,
    setBId,
    medianDiffMs: median(b) - median(a),
    ciLowMs,
    ciHighMs,
    isClearDifference: ciLowMs > 0 || ciHighMs < 0,
    effectSize: pooledSd === 0 ? 0 : (mean(b) - mean(a)) / pooledSd,
  };
}

// -------------------------------------------------------------
// Adjusted pace model (see LEADERBOARDS above)
// -------------------------------------------------------------

interface PaceFit {
  stage: Map<string, number>;   // log of the stage's base time
  rider: Map<string, number>;   // log-scale effects, 0 = average
  machine: Map<string, number>; // machine's AVERAGE effect across stages
  /** Stage-specific machine edge, e.g. Hop Star being extra good on one course. Key "stage|machine". */
  stageMachine: Map<string, number>;
  combo: Map<string, number>;   // rider × machine synergy on top of everything else
}

const comboKey = (rider: string, machine: string) => `${rider}|${machine}`;

/**
 * Fits log(time) = stage + rider + machine + stage×machine by
 * alternating averages (backfitting), then rider×machine synergy.
 *
 * - Rider and machine effects are unshrunk, so they stay unbiased when
 *   combos are unevenly tested; thin data shows up as a wide range and
 *   "low" confidence instead.
 * - The stage×machine term lets a machine be better on some courses
 *   than others. Without it, one course where a machine shines would
 *   inflate that machine's prediction on every other course.
 * - Both interaction terms are shrunk (`interactionShrink` pseudo-races
 *   of "no edge"), so a couple of lucky races can't claim a big edge.
 */
function fitPace(obs: PaceObservation[], iterations = 80, shrink = 0, interactionShrink = 5): PaceFit {
  const N = obs.length;
  // Map string keys to dense integer indexes once, then work on typed arrays.
  const indexer = () => {
    const ids = new Map<string, number>();
    const idx = new Int32Array(N);
    return {
      ids,
      idx,
      set(i: number, key: string) {
        let v = ids.get(key);
        if (v === undefined) { v = ids.size; ids.set(key, v); }
        idx[i] = v;
      },
    };
  };
  const S = indexer(), R = indexer(), M = indexer(), C = indexer(), SM = indexer();
  const y = new Float64Array(N);
  obs.forEach((o, i) => {
    y[i] = Math.log(o.timeMs);
    S.set(i, o.stageId); R.set(i, o.rider); M.set(i, o.machine); C.set(i, comboKey(o.rider, o.machine));
    SM.set(i, comboKey(o.stageId, o.machine));
  });
  const counts = (ix: Int32Array, size: number) => {
    const n = new Float64Array(size);
    for (let i = 0; i < N; i++) n[ix[i]]++;
    return n;
  };
  const nS = counts(S.idx, S.ids.size), nR = counts(R.idx, R.ids.size);
  const nM = counts(M.idx, M.ids.size), nC = counts(C.idx, C.ids.size), nSM = counts(SM.idx, SM.ids.size);
  const st = new Float64Array(S.ids.size), rd = new Float64Array(R.ids.size);
  const mc = new Float64Array(M.ids.size), cb = new Float64Array(C.ids.size), sm = new Float64Array(SM.ids.size);

  /** Average residual per level, shrunk by k; optionally centred so the data-weighted mean is 0. */
  const update = (eff: Float64Array, ix: Int32Array, n: Float64Array, residual: (i: number) => number, k: number, centre: boolean) => {
    const sum = new Float64Array(eff.length);
    for (let i = 0; i < N; i++) sum[ix[i]] += residual(i);
    let maxChange = 0;
    let weighted = 0;
    for (let j = 0; j < eff.length; j++) {
      const v = sum[j] / (n[j] + k);
      maxChange = Math.max(maxChange, Math.abs(v - eff[j]));
      eff[j] = v;
      weighted += v * n[j];
    }
    if (centre) {
      const offset = weighted / N;
      for (let j = 0; j < eff.length; j++) eff[j] -= offset;
    }
    return maxChange;
  };

  for (let it = 0; it < iterations; it++) {
    update(st, S.idx, nS, i => y[i] - rd[R.idx[i]] - mc[M.idx[i]] - sm[SM.idx[i]], 0, false);
    const a = update(rd, R.idx, nR, i => y[i] - st[S.idx[i]] - mc[M.idx[i]] - sm[SM.idx[i]], shrink, true);
    const b = update(mc, M.idx, nM, i => y[i] - st[S.idx[i]] - rd[R.idx[i]] - sm[SM.idx[i]], shrink, true);
    const c = update(sm, SM.idx, nSM, i => y[i] - st[S.idx[i]] - rd[R.idx[i]] - mc[M.idx[i]], interactionShrink, false);
    if (Math.max(a, b, c) < 1e-10) break;
  }
  update(cb, C.idx, nC, i => y[i] - st[S.idx[i]] - rd[R.idx[i]] - mc[M.idx[i]] - sm[SM.idx[i]], interactionShrink, false);

  const toMap = (ids: Map<string, number>, eff: Float64Array) =>
    new Map([...ids].map(([key, j]) => [key, eff[j]] as [string, number]));
  return {
    stage: toMap(S.ids, st), rider: toMap(R.ids, rd), machine: toMap(M.ids, mc),
    stageMachine: toMap(SM.ids, sm), combo: toMap(C.ids, cb),
  };
}

const toPct = (logEffect: number) => (Math.exp(logEffect) - 1) * 100;

function effectsFor(fit: PaceFit, subject: LeaderboardSubject): Map<string, number> {
  if (subject === "machine") return fit.machine;
  if (subject === "rider" || subject === "characterGroup") return fit.rider;
  const out = new Map<string, number>();
  for (const [key, synergy] of fit.combo) {
    const [r, m] = key.split("|");
    out.set(key, (fit.rider.get(r) ?? 0) + (fit.machine.get(m) ?? 0) + synergy);
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];
}

/**
 * Builds a leaderboard from counted, finished results of ONE format.
 * The caller filters by mode, format, stage, snapshot scope,
 * legendaries and include_in_stats before passing observations in,
 * and maps rider → character group when subject is "characterGroup".
 * For big datasets, run it in a Web Worker so the UI stays smooth.
 */
export function buildLeaderboard(
  obs: PaceObservation[], subject: LeaderboardSubject, minSample: number, resamples = 300,
): LeaderboardRow[] {
  if (obs.length === 0) return [];
  const keyOf = (o: PaceObservation) =>
    subject === "machine" ? o.machine : subject === "combo" ? comboKey(o.rider, o.machine) : o.rider;

  // Point estimates
  const fit = fitPace(obs);
  const effects = effectsFor(fit, subject);
  const ranked = [...effects.entries()].sort((a, b) => a[1] - b[1]);

  // Unadjusted pace: each time vs its stage median
  const byStage = new Map<string, number[]>();
  obs.forEach(o => {
    const list = byStage.get(o.stageId);
    if (list) list.push(o.timeMs); else byStage.set(o.stageId, [o.timeMs]);
  });
  const stageMedian = new Map([...byStage].map(([s, ts]) => [s, median(ts)]));

  // Coverage
  const n = new Map<string, number>();
  const stages = new Map<string, Set<string>>();
  const partners = new Map<string, Set<string>>();
  const raw = new Map<string, number[]>();
  obs.forEach(o => {
    const k = keyOf(o);
    n.set(k, (n.get(k) ?? 0) + 1);
    stages.set(k, (stages.get(k) ?? new Set()).add(o.stageId));
    partners.set(k, (partners.get(k) ?? new Set()).add(subject === "machine" ? o.rider : o.machine));
    const rawList = raw.get(k) ?? [];
    rawList.push(Math.log(o.timeMs / (stageMedian.get(o.stageId) as number)));
    raw.set(k, rawList);
  });

  // Uncertainty: refit on resampled data
  const rand = mulberry32(obs.length * 2654435761);
  const samples = new Map<string, number[]>();
  const ranks = new Map<string, number[]>();
  for (let b = 0; b < resamples; b++) {
    const resample = obs.map(() => obs[Math.floor(rand() * obs.length)]);
    const e = effectsFor(fitPace(resample, 30), subject);
    [...e.entries()].sort((x, y) => x[1] - y[1]).forEach(([k, v], i) => {
      const sList = samples.get(k) ?? [];
      sList.push(v);
      samples.set(k, sList);
      const rList = ranks.get(k) ?? [];
      rList.push(i + 1);
      ranks.set(k, rList);
    });
  }

  return ranked.map(([key, effect], i) => {
    const s = (samples.get(key) ?? [effect]).sort((a, b) => a - b);
    const r = (ranks.get(key) ?? [i + 1]).sort((a, b) => a - b);
    const rankLow = percentile(r, 0.025);
    const rankHigh = percentile(r, 0.975);
    const size = n.get(key) ?? 0;
    const rawLogs = raw.get(key) ?? [0];
    return {
      key,
      rank: i + 1,
      pacePct: toPct(effect),
      paceLowPct: toPct(percentile(s, 0.025)),
      paceHighPct: toPct(percentile(s, 0.975)),
      rankLow,
      rankHigh,
      rawPacePct: toPct(rawLogs.reduce((a, v) => a + v, 0) / rawLogs.length),
      sampleSize: size,
      stagesCovered: stages.get(key)?.size ?? 0,
      partnersCovered: partners.get(key)?.size ?? 0,
      synergyPct: subject === "combo" ? toPct(fit.combo.get(key) ?? 0) : undefined,
      confidence: size < minSample ? "low" : rankHigh - rankLow <= 1 ? "high" : "medium",
    };
  });
}

// =============================================================
// RECOMMENDATIONS — the world-record answer
// =============================================================
//
// Driven by the record format of a mode (settings.recordFormatIds).
// Two views:
//
//  1. BEST COMBO PER STAGE: for every stage, the rider (or your amiibo
//     profile) + machine with the best expected time, its runners-up,
//     and how settled the answer is.
//
//  2. RUN PLAN: the solo category uses ONE amiibo for the whole run but
//     lets it change machine per course. For each profile, pick the best
//     machine on every course and add up the expected times. The
//     profile with the lowest total is the one to run.
//
// Untested combos aren't ignored: the adjusted-pace model predicts them
// from everything else you've logged (stage × rider × machine). A
// prediction is never shown as the answer, but when one could beat the
// current best it's listed under "test next", so the data you collect
// goes where it can still change the recommendation.

export interface RecommendationQuery {
  mode: TrackedMode;
  formatId: ID;                 // normally settings.recordFormatIds[mode]
  /** "riders" = the 10 characters; "profiles" = your trained amiibo. */
  scope: "riders" | "profiles";
  snapshotScope: "all" | "latest";
  includeLegendaries: boolean;
  minSample: number;            // races before a combo counts as "measured"
}

export interface CandidateOption {
  rider: string;                // riderId, or profileId when scope is "profiles"
  machineId: ID;
  /** Measured mean time, or the model's prediction. */
  expectedMs: Millis;
  source: "measured" | "predicted";
  n: number;                    // races logged for this exact combo on this stage
  ciLowMs: Millis | null;       // 95% range for the mean (measured only)
  ciHighMs: Millis | null;
  stdDevMs: Millis | null;
  disasterRate: number | null;
}

/**
 * settled    → best option is measured and clearly ahead of every rival
 * likely     → best option is measured, but a measured rival's range overlaps
 * needs_data → nothing measured yet, or an untested combo is predicted to beat it
 */
export type RecommendationStatus = "settled" | "likely" | "needs_data";

export interface StageRecommendation {
  stageId: ID;
  best: CandidateOption | null; // always a measured option when one exists
  alternatives: CandidateOption[]; // next best options, up to 4
  status: RecommendationStatus;
  /** Races to run next to settle this stage, most promising first (up to 3). */
  testNext: CandidateOption[];
  /** Fastest single time logged on this stage in this format. */
  stageRecord: { timeMs: Millis; rider: string; machineId: ID } | null;
}

export interface RunPlanCourse {
  stageId: ID;
  machineId: ID;
  expectedMs: Millis;
  source: "measured" | "predicted";
  n: number;
  ciHalfWidthMs: Millis | null;
}

export interface RunPlan {
  rider: string;                // profileId (or riderId)
  courses: RunPlanCourse[];
  /** Sum of expected course times (only meaningful when coursesMissing is empty). */
  totalMs: Millis;
  /** 95% ± on the total, only when every course is measured. */
  totalCiHalfWidthMs: Millis | null;
  coursesMeasured: number;
  coursesPredicted: number;
  coursesMissing: ID[];         // no data and no prediction possible
}

/**
 * Plan ordering: complete plans first, then fully measured plans
 * (a measured plan is the answer; a faster prediction is something to
 * test, not something to run), then fastest total.
 */
const planOrder = (a: RunPlan, b: RunPlan) =>
  a.coursesMissing.length - b.coursesMissing.length
  || Number(a.coursesPredicted > 0) - Number(b.coursesPredicted > 0)
  || a.totalMs - b.totalMs;

const stageKey = (stage: string, rider: string, machine: string) => `${stage}\u0000${rider}\u0000${machine}`;

/**
 * Best combo per stage. `obs` must already be filtered to ONE mode and
 * ONE format, counted results only, with `rider` set to riderId or
 * profileId to match `riders`.
 */
export function buildStageRecommendations(
  obs: PaceObservation[], stageIds: ID[], riders: string[], machines: ID[], minSample: number,
): StageRecommendation[] {
  const fit = obs.length ? fitPace(obs) : null;
  const groups = new Map<string, Millis[]>();
  const records = new Map<string, PaceObservation>();
  for (const o of obs) {
    const k = stageKey(o.stageId, o.rider, o.machine);
    const list = groups.get(k);
    if (list) list.push(o.timeMs); else groups.set(k, [o.timeMs]);
    const rec = records.get(o.stageId);
    if (!rec || o.timeMs < rec.timeMs) records.set(o.stageId, o);
  }

  return stageIds.map(stageId => {
    const candidates: CandidateOption[] = [];
    for (const rider of riders) {
      for (const machineId of machines) {
        const times = groups.get(stageKey(stageId, rider, machineId)) ?? [];
        if (times.length >= minSample) {
          const d = distributionStats(times) as DistributionStats;
          candidates.push({
            rider, machineId, expectedMs: d.meanMs, source: "measured", n: times.length,
            ciLowMs: d.meanCiLowMs, ciHighMs: d.meanCiHighMs, stdDevMs: d.stdDevMs, disasterRate: d.disasterRate,
          });
        } else if (fit && fit.stage.has(stageId) && fit.rider.has(rider) && fit.machine.has(machineId)) {
          const log = (fit.stage.get(stageId) as number) + (fit.rider.get(rider) as number)
            + (fit.machine.get(machineId) as number)
            + (fit.stageMachine.get(comboKey(stageId, machineId)) ?? 0)
            + (fit.combo.get(comboKey(rider, machineId)) ?? 0);
          candidates.push({
            rider, machineId, expectedMs: Math.exp(log), source: "predicted", n: times.length,
            ciLowMs: null, ciHighMs: null, stdDevMs: null, disasterRate: null,
          });
        }
      }
    }
    candidates.sort((a, b) => a.expectedMs - b.expectedMs);

    const rec = records.get(stageId);
    const stageRecord = rec ? { timeMs: rec.timeMs, rider: rec.rider, machineId: rec.machine } : null;
    const bestMeasured = candidates.find(c => c.source === "measured");

    if (!bestMeasured) {
      return {
        stageId, best: null, alternatives: candidates.slice(0, 4), status: "needs_data" as const,
        testNext: candidates.slice(0, 3), stageRecord,
      };
    }
    const ceiling = bestMeasured.ciHighMs ?? bestMeasured.expectedMs;
    const challengers = candidates.filter(c => c !== bestMeasured && (
      c.source === "measured" ? (c.ciLowMs ?? c.expectedMs) < ceiling : c.expectedMs < ceiling
    ));
    const predictedThreat = challengers.some(c => c.source === "predicted" && c.expectedMs < bestMeasured.expectedMs);
    return {
      stageId,
      best: bestMeasured,
      alternatives: candidates.filter(c => c !== bestMeasured).slice(0, 4),
      status: challengers.length === 0 ? "settled" : predictedThreat ? "needs_data" : "likely",
      testNext: challengers.slice(0, 3),
      stageRecord,
    };
  });
}

/**
 * Run plans: for each rider/profile, the best machine on every course
 * and the expected total. If the format forbids machine changes, each
 * machine is tried for the whole run and the best single machine wins.
 * Sorted fastest first; plans with missing courses go last.
 */
export function buildRunPlans(
  obs: PaceObservation[], stageIds: ID[], riders: string[], machines: ID[],
  minSample: number, machineMayChange: boolean,
): RunPlan[] {
  const recsByRider = new Map(riders.map(r => [r, buildStageRecommendations(obs, stageIds, [r], machines, minSample)]));

  const planFor = (rider: string, pick: (rec: StageRecommendation) => CandidateOption | undefined): RunPlan => {
    const courses: RunPlanCourse[] = [];
    const missing: ID[] = [];
    for (const rec of recsByRider.get(rider) as StageRecommendation[]) {
      const c = pick(rec);
      if (!c) { missing.push(rec.stageId); continue; }
      courses.push({
        stageId: rec.stageId, machineId: c.machineId, expectedMs: c.expectedMs, source: c.source, n: c.n,
        ciHalfWidthMs: c.ciHighMs !== null ? c.ciHighMs - c.expectedMs : null,
      });
    }
    const measured = courses.filter(c => c.source === "measured");
    const allMeasured = missing.length === 0 && measured.length === courses.length;
    return {
      rider,
      courses,
      totalMs: courses.reduce((a, c) => a + c.expectedMs, 0),
      totalCiHalfWidthMs: allMeasured && measured.every(c => c.ciHalfWidthMs !== null)
        ? Math.sqrt(measured.reduce((a, c) => a + (c.ciHalfWidthMs as number) ** 2, 0))
        : null,
      coursesMeasured: measured.length,
      coursesPredicted: courses.length - measured.length,
      coursesMissing: missing,
    };
  };

  const options = (rec: StageRecommendation) => [rec.best, ...rec.alternatives].filter((c): c is CandidateOption => !!c);

  const plans = riders.map(rider => {
    if (machineMayChange) {
      // Prefer the best measured option per course; fall back to the best prediction.
      return planFor(rider, rec => rec.best ?? options(rec)[0]);
    }
    const perMachine = machines.map(m => planFor(rider, rec => {
      const forMachine = options(rec).filter(c => c.machineId === m);
      return forMachine.find(c => c.source === "measured") ?? forMachine[0];
    }));
    perMachine.sort(planOrder);
    return perMachine[0];
  });

  return plans.sort(planOrder);
}

// =============================================================
// EXPORT / IMPORT
// =============================================================
export const SCHEMA_VERSION = 1;

export interface ExportFile {
  app: "kirby-air-riders-tracker";
  schemaVersion: number;
  exportedAt: ISODate;
  data: {
    settings: AppSettings;
    formats: Format[];
    riders: Rider[];
    machines: Machine[];
    stages: Stage[];
    players: Player[];
    amiiboFigures: AmiiboFigure[];
    amiiboMachineFigures: AmiiboMachineFigure[];
    figurePlayerProfiles: FigurePlayerProfile[];
    figurePlayerSnapshots: FigurePlayerSnapshot[];
    sessions: Session[];
    runs: Run[];
    testSets: TestSet[];
    experiments: Experiment[];
    incidentTags: IncidentTag[];
    races: Race[];
    // City Trial (missing in files saved before City Trial existed; read as empty)
    ctFormats: CtFormat[];
    ctSessions: CtSession[];
    ctMatches: CtMatch[];
    stadiumRuns: StadiumRun[];
  };
}

// =============================================================
// HELPERS
// =============================================================
/**
 * Recompute gap to 1st for every entry. If 1st place was an unlogged
 * CPU, pass the race's firstPlaceTimeMs so gaps can still be worked out.
 */
export function computeGaps(entries: RaceEntry[], firstPlaceTimeMs?: Millis): RaceEntry[] {
  const winner = entries.find(e => e.placement === 1 && e.status === "finished");
  const winTime = winner?.finishTimeMs ?? firstPlaceTimeMs ?? null;
  return entries.map(e => ({
    ...e,
    gapToFirstMs:
      winTime !== null && e.finishTimeMs !== null && e.status === "finished"
        ? e.finishTimeMs - winTime
        : null,
  }));
}

/**
 * Format like the game: "01:25.72" (minutes:seconds.hundredths).
 * Averages and predictions are rounded to the nearest hundredth.
 */
export function formatGameTime(ms: Millis | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const cs = Math.round(ms / 10);
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const h = cs % 100;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(h).padStart(2, "0")}`;
}

/** Signed gap like "+1.50" or "−0.32" (seconds.hundredths; minutes added past 60 s). */
export function formatGap(ms: Millis | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const sign = ms < 0 ? "−" : "+";
  const cs = Math.round(Math.abs(ms) / 10);
  if (cs >= 6000) return sign + formatGameTime(cs * 10);
  return `${sign}${Math.floor(cs / 100)}.${String(cs % 100).padStart(2, "0")}`;
}

/**
 * Parse a typed time into ms. Accepts:
 *   "01:25.72", "1:25.72", "1:25.7", "1:25"  → minutes:seconds(.hundredths)
 *   "1.25.72"                                → same, typed with dots
 *   "012572" / "12572"                       → digits only: mmsscc / msscc (fast entry)
 *   "85.72"                                  → seconds with a decimal point
 * Returns null if it can't be read or seconds ≥ 60 in a minutes form.
 */
export function parseGameTime(input: string): Millis | null {
  const t = input.trim().replace(/\s+/g, "").replace(",", ".");
  const fracMs = (f: string | undefined) => Math.round(Number(`0.${f || "0"}`) * 1000);
  let match: RegExpExecArray | null;

  if ((match = /^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(t)) ||
      (match = /^(\d{1,2})\.(\d{2})\.(\d{1,3})$/.exec(t))) {
    const [, m, sec, frac] = match;
    if (Number(sec) >= 60) return null;
    return (Number(m) * 60 + Number(sec)) * 1000 + fracMs(frac);
  }
  if ((match = /^(\d{1,2})(\d{2})(\d{2})$/.exec(t))) {               // digits only: (m)mss cc
    const [, m, sec, cs] = match;
    if (Number(sec) >= 60) return null;
    return (Number(m) * 60 + Number(sec)) * 1000 + Number(cs) * 10;
  }
  if ((match = /^(\d{1,4})\.(\d{1,3})$/.exec(t))) {                  // seconds.decimal
    return Number(match[1]) * 1000 + fracMs(match[2]);
  }
  return null;
}

/**
 * The single gate every stat goes through. A race counts only if it,
 * the racer's entry, its run and its test set are all included, and
 * the racer's kind is in the requested pools. Forfeited runs drop out
 * entirely.
 */
export function countsForStats(
  race: Race,
  entry: RaceEntry,
  pools: RacerKind[],
  run?: Run,
  testSet?: TestSet,
): boolean {
  if (run && (run.status === "forfeit" || !run.includeInStats)) return false;
  if (testSet && !(race.keepInRecords ?? testSet.includeInStats)) return false;
  return race.includeInStats && entry.includeInStats && pools.includes(entry.racer.kind);
}

/**
 * Live stats for a test trial. Call it whenever the trial's races
 * change (Dexie's useLiveQuery does this automatically), and the panel
 * updates after every saved race. Races unticked from stats are skipped;
 * every seat is shown, including ones left out of meta stats.
 */
export function testSetLiveStats(
  set: TestSet,
  format: Format,
  races: Race[],
): TestSetLiveStats {
  const counted = races
    .filter(r => r.testSetId === set.id && r.includeInStats)
    .sort((a, b) => a.racedAt.localeCompare(b.racedAt));

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const isMulti = format.trackedSeats > 1;

  const seats: SeatLiveStats[] = set.seats.map(seat => {
    const entries = counted
      .map(r => r.entries.find(e => e.testSetSeatId === seat.id))
      .filter((e): e is RaceEntry => e !== undefined && e.includeInStats);
    const times = entries
      .filter(e => e.status === "finished" && e.finishTimeMs !== null)
      .map(e => e.finishTimeMs as Millis);
    const placements = entries.map(e => e.placement).filter((p): p is Placement => p !== undefined);
    const gaps = entries.map(e => e.gapToFirstMs).filter((g): g is Millis => g != null);
    const placementCounts = [1, 2, 3, 4, 5, 6, 7, 8].map(p => placements.filter(x => x === p).length);
    const tagCounts = new Map<ID, number>();
    entries.forEach(e => e.incidentTagIds?.forEach(t => tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1)));
    const n = entries.length;

    return {
      seatId: seat.id,
      racesCounted: n,
      finished: times.length,
      times: distributionStats(times, format.winnerIndexWeights, format.disasterThresholdPct),
      lastTimeMs: times.length ? times[times.length - 1] : null,
      trend: times,
      laps: lapSplit(entries),
      avgPlacement: isMulti ? mean(placements) : null,
      winRate: isMulti && placements.length ? placementCounts[0] / placements.length : null,
      podiumRate: isMulti && placements.length
        ? placements.filter(p => p <= 3).length / placements.length
        : null,
      avgPoints: isMulti && format.pointsTable && placements.length
        ? mean(placements.map(p => format.pointsTable![p - 1] ?? 0))
        : null,
      avgGapToFirstMs: isMulti ? mean(gaps) : null,
      placementCounts,
      dnfRate: n ? entries.filter(e => e.status === "retired" || e.status === "dnf").length / n : null,
      incidentCounts: [...tagCounts].map(([tagId, count]) => ({ tagId, count })),
    };
  });

  const winningTimes = counted
    .map(r => {
      const times = r.entries
        .filter(e => e.status === "finished" && e.finishTimeMs !== null)
        .map(e => e.finishTimeMs as Millis);
      if (r.firstPlaceTimeMs !== undefined) times.push(r.firstPlaceTimeMs); // winner may be an unlogged CPU
      return times.length ? Math.min(...times) : null;
    })
    .filter((t): t is Millis => t !== null);

  // Detectable gap: use the median seat spread and the planned (or current) race count.
  const sds = seats.map(x => x.times?.stdDevMs).filter((v): v is number => v != null).sort((a, b) => a - b);
  const racesPerSet = set.plannedRaces ?? counted.length;
  const detectable = sds.length && racesPerSet >= 2 ? detectableDifferenceMs(median(sds), racesPerSet) : null;

  return {
    testSetId: set.id,
    racesDone: counted.length,
    plannedRaces: set.plannedRaces,
    progress: set.plannedRaces ? Math.min(1, counted.length / set.plannedRaces) : null,
    seats,
    winningTimeStdDevMs: sampleStdDev(winningTimes),
    detectableDifferenceMs: detectable,
  };
}

/** Run total IGT and completeness, derived from its races. */
export function runSummary(format: Format, races: Race[]) {
  const required = format.runStructure.kind === "course_set" ? format.runStructure.stageIds : [];
  const timed = races.map(r => r.entries[0]?.finishTimeMs ?? null);
  const done = new Set(races.map(r => r.stageId));
  return {
    totalMs: timed.every(t => t !== null) ? (timed as Millis[]).reduce((a, b) => a + b, 0) : null,
    coursesDone: done.size,
    coursesRequired: required.length,
    remainingStageIds: required.filter(id => !done.has(id)),
    hasGlitch: races.some(r => r.glitchOccurred),
  };
}

// =============================================================
// VALIDATION (Zod, at submit and import)
// =============================================================
// Mode isolation (checked on every write AND on import):
//  - format.mode is "air_ride" or "top_ride" (City Trial deferred)
//  - stage.mode === format.mode
//  - race.mode === format.mode; testSet.mode === format.mode
//  - a run's, trial's and experiment's races all share one format
//  - stats/leaderboard queries: query.mode === format.mode, and only
//    races with race.mode === query.mode are ever read
// Races:
//  - entries.length === format.trackedSeats
//  - every entry.racer.kind is in format.allowedRacerKinds (no CPUs)
// Runs (course_set formats):
//  - each stage at most once per run (eachStageOnce)
//  - every race's racer === run.racer (sameRacerThroughout);
//    machineId may differ per race when machineMayChange
//  - run "complete" only when all stageIds are covered and none glitched
//  - glitchOccurred on any race + forbidsGlitches → run "forfeit"
//  - forfeit run → every race in it is excluded from all stats
// Test sets:
//  - seats.length === format.trackedSeats; seat racer kinds in format.allowedRacerKinds
//  - every race matches the set's format and stage
//  - each race has exactly one entry per seat (testSetSeatId), and each
//    entry's racer/rider/machine equals its seat's
//  - plannedRaces null (open-ended) or ≥ 1; status "complete" when reached
//    (or when you end an open-ended trial)
//  - sets in one experiment share formatId
// Incident tags:
//  - a stage-specific tag can only be used on races on that stage
// - placement scoring: placements unique, within 1..settings.numberOfRiders
//   (gaps allowed, since unlogged CPUs can finish between logged racers)
// - finished times non-decreasing by placement
// - firstPlaceTimeMs ≤ every logged finish time
// - finishTimeMs null unless status "finished"
// - times are whole hundredths (ms divisible by 10), as the game shows them
// - lapTimesMs (if any) sum to finishTimeMs
// - amiibo: snapshot belongs to profile; entry.riderId === profile.riderId
// - profile nicknames unique among active profiles
// - one active profile per figure

// =============================================================
// SEED DATA
// =============================================================
/**
 * The Kirby figure races in four colors, each with its own special, so
 * each special is tracked as its own rider. Sword Kirby is a separate figure.
 */
export const SEED_RIDERS: Pick<Rider, "name" | "characterGroup" | "hasAmiibo" | "description" | "amiiboFigure">[] = [
  { name: "Kirby (Ultra Sword)", characterGroup: "Kirby", hasAmiibo: true, amiiboFigure: "Kirby", description: "Pink" },
  { name: "Sword Kirby",         characterGroup: "Sword Kirby", hasAmiibo: true, amiiboFigure: "Sword Kirby", description: "Separate figure; special not known yet" },
  { name: "Kirby (Crash)",       characterGroup: "Kirby", hasAmiibo: true, amiiboFigure: "Kirby", description: "Yellow or Green" },
  { name: "Kirby (Snow Bowl)",   characterGroup: "Kirby", hasAmiibo: true, amiiboFigure: "Kirby", description: "Blue or Gray" },
  { name: "Kirby (Burn)",        characterGroup: "Kirby", hasAmiibo: true, amiiboFigure: "Kirby", description: "Red or Purple" },
  { name: "King Dedede",        characterGroup: "King Dedede",        hasAmiibo: true  },
  { name: "Noir Dedede",        characterGroup: "Noir Dedede",        hasAmiibo: true  },
  { name: "Bandana Waddle Dee", characterGroup: "Bandana Waddle Dee", hasAmiibo: true  },
  { name: "Meta Knight",        characterGroup: "Meta Knight",        hasAmiibo: true  },
  { name: "Chef Kawasaki",      characterGroup: "Chef Kawasaki",      hasAmiibo: true  },
];

export const SEED_MACHINES: Pick<Machine, "name" | "isLegendary" | "hasAmiibo">[] = [
  { name: "Warp Star",   isLegendary: false, hasAmiibo: true },
  { name: "Winged Star", isLegendary: false, hasAmiibo: true },
  { name: "Shadow Star", isLegendary: false, hasAmiibo: true },
  { name: "Tank Star",   isLegendary: false, hasAmiibo: true },
  { name: "Hop Star",    isLegendary: false, hasAmiibo: true },
  { name: "Dragoon",     isLegendary: true,  hasAmiibo: true },
  { name: "Hydra",       isLegendary: true,  hasAmiibo: true },
];

/**
 * Template for the "Solo amiibo" category. Rider/machine ids and
 * stageIds are resolved at seed time (filler CPU = Kirby on Warp Star;
 * stageIds = every Air Ride course).
 */
export const SOLO_AMIIBO_FORMAT_TEMPLATE = {
  mode: "air_ride" as TrackedMode,
  name: "Solo amiibo — All Courses (IGT)",
  settings: {
    gameTempo: "normal",
    numberOfRiders: 2,
    ruleType: "laps",
    laps: "default",
    boostAssist: false,
    specialAssist: false,
    enemies: true,
    retirement: null,             // not specified → user discretion
  } satisfies InGameSettings,
  trackedSeats: 1 as const,
  allowedRacerKinds: ["amiibo"] as RacerKind[],
  fillerCpu: { riderName: "Kirby (Ultra Sword)", machineName: "Warp Star", cpuLevel: 1, handicap: 4, count: 1 },
  scoring: "time" as const,
  timing: "igt" as const,
  runStructure: {
    kind: "course_set" as const,
    stageIds: [] as ID[],         // filled with all Air Ride courses
    anyOrder: true,
    eachStageOnce: true,
    sameRacerThroughout: true,
    machineMayChange: true,
  },
  objective: "mean_time" as const,            // summed IGT → lowest average wins
  winnerIndexWeights: { ...DEFAULT_WINNER_INDEX_WEIGHTS },
  disasterThresholdPct: 5,
  forbidsGlitches: true,
  requiresVideo: true,
};

/**
 * The game's default rules, seeded for each mode: Normal tempo, 2–6
 * riders, Laps, default laps, retirement off, assists off, enemies on.
 * Up to 6 of your amiibo can be logged per race (CPUs fill the rest).
 */
export const DEFAULT_RULES_FORMAT_TEMPLATE = {
  name: "Default rules",
  settings: {
    gameTempo: "normal",
    numberOfRiders: null,         // 2–6 in-game; each race records its own count
    ruleType: "laps",
    laps: "default",
    boostAssist: false,
    specialAssist: false,
    enemies: true,
    retirement: false,
  } satisfies InGameSettings,
  trackedSeats: 6 as const,
  flexibleSeats: true,
  isDefaultRules: true,
  allowedRacerKinds: ["amiibo"] as RacerKind[],
  scoring: "placement" as const,
  timing: "igt" as const,
  runStructure: { kind: "single_race" as const },
  objective: "placement" as const,
  winnerIndexWeights: { ...DEFAULT_WINNER_INDEX_WEIGHTS },
  disasterThresholdPct: 5,
  forbidsGlitches: false,
  requiresVideo: false,
  description: "The game's default race rules. Number of riders can be anything from 2 to 6; each race records how many there were.",
};

/**
 * Top Ride's default rules: Normal tempo, 2–8 riders (4 by default),
 * default laps, items Normal, item restrictions Normal, features All,
 * anti-reverse On, boost assist Weak. Up to 8 amiibo logged per race.
 */
export const TOP_RIDE_DEFAULT_RULES_TEMPLATE = {
  name: "Default rules",
  settings: {
    gameTempo: "normal",
    numberOfRiders: null,         // 2–8 in-game (4 by default); each race records its own count
    ruleType: null,
    laps: "default",
    boostAssist: null,
    specialAssist: null,
    enemies: null,
    retirement: false,            // Top Ride has no retirement
    items: "normal",
    itemRestrictions: "normal",
    features: "all",
    antiReverse: true,
    boostAssistLevel: "weak",
  } satisfies InGameSettings,
  trackedSeats: 8 as const,
  flexibleSeats: true,
  isDefaultRules: true,
  allowedRacerKinds: ["amiibo"] as RacerKind[],
  scoring: "placement" as const,
  timing: "igt" as const,
  runStructure: { kind: "single_race" as const },
  objective: "placement" as const,
  winnerIndexWeights: { ...DEFAULT_WINNER_INDEX_WEIGHTS },
  disasterThresholdPct: 5,
  forbidsGlitches: false,
  requiresVideo: false,
  description: "The game's default Top Ride rules: Normal tempo, 2–8 riders (4 by default), default laps, items Normal, item restrictions Normal, features All, anti-reverse On, boost assist Weak. Each race records how many riders there were.",
};

/**
 * The Top Ride solo speedrun category, built like the Air Ride one:
 * one amiibo plus a required level 1 handicapped Kirby on Warp Star,
 * items off, features limited, anti-reverse on, boost assist off, every
 * stage once, times summed.
 */
export const TOP_RIDE_SOLO_FORMAT_TEMPLATE = {
  mode: "top_ride" as TrackedMode,
  name: "Solo amiibo — All Stages (IGT)",
  settings: {
    gameTempo: "normal",
    numberOfRiders: 2,
    ruleType: null,
    laps: "default",
    boostAssist: null,
    specialAssist: null,
    enemies: null,
    retirement: false,
    items: "off",
    itemRestrictions: "normal",   // the default; doesn't matter with items off
    features: "limited",
    antiReverse: true,
    boostAssistLevel: "off",
  } satisfies InGameSettings,
  trackedSeats: 1 as const,
  allowedRacerKinds: ["amiibo"] as RacerKind[],
  fillerCpu: { riderName: "Kirby (Ultra Sword)", machineName: "Warp Star", cpuLevel: 1, handicap: 4, count: 1 },
  scoring: "time" as const,
  timing: "igt" as const,
  objective: "mean_time" as const,
  winnerIndexWeights: { ...DEFAULT_WINNER_INDEX_WEIGHTS },
  disasterThresholdPct: 5,
  forbidsGlitches: true,
  requiresVideo: true,
};

/** The rule lines to show for a format, in the game's order for its mode. "Any" = not enforced. */
export function settingRows(format: Pick<Format, "mode" | "settings">): [string, string][] {
  const s = format.settings;
  const any = (v: unknown) => v === null || v === undefined;
  const onOff = (v: boolean | null | undefined) => (any(v) ? "Any" : v ? "On" : "Off");
  const word = (v: string | null | undefined) => (any(v) ? "Any" : (v as string)[0].toUpperCase() + (v as string).slice(1));
  const common: [string, string][] = [
    ["Game tempo", any(s.gameTempo) ? "Any" : s.gameTempo === "normal" ? "Normal" : "Slow"],
    ["No. of riders", s.numberOfRiders === null ? "Any" : String(s.numberOfRiders)],
  ];
  const laps: [string, string] = ["No. of laps", s.laps === null ? "Any" : s.laps === "default" ? "Default" : String(s.laps)];
  if (format.mode === "top_ride") {
    return [
      ...common, laps,
      ["Items", word(s.items)],
      ["Item restrictions", word(s.itemRestrictions)],
      ["Features", word(s.features)],
      ["Anti-reverse", onOff(s.antiReverse)],
      ["Boost assist", word(s.boostAssistLevel)],
    ];
  }
  return [
    ...common,
    ["Rules", s.ruleType === null ? "Any" : s.ruleType === "laps" ? "Laps" : "Time"],
    laps,
    ["Boost assist", onOff(s.boostAssist)],
    ["Special assist", onOff(s.specialAssist)],
    ["Enemies", onOff(s.enemies)],
    ["Retirement", onOff(s.retirement)],
  ];
}

export const SEED_SETTINGS: AppSettings = {
  id: "settings",
  defaultRacerPools: ["amiibo"],
  minSample: 5,
  recordFormatIds: {},          // set air_ride → the solo amiibo format at seed time
  gameVersion: INITIAL_GAME_VERSION,
};

export const SEED_STAGES: Pick<Stage, "mode" | "name" | "defaultLaps">[] = [
  // ---- Air Ride ----
  { mode: "air_ride", name: "Floria Fields",       defaultLaps: 3 },
  { mode: "air_ride", name: "Waterflow Waves",     defaultLaps: 2 },
  { mode: "air_ride", name: "Airtopia Ruins",      defaultLaps: 2 },
  { mode: "air_ride", name: "Crystalline Fissure", defaultLaps: 2 },
  { mode: "air_ride", name: "Steamgust Forge",     defaultLaps: 2 },
  { mode: "air_ride", name: "Cavernous Corners",   defaultLaps: 2 },
  { mode: "air_ride", name: "Cyberion Highway",    defaultLaps: 2 },
  { mode: "air_ride", name: "Mount Amberfalls",    defaultLaps: 1 },
  { mode: "air_ride", name: "Galactic Nova",       defaultLaps: 1 },
  { mode: "air_ride", name: "Fantasy Meadows",     defaultLaps: 3 },
  { mode: "air_ride", name: "Celestial Valley",    defaultLaps: 2 },
  { mode: "air_ride", name: "Sky Sands",           defaultLaps: 2 },
  { mode: "air_ride", name: "Frozen Hillside",     defaultLaps: 2 },
  { mode: "air_ride", name: "Magma Flows",         defaultLaps: 2 },
  { mode: "air_ride", name: "Beanstalk Park",      defaultLaps: 2 },
  { mode: "air_ride", name: "Machine Passage",     defaultLaps: 2 },
  { mode: "air_ride", name: "Checker Knights",     defaultLaps: 2 },
  { mode: "air_ride", name: "Nebula Belt",         defaultLaps: 2 },
  // ---- Top Ride ----
  { mode: "top_ride", name: "Flower",   defaultLaps: 4 },
  { mode: "top_ride", name: "Flow",     defaultLaps: 4 },
  { mode: "top_ride", name: "Air",      defaultLaps: 4 },
  { mode: "top_ride", name: "Crystal",  defaultLaps: 4 },
  { mode: "top_ride", name: "Steam",    defaultLaps: 4 },
  { mode: "top_ride", name: "Cave",     defaultLaps: 4 },
  { mode: "top_ride", name: "Cyber",    defaultLaps: 4 },
  { mode: "top_ride", name: "Mountain", defaultLaps: 2 },
  { mode: "top_ride", name: "Nova",     defaultLaps: 2 },
];

/** Starter incident tags usable on any stage; add stage-specific ones as you spot them. */
export const SEED_INCIDENT_TAGS: Pick<IncidentTag, "name" | "kind">[] = [
  { name: "Enemy in the way",       kind: "enemy" },
  { name: "Hit by enemy",           kind: "enemy" },
  { name: "Fell off / pitfall",     kind: "pitfall" },
  { name: "Hit by stage hazard",    kind: "hazard" },
  { name: "Collision with racer",   kind: "collision" },
  { name: "amiibo bad line / wall", kind: "ai_mistake" },
];

/**
 * How the required CPU reads in the app, e.g. "Level 1 Kirby Pink on
 * Warp Star, handicap 4". A CPU Kirby is named by its color, since the
 * player picks a color, not a special, when setting it up.
 */
export function cpuSetupText(cpu: FillerCpuSpec, rider: Rider | undefined, machine: Machine | undefined): string {
  const name = !rider ? "?"
    : rider.amiiboFigure === "Kirby" && rider.characterGroup === "Kirby" && rider.description ? `Kirby ${rider.description}`
    : rider.name;
  return `Level ${cpu.cpuLevel} ${name} on ${machine?.name ?? "?"}, handicap ${cpu.handicap}`;
}

/**
 * Whether racers can retire under this format. Not with retirement
 * switched off, and not in full-run record formats (a solo run either
 * finishes the course or is forfeited).
 */
export function allowsRetirement(format: Format): boolean {
  return format.settings.retirement !== false && format.runStructure.kind !== "course_set";
}
