// =============================================================
// City Trial — reference lists, record types and stats.
//
// City Trial is its own world: nothing here is ever pooled with Air
// Ride or Top Ride. Two record books are kept apart, like the game's
// own Personal best screen:
//   - Trial:   stadium results set at the end of a City Trial match
//              (after 5 minutes of collecting stats)
//   - Stadium: stadiums played straight from the Stadium menu
//              (solo or with others, standard-power machines)
//
// Reference lists (stadiums, machines, field events, field changes)
// are fixed by the game, so they live here as constants with stable
// ids rather than in the database.
// =============================================================

import type { BaseRecord, ID, ISODate, Millis } from "./schema";

// -------------------------------------------------------------
// Stadiums (50)
// -------------------------------------------------------------

export type CtScoreKind = "time" | "points" | "distance";

export interface StadiumScore {
  kind: CtScoreKind;
  label: string;             // "Time", "Points", "Damage", "Distance"
  better: "low" | "high";
}

export interface Stadium {
  id: string;                // stable slug, stored on records
  name: string;              // "Drag Race 2", "Race: Floria Fields"
  /** The in-game stadium type, e.g. "Drag Race", "VS. Boss", "Single Race". */
  type: string;
  /** What gets recorded. The first is the headline record. */
  scores: StadiumScore[];
  /** Riders the stadium holds: 8, or 16 for VS. Gigantes. */
  maxPlayers: number;
  /** The score the game picks the winner by (bosses: damage dealt, even though time is the headline record). */
  decidedBy: StadiumScore;
}

const TIME: StadiumScore = { kind: "time", label: "Time", better: "low" };
const POINTS: StadiumScore = { kind: "points", label: "Points", better: "high" };
const DAMAGE: StadiumScore = { kind: "points", label: "Damage", better: "high" };
const DISTANCE: StadiumScore = { kind: "distance", label: "Distance", better: "high" };
const HEIGHT: StadiumScore = { kind: "distance", label: "Height", better: "high" };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const st = (name: string, type: string, scores: StadiumScore[], maxPlayers = 8, decidedBy = scores[0]): Stadium => ({ id: slug(name), name, type, scores, maxPlayers, decidedBy });
const numbered = (type: string, count: number, scores: StadiumScore[]) =>
  Array.from({ length: count }, (_, i) => st(`${type} ${i + 1}`, type, scores));

/** Single Race courses (every Air Ride course except Galactic Nova). */
export const RACE_STADIUM_COURSES = [
  "Floria Fields", "Waterflow Waves", "Airtopia Ruins", "Crystalline Fissure", "Steamgust Forge",
  "Cavernous Corners", "Cyberion Highway", "Mount Amberfalls", "Fantasy Meadows", "Celestial Valley",
  "Sky Sands", "Frozen Hillside", "Magma Flows", "Beanstalk Park", "Machine Passage", "Checker Knights", "Nebula Belt",
];

export const STADIUMS: Stadium[] = [
  ...numbered("Kirby Melee", 2, [POINTS]),
  ...numbered("Dustup Derby", 5, [POINTS]),
  ...numbered("Big Battle", 3, [POINTS]),
  ...numbered("Drag Race", 4, [TIME]),
  st("Oval Circuit", "Oval Circuit", [TIME]),
  st("Rail Panic", "Rail Panic", [TIME]),
  ...numbered("Beam Gauntlet", 2, [TIME]),
  st("Air Glider", "Air Glider", [DISTANCE]),
  st("High Jump", "High Jump", [HEIGHT]),
  ...numbered("Target Flight", 3, [POINTS]),
  st("Gourmet Race", "Gourmet Race", [POINTS]),
  ...numbered("Skydive", 2, [POINTS]),
  ...numbered("Button Rush", 2, [POINTS]),
  // Bosses: the game picks the winner by damage dealt; time to clear is often the more useful record.
  st("VS. King Dedede", "VS. Boss", [TIME, DAMAGE], 8, DAMAGE),
  st("VS. Nightmare", "VS. Boss", [TIME, DAMAGE], 8, DAMAGE),
  st("VS. Zero Two", "VS. Boss", [TIME, DAMAGE], 8, DAMAGE),
  st("VS. Marx", "VS. Boss", [TIME, DAMAGE], 8, DAMAGE),
  // Gigantes: 15 vs 1, all 16 riders in one stadium. The game records damage dealt.
  st("VS. Gigantes", "VS. Gigantes", [DAMAGE, TIME], 16),
  ...RACE_STADIUM_COURSES.map(c => st(`Race: ${c}`, "Single Race", [TIME])),
];

export const STADIUM_BY_ID = new Map(STADIUMS.map(s => [s.id, s]));

/** Stadium types in game order. */
export const STADIUM_TYPES: string[] = [...new Set(STADIUMS.map(s => s.type))];

export const GIGANTES_ID = "vs-gigantes";

