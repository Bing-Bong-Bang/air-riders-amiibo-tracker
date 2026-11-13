// =============================================================
// Zod schemas for every stored record, used to validate imports.
// Each schema is annotated with its TypeScript type, so the compiler
// flags any drift between these and domain/schema.ts.
// =============================================================

import { z } from "zod";
import type {
  AmiiboFigure, AmiiboMachineFigure, AppSettings, ExportFile, Experiment, FigurePlayerProfile,
  FigurePlayerSnapshot, Format, IncidentTag, Machine, Placement, Player, Race, RaceEntry, Racer,
  Rider, Run, Session, Stage, TestSet, TestSetSeat,
} from "../domain/schema";
import { STAT_KEYS, STAT_MAX, STAT_MIN } from "../domain/cityTrial";
import type { CtEntry, CtFormat, CtMatch, CtScores, CtSession, StadiumRun, StatKey } from "../domain/cityTrial";

const id = z.string().min(1);
const iso = z.string().min(1);
const ms = z.number().int().nonnegative();
const trackedMode = z.enum(["air_ride", "top_ride"]);
const racerKind = z.enum(["human", "amiibo"]);
const seats = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]);
const placement: z.ZodType<Placement> = seats;

const base = { id, createdAt: iso, updatedAt: iso };

export const formatSchema: z.ZodType<Format> = z.object({
  ...base,
  mode: trackedMode,
  name: z.string().min(1),
  settings: z.object({
    gameTempo: z.enum(["normal", "slow"]).nullable(),
    numberOfRiders: seats.nullable(),
    ruleType: z.enum(["laps", "time"]).nullable(),
    laps: z.union([z.literal("default"), z.number().int().positive()]).nullable(),
    boostAssist: z.boolean().nullable(),
    specialAssist: z.boolean().nullable(),
    enemies: z.boolean().nullable(),
    retirement: z.boolean().nullable(),
    items: z.enum(["off", "few", "normal", "many"]).nullable().optional(),
    itemRestrictions: z.enum(["normal", "safety", "attack", "surprise"]).nullable().optional(),
    features: z.enum(["all", "limited"]).nullable().optional(),
    antiReverse: z.boolean().nullable().optional(),
    boostAssistLevel: z.enum(["off", "weak", "strong"]).nullable().optional(),
    other: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  }),
  trackedSeats: seats,
  flexibleSeats: z.boolean().optional(),
  isDefaultRules: z.boolean().optional(),
  allowedRacerKinds: z.array(racerKind).min(1),
  fillerCpu: z.object({
    riderId: id, machineId: id,
    cpuLevel: z.number().int(), handicap: z.number().int(), count: z.number().int().nonnegative(),
  }).optional(),
  scoring: z.enum(["time", "placement"]),
  timing: z.enum(["igt", "rta"]),
  runStructure: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("single_race") }),
    z.object({
      kind: z.literal("course_set"),
      stageIds: z.array(id),
      anyOrder: z.boolean(),
      eachStageOnce: z.boolean(),
      sameRacerThroughout: z.boolean(),
      machineMayChange: z.boolean(),
    }),
  ]),
  pointsTable: z.array(z.number()).max(8).optional(),
  objective: z.enum(["mean_time", "pb_chance", "placement"]),
  winnerIndexWeights: z.object({ median: z.number().nonnegative(), stdDev: z.number().nonnegative() }),
  disasterThresholdPct: z.number().positive(),
  forbidsGlitches: z.boolean(),
  requiresVideo: z.boolean(),
  description: z.string().optional(),
  isArchived: z.boolean(),
});

const riderSchema: z.ZodType<Rider> = z.object({
  ...base, name: z.string().min(1), characterGroup: z.string().min(1), hasAmiibo: z.boolean(),
  sortOrder: z.number(), color: z.string().optional(),
  description: z.string().optional(), amiiboFigure: z.string().optional(), notes: z.string().optional(),
});

const machineSchema: z.ZodType<Machine> = z.object({
  ...base, name: z.string().min(1), isLegendary: z.boolean(), hasAmiibo: z.boolean(),
  sortOrder: z.number(), color: z.string().optional(), notes: z.string().optional(),
});

const stageSchema: z.ZodType<Stage> = z.object({
  ...base, mode: trackedMode, name: z.string().min(1), sortOrder: z.number(),
  defaultLaps: z.number().int().positive().optional(), isArchived: z.boolean(), notes: z.string().optional(),
});

const playerSchema: z.ZodType<Player> = z.object({
  ...base, name: z.string().min(1), isMe: z.boolean(), isArchived: z.boolean(),
});

const figureSchema: z.ZodType<AmiiboFigure> = z.object({
  ...base, riderId: id, label: z.string().min(1), isArchived: z.boolean(),
});

const machineFigureSchema: z.ZodType<AmiiboMachineFigure> = z.object({
  ...base, machineId: id, label: z.string().min(1), isArchived: z.boolean(),
});