export function stadiumName(id: string | null | undefined): string {
  return (id && STADIUM_BY_ID.get(id)?.name) || "No stadium";
}

// -------------------------------------------------------------
// Machines (all 28 in the game; Air Ride tracking uses its own 7)
// -------------------------------------------------------------

export interface CtMachine { id: string; name: string; isLegendary: boolean }

const REGULAR_MACHINES = [
  "Warp Star", "Compact Star", "Winged Star", "Shadow Star", "Wagon Star", "Slick Star", "Formula Star", "Bulk Star",
  "Rocket Star", "Swerve Star", "Turbo Star", "Jet Star", "Wheelie Bike", "Rex Wheelie", "Wheelie Scooter", "Hop Star",
  "Vampire Star", "Paper Star", "Chariot", "Battle Chariot", "Tank Star", "Bull Tank", "Transform Star", "Flight Warp Star",
];
const LEGENDARY_MACHINES = ["Dragoon", "Hydra", "Leo", "Gigantes"];

export const CT_MACHINES: CtMachine[] = [
  ...REGULAR_MACHINES.map(name => ({ id: slug(name), name, isLegendary: false })),
  ...LEGENDARY_MACHINES.map(name => ({ id: slug(name), name, isLegendary: true })),
];
export const CT_MACHINE_BY_ID = new Map(CT_MACHINES.map(m => [m.id, m]));

/**
 * The machines that have amiibo figures (the ones raced in Air Ride and
 * Top Ride). Only these can be scanned with an amiibo, so only these
 * carry machine proficiency.
 */
export const SCANNABLE_MACHINE_IDS = ["warp-star", "winged-star", "shadow-star", "tank-star", "hop-star", "dragoon", "hydra"];
export const SCANNABLE_MACHINES: CtMachine[] = SCANNABLE_MACHINE_IDS.map(id => CT_MACHINE_BY_ID.get(id) as CtMachine);

/** Proficiency on one machine: 0–100, missing = 100 (maxed). */
export function proficiencyOf(map: Record<string, number> | undefined, machineId: string): number {
  return map?.[machineId] ?? 100;
}

/** Scannable machines below 100 proficiency, for a short summary line. */
export function belowMax(map: Record<string, number> | undefined): CtMachine[] {
  return SCANNABLE_MACHINES.filter(m => proficiencyOf(map, m.id) < 100);
}

// -------------------------------------------------------------
// Stats collected during the trial
// -------------------------------------------------------------

export const STAT_KEYS = ["boost", "topSpeed", "offense", "defense", "turn", "glide", "charge", "weight", "hp"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export const STAT_LABELS: Record<StatKey, string> = {
  boost: "Boost", topSpeed: "Top Speed", offense: "Offense", defense: "Defense", turn: "Turn",
  glide: "Glide", charge: "Charge", weight: "Weight", hp: "HP",
};
/** The end screen shows each stat from a little below zero (power-downs) up to 19. */
export const STAT_MIN = -20;
export const STAT_MAX = 19;

// -------------------------------------------------------------
// Field events (40) and field changes
// -------------------------------------------------------------

export interface FieldEvent { id: string; name: string; hasPlacements?: boolean }

const ev = (name: string, hasPlacements = false): FieldEvent => ({ id: slug(name), name, hasPlacements: hasPlacements || undefined });

export const FIELD_EVENTS: FieldEvent[] = [
  ev("Air Ride Machine Formation"), ev("Battleship Halberd"), ev("Broken Machine"), ev("Cracked Boxes All Over"),
  ev("Danger! Meteors Incoming!"), ev("Dash Zones"), ev("Dense Fog"), ev("Dustup Derby", true),
  ev("Endless Quick Spins"), ev("Energy Tanks Running Amok"), ev("Fake Rare Boxes"), ev("Flipped Controls"),
  ev("Flying Machines"), ev("Giant Items"), ev("Gordos"), ev("Grand Wheelie"), ev("Heavy Machines"), ev("Huge Pillars"),
  ev("Item Rails"), ev("Kracko"), ev("Massive, Mysterious Flying Machine"), ev("The Mysterious Bird Dyna Blade"),
  ev("No Fair! Same Item!"), ev("Reward Rings"), ev("Parking Lot"), ev("Portals"), ev("Raining Boxes"), ev("Rare Boxes"),
  ev("Secret Rooms"), ev("Short Race", true), ev("Slippery Ground"), ev("Stadium Prediction"), ev("Tacs"), ev("Tiny Boxes"),
  ev("Tiny Riders"), ev("Treasure Chests"), ev("Treasure Stars"), ev("UFO Ability"), ev("Vacant Machines"),
  ev("Wild Legendary Machine"),
];
export const FIELD_EVENT_BY_ID = new Map(FIELD_EVENTS.map(e => [`event-${e.id}`, e]));
/** Field-event ids are stored with an "event-" prefix so they never clash with stadium ids. */
export const fieldEventKey = (e: FieldEvent) => `event-${e.id}`;

export interface FieldChange { id: string; name: string; gameplay: boolean; island?: boolean }
export interface FieldChangeArea { area: string; changes: FieldChange[] }

const fc = (area: string, name: string, gameplay: boolean, island = false): FieldChange =>
  ({ id: `${slug(area)}-${slug(name)}`, name, gameplay, island: island || undefined });

export const FIELD_CHANGE_AREAS: FieldChangeArea[] = [
  { area: "Flower field", changes: [
    fc("Flower field", "All bourbons", false), fc("Flower field", "Plugged cave hole", true), fc("Flower field", "Windmill spectator", false),
  ] },
  { area: "Caves", changes: [
    fc("Caves", "Airtopia Ruins statues", false), fc("Caves", "Split caves", true), fc("Caves", "Boulder-plugged ceiling", true),
  ] },
  { area: "City", changes: [
    fc("City", "Mall under construction", false), fc("City", "Parking lot graffiti", false), fc("City", "Extra mall entryway", true),
    fc("City", "Star Pole", true), fc("City", "Really big tower", true), fc("City", "Connecting bridge", true),
    fc("City", "Construction sheets", false),
  ] },
  { area: "Remains", changes: [
    fc("Remains", "No colosseum", true), fc("Remains", "Flowers on colosseum", false), fc("Remains", "Green colosseum floor", false),
    fc("Remains", "Colosseum onlookers", false), fc("Remains", "Ground drawings", false),
  ] },
  { area: "Pier", changes: [
    fc("Pier", "Autumn forest", false), fc("Pier", "Tall trees", false), fc("Pier", "Fruit trees", false),
    fc("Pier", "Portal near the ship", true), fc("Pier", "Golden ship", false), fc("Pier", "Pink sea", false), fc("Pier", "Coral beach", false),
  ] },
  { area: "Mountain", changes: [
    fc("Mountain", "Spring instead of waterfall", true), fc("Mountain", "Open floor hole", true), fc("Mountain", "Extra platforms", true),
    fc("Mountain", "Volcano golem", false), fc("Mountain", "Recolored dimension", false),
  ] },
  { area: "Sky (floating islands, up to 2)", changes: [
    fc("Sky", "All-Up Patch island", true, true), fc("Sky", "Tree island", true, true), fc("Sky", "Water spout island", true, true),
    fc("Sky", "Legendary star island", true, true), fc("Sky", "Cyber-style island", true, true),
  ] },
];
export const FIELD_CHANGES: FieldChange[] = FIELD_CHANGE_AREAS.flatMap(a => a.changes);
export const FIELD_CHANGE_BY_ID = new Map(FIELD_CHANGES.map(c => [c.id, c]));
export const MAX_FLOATING_ISLANDS = 2;

// -------------------------------------------------------------
// Records
// -------------------------------------------------------------

/**
 * City Trial rules. Fixed once matches are logged, so a format's
 * results never mix rule sets. The number of riders is recorded per
 * match, not fixed by the format.
 */
export interface CtFormat extends BaseRecord {
  name: string;
  gameTempo: "normal" | "slow";
  minutes: number;               // 3–7, 5 by default
  stadiumVote: boolean;          // off = everyone goes to one random ("blind") stadium
  legendaries: boolean;
  fieldEvents: boolean;
  fieldChange: boolean;
  /** Stadiums switched off under Active Stadiums. Empty = all on. */
  bannedStadiumIds: string[];
  /** Points by place (index 0 = 1st). Absent = no points. */
  pointsTable?: number[];
  /** Tournament sets: N rounds between the same riders, top K advance. */
  set?: {
    rounds: number;
    advance: number;
    /** After a stadium is played, its whole type is off for the rest of the set. */
    banPlayedType: boolean;
    /** A tied set is settled by a shorter extra match. */
    tiebreakerMinutes?: number;
  };
  isDefaultRules?: boolean;
  description?: string;
  isArchived: boolean;
}

export interface CtSession extends BaseRecord {
  formatId: ID;
  name: string;
  date: ISODate;
  notes?: string;
  status?: "in_progress" | "complete";
}

/** Scores in a stadium's own units. Only the ones that stadium uses are set. */
export interface CtScores {
  timeMs?: Millis;
  points?: number;
  /** Yards, kept to 2 decimals (1,834.67). */
  distance?: number;
}

export interface CtEntry {
  id: ID;
  profileId: ID;
  snapshotId: ID;
  riderId: ID;
  /** Place in its stadium, 1 = won. Ties share a place (1st, 1st, 3rd). */
  place: number | null;
  /** Total of all stats at the end of the trial. */
  statTotal?: number;
  /** Each stat, when logged in full (adds up to statTotal). */
  stats?: Partial<Record<StatKey, number>>;
  /** The machine it ended the trial on (a CT_MACHINES id). */
  machineId?: string;
  /** The machine figure it was scanned in with (a SCANNABLE_MACHINE_IDS id). */
  scannedMachineId?: string;
  kos?: number;
  scores?: CtScores;
  /** VS. Gigantes: this rider drove Gigantes. */
  isGigantes?: boolean;
  /** 2 = in the second stadium when a big match split into two. */
  room?: 2;
  /** Places in field events that have them (Dustup Derby, Short Race), by event key. */
  eventPlaces?: Record<string, number>;
  notes?: string;
}

export interface CtMatch extends BaseRecord {
  formatId: ID;
  sessionId?: ID;
  playedAt: ISODate;
  stadiumId: string | null;
  /** Riders in the trial, others included (2–16). */
  riderCount: number;
  /** When the match split into two stadiums: the second one and how many rode in it. */
  room2?: { stadiumId: string | null; riders: number };
  entries: CtEntry[];
  fieldEvents?: string[];
  fieldChanges?: string[];
  /** A set's tiebreaker: decides the order, adds no points. */
  isTiebreaker?: boolean;
  includeInStats: boolean;
  gameVersion?: string;
  notes?: string;
}

export interface StadiumRunEntry {
  id: ID;
  profileId: ID;
  snapshotId: ID;
  riderId: ID;
  machineId?: string;
  /** The machine figure it was scanned in with (a SCANNABLE_MACHINE_IDS id). */
  scannedMachineId?: string;
  place?: number;
  scores: CtScores;
  notes?: string;
}

/** A stadium played straight from the Stadium menu (solo or with others). */
export interface StadiumRun extends BaseRecord {
  stadiumId: string;
  playedAt: ISODate;
  /** Riders in the stadium, others included. 1 = solo. */
  players: number;
  entries: StadiumRunEntry[];
  includeInStats: boolean;
  gameVersion?: string;
  notes?: string;
}

// -------------------------------------------------------------
// Formatting
// -------------------------------------------------------------

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

export function formatYards(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function parseYards(text: string): number | null {
  const t = text.replace(/,/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;
}

/** An entry's stat total: the typed total, or the sum when every stat is logged. */
export function entryStatTotal(e: CtEntry): number | null {
  if (typeof e.statTotal === "number") return e.statTotal;
  if (e.stats && STAT_KEYS.every(k => typeof e.stats?.[k] === "number")) {
    return STAT_KEYS.reduce((s, k) => s + (e.stats?.[k] ?? 0), 0);
  }
  return null;
}

/** Which stadium an entry competed in. */
export function entryStadium(m: CtMatch, e: CtEntry): string | null {
  return e.room === 2 ? m.room2?.stadiumId ?? null : m.stadiumId;
}

/** How many riders were in an entry's stadium (others included). */
export function roomSize(m: CtMatch, e: CtEntry): number {
  if (!m.room2) return m.riderCount;
  return e.room === 2 ? m.room2.riders : Math.max(1, m.riderCount - m.room2.riders);
}

// -------------------------------------------------------------
// Stats
// -------------------------------------------------------------

/**
 * Share of the other riders in its stadium an entry finished ahead of,
 * 0–1. Ties count as half a win each (1st, 1st, 3rd: the two 1sts are
 * level with each other), so the measure is fair whatever the field size.
 */
export function beatShare(m: CtMatch, e: CtEntry): number | null {
  if (e.place === null) return null;
  const size = roomSize(m, e);
  if (size < 2) return null;
  const tiedWith = m.entries.filter(o => o.id !== e.id && (o.room ?? 1) === (e.room ?? 1) && o.place === e.place).length;
  const midRank = e.place + tiedWith / 2;
  return Math.max(0, Math.min(1, (size - midRank) / (size - 1)));
}

export function pointsFor(format: CtFormat | undefined, place: number | null): number | null {
  if (!format?.pointsTable || place === null) return null;
  return format.pointsTable[place - 1] ?? 0;
}

interface Spread { n: number; mean: number; sd: number | null; half: number | null; best: number; worst: number }

/** Mean, spread and a 95% range for the mean (normal approximation, t for small n). */
export function spreadOf(values: number[]): Spread | null {
  const n = values.length;
  if (!n) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : null;
  const t = n <= 2 ? 12.7 : n <= 3 ? 4.3 : n <= 5 ? 2.78 : n <= 10 ? 2.26 : n <= 20 ? 2.09 : n <= 40 ? 2.02 : 1.96;
  return { n, mean, sd, half: sd === null ? null : (t * sd) / Math.sqrt(n), best: Math.max(...values), worst: Math.min(...values) };
}

export interface CtAmiiboRow {
  profileId: ID;
  matches: number;
  placed: number;           // matches with a place logged
  wins: number;
  avgPlace: number | null;
  beat: Spread | null;      // share of others beaten, 0–1
  stats: Spread | null;     // stat totals
  kos: Spread | null;
  points: Spread | null;    // under the format's points table
  machines: [string, number][]; // most used final machines
  byType: Map<string, { n: number; beat: number }>;
}

/** Per-amiibo City Trial summary over a set of matches. */
export function ctAmiiboRows(matches: CtMatch[], format: CtFormat | undefined): CtAmiiboRow[] {
  interface Acc {
    matches: number; places: number[]; beats: number[]; stats: number[]; kos: number[]; points: number[];
    machines: Map<string, number>; types: Map<string, number[]>;
  }
  const acc = new Map<ID, Acc>();
  const fresh = (): Acc => ({ matches: 0, places: [], beats: [], stats: [], kos: [], points: [], machines: new Map(), types: new Map() });
  for (const m of matches) {
    for (const e of m.entries) {
      const a = acc.get(e.profileId) ?? fresh();
      a.matches++;
      if (e.place !== null) a.places.push(e.place);
      const b = beatShare(m, e);
      if (b !== null) {
        a.beats.push(b);
        const type = STADIUM_BY_ID.get(entryStadium(m, e) ?? "")?.type;
        if (type) a.types.set(type, [...(a.types.get(type) ?? []), b]);
      }
      const total = entryStatTotal(e);
      if (total !== null) a.stats.push(total);
      if (typeof e.kos === "number") a.kos.push(e.kos);
      if (!m.isTiebreaker) {
        const p = pointsFor(format, e.place);
        if (p !== null) a.points.push(p);
      }
      if (e.machineId) a.machines.set(e.machineId, (a.machines.get(e.machineId) ?? 0) + 1);
      acc.set(e.profileId, a);
    }
  }
  return [...acc.entries()].map(([profileId, a]) => ({
    profileId,
    matches: a.matches,
    placed: a.places.length,
    wins: a.places.filter(p => p === 1).length,
    avgPlace: a.places.length ? a.places.reduce((x, y) => x + y, 0) / a.places.length : null,
    beat: spreadOf(a.beats),
    stats: spreadOf(a.stats),
    kos: spreadOf(a.kos),
    points: spreadOf(a.points),
    machines: [...a.machines.entries()].sort((x, y) => y[1] - x[1]),
    byType: new Map([...a.types.entries()].map(([t, v]) => [t, { n: v.length, beat: v.reduce((x, y) => x + y, 0) / v.length }])),
  }));
}

// -------------------------------------------------------------
// Rankings: Finish score (share of the field beaten), with likely ranges
// -------------------------------------------------------------

export interface CtRankRow {
  profileId: ID;
  matches: number;              // matches with a place
  entered: number;              // matches logged in, placed or not
  finish: number;               // Finish score, 0–1
  finishLow: number;            // likely range (middle 80% of reshuffled histories)
  finishHigh: number;
  rank: number;
  rankLow: number;              // rank bracket
  rankHigh: number;
  winRate: number;
  top3Rate: number;
  bottomHalfRate: number;
  stats: number | null;         // average stat total
  confidence: "solid" | "could_move" | "few";
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when the entry finished in the bottom half of its stadium (e.g. 3rd or 4th of 4). */
function bottomHalf(m: CtMatch, e: CtEntry): boolean {
  return e.place !== null && e.place > roomSize(m, e) / 2;
}

/**
 * Rank amiibo by Finish score. Uncertainty comes from re-running the
 * ranking on a few hundred reshuffled versions of the same matches
 * (whole matches are redrawn, so everyone in a match moves together).
 */
export function ctRankings(matches: CtMatch[], keep: (profileId: ID) => boolean, minSample: number, iterations = 400): CtRankRow[] {
  const per = new Map<ID, { beats: number[]; wins: number; top3: number; bottom: number; stats: number[] }>();
  const entered = new Map<ID, number>();
  for (const m of matches) for (const e of m.entries) {
    if (!keep(e.profileId)) continue;
    entered.set(e.profileId, (entered.get(e.profileId) ?? 0) + 1);
    const b = beatShare(m, e);
    if (b === null || e.place === null) continue;
    const a = per.get(e.profileId) ?? { beats: [], wins: 0, top3: 0, bottom: 0, stats: [] };
    a.beats.push(b);
    if (e.place === 1) a.wins++;
    if (e.place <= 3) a.top3++;
    if (bottomHalf(m, e)) a.bottom++;
    const t = entryStatTotal(e);
    if (t !== null) a.stats.push(t);
    per.set(e.profileId, a);
  }
  const ids = [...per.keys()];
  if (!ids.length) return [];
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length;
  const point = new Map(ids.map(id => [id, mean(per.get(id)!.beats)]));
  const order = [...ids].sort((a, b) => point.get(b)! - point.get(a)!);

  // Reshuffle whole matches.
  const usable = matches.filter(m => m.entries.some(e => keep(e.profileId) && beatShare(m, e) !== null));
  const rand = mulberry(usable.length * 7919 + ids.length);
  const ranks = new Map<ID, number[]>(ids.map(id => [id, []]));
  const scores = new Map<ID, number[]>(ids.map(id => [id, []]));
  for (let it = 0; it < iterations && usable.length > 1; it++) {
    const sum = new Map<ID, number>(), n = new Map<ID, number>();
    for (let k = 0; k < usable.length; k++) {
      const m = usable[Math.floor(rand() * usable.length)];
      for (const e of m.entries) {
        if (!keep(e.profileId)) continue;
        const b = beatShare(m, e);
        if (b === null) continue;
        sum.set(e.profileId, (sum.get(e.profileId) ?? 0) + b);
        n.set(e.profileId, (n.get(e.profileId) ?? 0) + 1);
      }
    }
    const present = ids.filter(id => n.get(id));
    const avg = new Map(present.map(id => [id, sum.get(id)! / n.get(id)!]));
    present.sort((a, b) => avg.get(b)! - avg.get(a)!);
    present.forEach((id, i) => { ranks.get(id)!.push(i + 1); scores.get(id)!.push(avg.get(id)!); });
  }
  const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };

  return order.map((id, i) => {
    const a = per.get(id)!;
    const r = ranks.get(id)!, sc = scores.get(id)!;
    const rankLow = r.length ? pct(r, 0.1) : i + 1, rankHigh = r.length ? pct(r, 0.9) : i + 1;
    const few = a.beats.length < minSample;
    return {
      profileId: id,
      matches: a.beats.length,
      entered: entered.get(id) ?? a.beats.length,
      finish: point.get(id)!,
      finishLow: sc.length ? pct(sc, 0.1) : point.get(id)!,
      finishHigh: sc.length ? pct(sc, 0.9) : point.get(id)!,
      rank: i + 1,
      rankLow: Math.min(rankLow, i + 1),
      rankHigh: Math.max(rankHigh, i + 1),
      winRate: a.wins / a.beats.length,
      top3Rate: a.top3 / a.beats.length,
      bottomHalfRate: a.bottom / a.beats.length,
      stats: a.stats.length ? mean(a.stats) : null,
      confidence: few ? "few" : rankLow === rankHigh ? "solid" : "could_move",
    };
  });
}

// -------------------------------------------------------------
// Findings: do stats win matches?
// -------------------------------------------------------------

export interface CollectorFindings {
  /** Matches (stadium rooms) where 2+ logged amiibo have stat totals and one collected the most. */
  decided: number;
  topWon: number;               // the top collector won
  topTop3: number;              // …finished top 3
  topBottom: number;            // …finished in the bottom half
  lowWon: number;               // the lowest collector won anyway
  topLast: number;              // the top collector finished last
  perAmiibo: Map<ID, { topCollector: number; converted: number }>;
  /** Latest examples, for the findings text. */
  upsetExample?: { match: CtMatch; winner: ID; topCollector: ID };
}

export function collectorFindings(matches: CtMatch[], keep: (profileId: ID) => boolean): CollectorFindings {
  const out: CollectorFindings = { decided: 0, topWon: 0, topTop3: 0, topBottom: 0, lowWon: 0, topLast: 0, perAmiibo: new Map() };
  for (const m of matches) {
    for (const room of [1, 2]) {
      const es = m.entries.filter(e => (e.room ?? 1) === room && keep(e.profileId) && e.place !== null && entryStatTotal(e) !== null);
      if (es.length < 2) continue;
      const totals = es.map(e => entryStatTotal(e) as number);
      const max = Math.max(...totals), min = Math.min(...totals);
      const tops = es.filter(e => entryStatTotal(e) === max);
      const lows = es.filter(e => entryStatTotal(e) === min);
      if (tops.length !== 1 || max === min) continue; // a shared top collector decides nothing
      const top = tops[0];
      const size = roomSize(m, top);
      out.decided++;
      const p = out.perAmiibo.get(top.profileId) ?? { topCollector: 0, converted: 0 };
      p.topCollector++;
      if (top.place === 1) { out.topWon++; p.converted++; }
      out.perAmiibo.set(top.profileId, p);
      if (Number(top.place) <= 3) out.topTop3++;
      if (bottomHalf(m, top)) out.topBottom++;
      if (top.place === size) out.topLast++;
      const winner = es.find(e => e.place === 1);
      if (lows.length === 1 && winner && lows[0].id === winner.id) out.lowWon++;
      if (winner && winner.id !== top.id && !out.upsetExample) out.upsetExample = { match: m, winner: winner.profileId, topCollector: top.profileId };
    }
  }
  return out;
}

/** Each amiibo's best and worst stadium type by Finish score (types with 2+ matches). */
export function typeExtremes(matches: CtMatch[], keep: (profileId: ID) => boolean): Map<ID, { best?: { type: string; finish: number; n: number }; worst?: { type: string; finish: number; n: number } }> {
  const acc = new Map<ID, Map<string, number[]>>();
  for (const m of matches) for (const e of m.entries) {
    if (!keep(e.profileId)) continue;
    const b = beatShare(m, e);
    const type = STADIUM_BY_ID.get(entryStadium(m, e) ?? "")?.type;
    if (b === null || !type) continue;
    const t = acc.get(e.profileId) ?? new Map<string, number[]>();
    t.set(type, [...(t.get(type) ?? []), b]);
    acc.set(e.profileId, t);
  }
  const out = new Map<ID, { best?: { type: string; finish: number; n: number }; worst?: { type: string; finish: number; n: number } }>();
  for (const [id, t] of acc) {
    const rows = [...t.entries()].filter(([, v]) => v.length >= 2).map(([type, v]) => ({ type, finish: v.reduce((x, y) => x + y, 0) / v.length, n: v.length }))
      .sort((a, b) => b.finish - a.finish);
    if (rows.length >= 2) out.set(id, { best: rows[0], worst: rows[rows.length - 1] });
  }
  return out;
}

/** Head to head: how often each amiibo placed ahead of each other one in the same stadium. */
export function ctHeadToHead(matches: CtMatch[]): Map<string, { ahead: number; behind: number; level: number }> {
  const out = new Map<string, { ahead: number; behind: number; level: number }>();
  for (const m of matches) {
    const placed = m.entries.filter(e => e.place !== null);
    for (const a of placed) for (const b of placed) {
      if (a.id === b.id || a.profileId === b.profileId || (a.room ?? 1) !== (b.room ?? 1)) continue;
      const key = `${a.profileId}|${b.profileId}`;
      const r = out.get(key) ?? { ahead: 0, behind: 0, level: 0 };
      if (Number(a.place) < Number(b.place)) r.ahead++;
      else if (Number(a.place) > Number(b.place)) r.behind++;
      else r.level++;
      out.set(key, r);
    }
  }
  return out;
}

// -------------------------------------------------------------
// Records books
// -------------------------------------------------------------

export interface CtRecord {
  stadiumId: string;
  score: StadiumScore;
  value: number;
  profileId: ID;
  machineId?: string;
  at: ISODate;
  /** For stadium-menu records: the rider count they were set with. */
  players?: number;
}

export function scoreValue(s: CtScores | undefined, kind: CtScoreKind): number | null {
  if (!s) return null;
  const v = kind === "time" ? s.timeMs : kind === "points" ? s.points : s.distance;
  return typeof v === "number" ? v : null;
}

const isBetter = (score: StadiumScore, a: number, b: number) => (score.better === "low" ? a < b : a > b);

/** Best result per stadium and score, from the end of City Trial matches. */
export function trialRecords(matches: CtMatch[]): CtRecord[] {
  const best = new Map<string, CtRecord>();
  for (const m of matches) for (const e of m.entries) {
    const sid = entryStadium(m, e);
    const stadium = sid ? STADIUM_BY_ID.get(sid) : undefined;
    if (!stadium) continue;
    for (const score of stadium.scores) {
      const v = scoreValue(e.scores, score.kind);
      if (v === null) continue;
      const key = `${stadium.id}|${score.label}`;
      const cur = best.get(key);
      if (!cur || isBetter(score, v, cur.value)) best.set(key, { stadiumId: stadium.id, score, value: v, profileId: e.profileId, machineId: e.machineId, at: m.playedAt });
    }
  }
  return [...best.values()];
}

/** Best result per stadium, score and rider count, from Stadium-menu runs. */
export function stadiumRecords(runs: StadiumRun[]): CtRecord[] {
  const best = new Map<string, CtRecord>();
  for (const r of runs) {
    const stadium = STADIUM_BY_ID.get(r.stadiumId);
    if (!stadium) continue;
    for (const e of r.entries) for (const score of stadium.scores) {
      const v = scoreValue(e.scores, score.kind);
      if (v === null) continue;
      const key = `${stadium.id}|${score.label}|${r.players}`;
      const cur = best.get(key);
      if (!cur || isBetter(score, v, cur.value)) best.set(key, { stadiumId: stadium.id, score, value: v, profileId: e.profileId, machineId: e.machineId, at: r.playedAt, players: r.players });
    }
  }
  return [...best.values()];
}

// -------------------------------------------------------------
// Tournament sets
// -------------------------------------------------------------

export interface SetStanding {
  profileId: ID;
  points: number;
  rounds: number;
  /** Place in the tiebreaker, when one was played. */
  tiebreakPlace: number | null;
  advances: boolean;
}

export interface SetState {
  standings: SetStanding[];
  roundsPlayed: number;
  /** Stadium types played this set (and so off for the rest of it). */
  playedTypes: string[];
  /** True when the set is over but places tied around the advance line. */
  needsTiebreaker: boolean;
}

/** Points, bans and who advances for one set (a session in a format with sets). */
export function setState(format: CtFormat, matches: CtMatch[]): SetState | null {
  if (!format.set || !format.pointsTable) return null;
  const ordered = [...matches].sort((a, b) => a.playedAt.localeCompare(b.playedAt));
  const rounds = ordered.filter(m => !m.isTiebreaker).slice(0, format.set.rounds);
  const tiebreak = ordered.find(m => m.isTiebreaker);
  const totals = new Map<ID, SetStanding>();
  const touch = (id: ID) => {
    const s = totals.get(id) ?? { profileId: id, points: 0, rounds: 0, tiebreakPlace: null, advances: false };
    totals.set(id, s);
    return s;
  };
  for (const m of rounds) for (const e of m.entries) {
    const s = touch(e.profileId);
    s.points += pointsFor(format, e.place) ?? 0;
    s.rounds++;
  }
  if (tiebreak) for (const e of tiebreak.entries) if (totals.has(e.profileId)) touch(e.profileId).tiebreakPlace = e.place;
  const standings = [...totals.values()].sort((a, b) =>
    b.points - a.points || (a.tiebreakPlace ?? 99) - (b.tiebreakPlace ?? 99));
  const done = rounds.length >= format.set.rounds;
  const k = format.set.advance;
  let needsTiebreaker = false;
  if (done && standings.length > k) {
    const edge = standings[k - 1].points;
    const tiedAtEdge = standings.filter(s => s.points === edge);
    const resolved = tiedAtEdge.every(s => s.tiebreakPlace !== null);
    needsTiebreaker = standings[k].points === edge && !resolved;
  }
  standings.forEach((s, i) => { s.advances = done && !needsTiebreaker && i < k; });
  const playedTypes = format.set.banPlayedType
    ? [...new Set(rounds.map(m => STADIUM_BY_ID.get(m.stadiumId ?? "")?.type).filter((t): t is string => !!t))]
    : [];
  return { standings, roundsPlayed: rounds.length, playedTypes, needsTiebreaker };
}

// -------------------------------------------------------------
// Seed formats
// -------------------------------------------------------------

export const DEFAULT_CT_FORMAT_TEMPLATE = {
  name: "Default rules",
  gameTempo: "normal" as const,
  minutes: 5,
  stadiumVote: false,
  legendaries: true,
  fieldEvents: true,
  fieldChange: true,
  bannedStadiumIds: [] as string[],
  isDefaultRules: true,
  description: "Normal tempo, 5 minutes, one blind stadium for everyone, field events and field changes on, every stadium active. Riders vary match to match.",
};

export const FFA_TOURNAMENT_TEMPLATE = {
  name: "4-player FFA sets (8/6/4/2)",
  gameTempo: "normal" as const,
  minutes: 5,
  stadiumVote: false,
  legendaries: true,
  fieldEvents: true,
  fieldChange: true,
  bannedStadiumIds: ["kirby-melee-1", "kirby-melee-2"],
  pointsTable: [8, 6, 4, 2],
  set: { rounds: 4, advance: 2, banPlayedType: true, tiebreakerMinutes: 3 },
  description: `4-player free-for-all, 4 rounds per set. Points: 1st 8, 2nd 6, 3rd 4, 4th 2. The best 2 of each set advance (single elimination).
Every stadium is allowed except Kirby Melee 1 and 2. Once a stadium is played, that stadium TYPE is banned for the rest of the set (play Drag Race 2 and every Drag Race is out; Oval Circuit stays).
Tiebreaker: if amiibo are level on points after round 4, the tied amiibo play a 3-minute City Trial with the same stadium as before.
Legendaries on. Blind stadium. 5 minutes per match.`,
};

// -------------------------------------------------------------
// Places from scores
// -------------------------------------------------------------

/**
 * Work out places from the scores in one stadium, by the rule the game
 * uses there (fastest time, most points, longest distance, most damage).
 * Equal scores share a place (1st, 1st, 3rd). Returns null unless every
 * entry has that score, so it never guesses.
 */
export function placesFromScores(stadiumId: string | null, scored: { key: string; scores?: CtScores }[]): Map<string, number> | null {
  const stadium = stadiumId ? STADIUM_BY_ID.get(stadiumId) : undefined;
  if (!stadium || stadium.id === GIGANTES_ID || !scored.length) return null;
  const by = stadium.decidedBy;
  const vals = scored.map(x => ({ key: x.key, v: scoreValue(x.scores, by.kind) }));
  if (vals.some(x => x.v === null)) return null;
  const sorted = [...vals].sort((a, b) => (by.better === "low" ? (a.v as number) - (b.v as number) : (b.v as number) - (a.v as number)));
  const out = new Map<string, number>();
  sorted.forEach((x, i) => {
    const prev = sorted[i - 1];
    out.set(x.key, prev && prev.v === x.v ? (out.get(prev.key) as number) : i + 1);
  });
  return out;
}