export const profileSchema: z.ZodType<FigurePlayerProfile> = z.object({
  ...base,
  riderId: id,
  nickname: z.string().min(1),
  personality: z.string().optional(),
  figureId: id.optional(),
  derivedFromProfileId: id.optional(),
  trainingGoal: z.string().optional(),
  isBaseline: z.boolean().optional(),
  swordKirby: z.boolean().optional(),
  kirbyColor: z.string().max(40).optional(),
  machineProficiency: z.record(z.number().int().min(0).max(100)).optional(),
  status: z.enum(["active", "retired"]),
  retiredAt: iso.optional(),
  notes: z.string().optional(),
});

export const snapshotSchema: z.ZodType<FigurePlayerSnapshot> = z.object({
  ...base,
  profileId: id,
  version: z.number().int().positive(),
  takenAt: iso,
  trainingSinceLast: z.string().optional(),
});

const racerSchema: z.ZodType<Racer> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("human"), playerId: id }),
  z.object({ kind: z.literal("amiibo"), profileId: id, snapshotId: id, machineFigureId: id.optional() }),
]);

const entrySchema: z.ZodType<RaceEntry> = z.object({
  id,
  racer: racerSchema,
  riderId: id,
  machineId: id,
  placement: placement.optional(),
  status: z.enum(["finished", "retired", "dnf", "dq"]),
  finishTimeMs: ms.nullable(),
  lapTimesMs: z.array(ms).optional(),
  gapToFirstMs: z.number().int().nullable().optional(),
  includeInStats: z.boolean(),
  testSetSeatId: id.optional(),
  incidentTagIds: z.array(id).optional(),
  notes: z.string().optional(),
});

export const raceSchema: z.ZodType<Race> = z.object({
  ...base,
  mode: trackedMode,
  formatId: id,
  stageId: id,
  racedAt: iso,
  sessionId: id.optional(),
  runId: id.optional(),
  testSetId: id.optional(),
  entries: z.array(entrySchema).min(1).max(8),
  riderCount: z.number().int().min(1).max(8).optional(),
  firstPlaceTimeMs: ms.optional(),
  includeInStats: z.boolean(),
  glitchOccurred: z.boolean().optional(),
  keepInRecords: z.boolean().optional(),
  gameVersion: z.string().min(1).max(20).optional(),
  notes: z.string().optional(),
});

export const runSchema: z.ZodType<Run> = z.object({
  ...base,
  formatId: id,
  racer: racerSchema,
  startedAt: iso,
  status: z.enum(["in_progress", "complete", "forfeit", "abandoned"]),
  forfeitReason: z.string().optional(),
  videoUrl: z.string().optional(),
  submitted: z.boolean().optional(),
  includeInStats: z.boolean(),
  notes: z.string().optional(),
});

export const sessionSchema: z.ZodType<Session> = z.object({
  ...base, formatId: id, name: z.string().min(1), date: iso, notes: z.string().optional(),
  mode: trackedMode.optional(),
  plannedRaces: z.number().int().positive().nullable().optional(),
  status: z.enum(["in_progress", "complete"]).optional(),
});

const seatSchema: z.ZodType<TestSetSeat> = z.object({
  id, racer: racerSchema, riderId: id, machineId: id, label: z.string().optional(), includeInStats: z.boolean(),
});

export const testSetSchema: z.ZodType<TestSet> = z.object({
  ...base,
  mode: trackedMode,
  formatId: id,
  stageId: id.optional(),
  seats: z.array(seatSchema).min(1).max(8),
  plannedRaces: z.number().int().positive().nullable(),
  label: z.string().min(1),
  experimentId: id.optional(),
  status: z.enum(["in_progress", "complete"]),
  includeInStats: z.boolean(),
  notes: z.string().optional(),
});

const experimentSchema: z.ZodType<Experiment> = z.object({
  ...base,
  formatId: id,
  name: z.string().min(1),
  variable: z.enum(["machine", "rider", "snapshot", "stage", "lineup", "other"]),
  hypothesis: z.string().optional(),
  conclusion: z.string().optional(),
  notes: z.string().optional(),
});

const incidentTagSchema: z.ZodType<IncidentTag> = z.object({
  ...base,
  name: z.string().min(1),
  kind: z.enum(["enemy", "hazard", "pitfall", "collision", "ai_mistake", "other"]),
  stageId: id.optional(),
  isArchived: z.boolean(),
});

const settingsSchema: z.ZodType<AppSettings> = z.object({
  id: z.literal("settings"),
  defaultRacerPools: z.array(racerKind),
  minSample: z.number().int().positive(),
  defaultFormatId: id.optional(),
  recordFormatIds: z.object({ air_ride: id.optional(), top_ride: id.optional() }),
  gameVersion: z.string().min(1).max(20).optional(),
});

// ---- City Trial ----
const place = z.number().int().min(1).max(16);

export const ctFormatSchema: z.ZodType<CtFormat> = z.object({
  ...base,
  name: z.string().min(1),
  gameTempo: z.enum(["normal", "slow"]),
  minutes: z.number().int().min(3).max(7),
  stadiumVote: z.boolean(),
  legendaries: z.boolean(),
  fieldEvents: z.boolean(),
  fieldChange: z.boolean(),
  bannedStadiumIds: z.array(z.string().min(1)),
  pointsTable: z.array(z.number()).max(16).optional(),
  set: z.object({
    rounds: z.number().int().min(1).max(20),
    advance: z.number().int().min(1).max(15),
    banPlayedType: z.boolean(),
    tiebreakerMinutes: z.number().int().min(3).max(7).optional(),
  }).optional(),
  isDefaultRules: z.boolean().optional(),
  description: z.string().optional(),
  isArchived: z.boolean(),
});

export const ctSessionSchema: z.ZodType<CtSession> = z.object({
  ...base, formatId: id, name: z.string().min(1), date: iso, notes: z.string().optional(),
  status: z.enum(["in_progress", "complete"]).optional(),
});

const ctScoresSchema: z.ZodType<CtScores> = z.object({
  timeMs: ms.optional(),
  points: z.number().optional(),
  distance: z.number().nonnegative().optional(),
});

const statValue = z.number().int().min(STAT_MIN).max(STAT_MAX);

const ctEntrySchema: z.ZodType<CtEntry> = z.object({
  id,
  profileId: id,
  snapshotId: id,
  riderId: id,
  place: place.nullable(),
  statTotal: z.number().int().optional(),
  stats: z.object(Object.fromEntries(STAT_KEYS.map(k => [k, statValue.optional()])) as Record<StatKey, z.ZodOptional<typeof statValue>>).optional(),
  machineId: z.string().min(1).optional(),
  scannedMachineId: z.string().min(1).optional(),
  kos: z.number().int().nonnegative().optional(),
  scores: ctScoresSchema.optional(),
  isGigantes: z.boolean().optional(),
  room: z.literal(2).optional(),
  eventPlaces: z.record(place).optional(),
  notes: z.string().optional(),
});

export const ctMatchSchema: z.ZodType<CtMatch> = z.object({
  ...base,
  formatId: id,
  sessionId: id.optional(),
  playedAt: iso,
  stadiumId: z.string().min(1).nullable(),
  riderCount: z.number().int().min(2).max(16),
  room2: z.object({ stadiumId: z.string().min(1).nullable(), riders: z.number().int().min(1).max(8) }).optional(),
  entries: z.array(ctEntrySchema).min(1).max(16),
  fieldEvents: z.array(z.string().min(1)).optional(),
  fieldChanges: z.array(z.string().min(1)).optional(),
  isTiebreaker: z.boolean().optional(),
  includeInStats: z.boolean(),
  gameVersion: z.string().min(1).max(20).optional(),
  notes: z.string().optional(),
});

export const stadiumRunSchema: z.ZodType<StadiumRun> = z.object({
  ...base,
  stadiumId: z.string().min(1),
  playedAt: iso,
  players: z.number().int().min(1).max(16),
  entries: z.array(z.object({
    id, profileId: id, snapshotId: id, riderId: id,
    machineId: z.string().min(1).optional(),
    scannedMachineId: z.string().min(1).optional(),
    place: place.optional(),
    scores: ctScoresSchema,
    notes: z.string().optional(),
  })).min(1).max(16),
  includeInStats: z.boolean(),
  gameVersion: z.string().min(1).max(20).optional(),
  notes: z.string().optional(),
});

/** Input may lack the City Trial lists (older files); they come out as empty lists. */
export const exportFileSchema: z.ZodType<ExportFile, z.ZodTypeDef, unknown> = z.object({
  app: z.literal("kirby-air-riders-tracker"),
  schemaVersion: z.number().int().positive(),
  exportedAt: iso,
  data: z.object({
    settings: settingsSchema,
    formats: z.array(formatSchema),
    riders: z.array(riderSchema),
    machines: z.array(machineSchema),
    stages: z.array(stageSchema),
    players: z.array(playerSchema),
    amiiboFigures: z.array(figureSchema),
    amiiboMachineFigures: z.array(machineFigureSchema),
    figurePlayerProfiles: z.array(profileSchema),
    figurePlayerSnapshots: z.array(snapshotSchema),
    sessions: z.array(sessionSchema),
    runs: z.array(runSchema),
    testSets: z.array(testSetSchema),
    experiments: z.array(experimentSchema),
    incidentTags: z.array(incidentTagSchema),
    races: z.array(raceSchema),
    ctFormats: z.array(ctFormatSchema).default([]),
    ctSessions: z.array(ctSessionSchema).default([]),
    ctMatches: z.array(ctMatchSchema).default([]),
    stadiumRuns: z.array(stadiumRunSchema).default([]),
  }),
});

/** Turn Zod issues into readable lines like "data.races[3].mode: Invalid enum value". */
export function describeIssues(error: z.ZodError, limit = 25): string[] {
  const lines = error.issues.slice(0, limit).map(issue => {
    const path = issue.path.reduce<string>(
      (acc, part) => (typeof part === "number" ? `${acc}[${part}]` : acc ? `${acc}.${part}` : String(part)),
      "",
    );
    return `${path || "file"}: ${issue.message}`;
  });
  if (error.issues.length > limit) lines.push(`…and ${error.issues.length - limit} more problems.`);
  return lines;
}
