// =============================================================
// Saving records.
//
// Every function here validates (record schema + the same cross-record
// checks the importer uses) inside the write transaction, then saves.
// If anything is wrong, it throws a SaveError listing the problems and
// nothing is written.
// =============================================================

import { computeGaps, kirbyColors } from "../domain/schema";
import type {
  FigurePlayerProfile, FigurePlayerSnapshot, Format, ID, Race, Run, Session, TestSet, TrackedMode,
} from "../domain/schema";
import { newRecordBase, nowIso } from "../lib/ids";
import { STORE_NAMES, runWrite } from "./database";
import type { StoreName, WriteTx } from "./database";
import { buildLookups, checkFormat, checkRace } from "./integrity";
import type { Lookups } from "./integrity";
import { formatSchema, profileSchema, raceSchema, runSchema, sessionSchema, snapshotSchema, testSetSchema, describeIssues } from "./validation";
import { checkTestSet } from "./integrity";
import type { z } from "zod";

export class SaveError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems[0] ?? "The change couldn't be saved.");
    this.name = "SaveError";
  }
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SaveError(describeIssues(result.error));
  return result.data;
}

const LOOKUP_STORES: StoreName[] = [
  "formats", "riders", "machines", "stages", "players", "amiiboFigures", "amiiboMachineFigures",
  "figurePlayerProfiles", "figurePlayerSnapshots", "sessions", "runs", "testSets", "experiments", "incidentTags",
];

async function readLookups(tx: WriteTx): Promise<Lookups> {
  const [formats, riders, machines, stages, players, amiiboFigures, amiiboMachineFigures,
    figurePlayerProfiles, figurePlayerSnapshots, sessions, runs, testSets, experiments, incidentTags] = await Promise.all([
    tx.getAll("formats"), tx.getAll("riders"), tx.getAll("machines"), tx.getAll("stages"), tx.getAll("players"),
    tx.getAll("amiiboFigures"), tx.getAll("amiiboMachineFigures"), tx.getAll("figurePlayerProfiles"),
    tx.getAll("figurePlayerSnapshots"), tx.getAll("sessions"), tx.getAll("runs"), tx.getAll("testSets"),
    tx.getAll("experiments"), tx.getAll("incidentTags"),
  ]);
  return buildLookups({
    formats, riders, machines, stages, players, amiiboFigures, amiiboMachineFigures,
    figurePlayerProfiles, figurePlayerSnapshots, sessions, runs, testSets, experiments, incidentTags,
  });
}

// -------------------------------------------------------------
// Amiibo profiles and snapshots
// -------------------------------------------------------------

export interface ProfileInput {
  riderId: ID;
  nickname: string;
  personality?: string;
  trainingGoal?: string;
  notes?: string;
  isBaseline?: boolean;
  /** Kirby only: scanned from the Sword Kirby figure. */
  swordKirby?: boolean;
  /** Kirby only: the exact in-game color, e.g. "Green". */
  kirbyColor?: string;
}

export interface SnapshotInput {
  trainingSinceLast?: string;
  takenAt?: string;
}

const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

function assertUniqueNickname(nickname: string, profiles: FigurePlayerProfile[], exceptId?: ID) {
  const key = nickname.trim().toLowerCase();
  if (profiles.some(p => p.id !== exceptId && p.status === "active" && p.nickname.trim().toLowerCase() === key)) {
    throw new SaveError([`You already have an active amiibo named "${nickname.trim()}".`]);
  }
}

function buildSnapshot(profileId: ID, version: number, input: SnapshotInput): FigurePlayerSnapshot {
  const base = newRecordBase();
  return parseOrThrow(snapshotSchema, {
    ...base,
    profileId,
    version,
    takenAt: input.takenAt ?? base.createdAt,
    trainingSinceLast: clean(input.trainingSinceLast),
  });
}

/** Create an amiibo profile together with its first version (v1). */
export async function createProfile(input: ProfileInput, first: SnapshotInput = {}): Promise<FigurePlayerProfile> {
  return runWrite(["figurePlayerProfiles", "figurePlayerSnapshots", "riders"], async tx => {
    const rider = await tx.get("riders", input.riderId);
    if (!rider) throw new SaveError(["Pick a rider."]);
    assertUniqueNickname(input.nickname, await tx.getAll("figurePlayerProfiles"));
    const profile = parseOrThrow(profileSchema, {
      ...newRecordBase(),
      riderId: input.riderId,
      nickname: input.nickname.trim(),
      personality: clean(input.personality),
      trainingGoal: clean(input.trainingGoal),
      notes: clean(input.notes),
      isBaseline: input.isBaseline || undefined,
      swordKirby: (input.swordKirby && rider.characterGroup === "Kirby") || undefined,
      kirbyColor: kirbyColors(rider).includes(input.kirbyColor ?? "") ? input.kirbyColor : undefined,
      status: "active",
    });
    await tx.put("figurePlayerProfiles", profile);
    await tx.put("figurePlayerSnapshots", buildSnapshot(profile.id, 1, first));
    return profile;
  });
}

/**
 * Edit a profile's name, personality, goal or notes. The rider can't
 * change once created. With `newVersion`, a new version is started in
 * the same change (used when a retrain changed its personality).
 */
export async function updateProfile(
  id: ID, patch: Omit<ProfileInput, "riderId">, newVersion?: SnapshotInput,
): Promise<void> {
  await runWrite(["figurePlayerProfiles", "figurePlayerSnapshots", "riders"], async tx => {
    const existing = await tx.get("figurePlayerProfiles", id);
    if (!existing) throw new SaveError(["That amiibo no longer exists."]);
    if (newVersion) {
      const versions = (await tx.getAll("figurePlayerSnapshots")).filter(s => s.profileId === id);
      const next = versions.reduce((m, s) => Math.max(m, s.version), 0) + 1;
      await tx.put("figurePlayerSnapshots", buildSnapshot(id, next, newVersion));
    }
    if (existing.status === "active") assertUniqueNickname(patch.nickname, await tx.getAll("figurePlayerProfiles"), id);
    if (patch.kirbyColor && !kirbyColors(await tx.get("riders", existing.riderId)).includes(patch.kirbyColor)) {
      throw new SaveError([`${patch.kirbyColor} doesn't match this Kirby's special.`]);
    }
    await tx.put("figurePlayerProfiles", parseOrThrow(profileSchema, {
      ...existing,
      nickname: patch.nickname.trim(),
      personality: clean(patch.personality),
      trainingGoal: clean(patch.trainingGoal),
      notes: clean(patch.notes),
      isBaseline: patch.isBaseline || undefined,
      swordKirby: patch.swordKirby || undefined,
      kirbyColor: patch.kirbyColor || undefined,
      updatedAt: nowIso(),
    }));
  });
}

export async function setProfileStatus(id: ID, status: FigurePlayerProfile["status"]): Promise<void> {
  await runWrite(["figurePlayerProfiles"], async tx => {
    const existing = await tx.get("figurePlayerProfiles", id);
    if (!existing) throw new SaveError(["That amiibo no longer exists."]);
    if (status === "active") assertUniqueNickname(existing.nickname, await tx.getAll("figurePlayerProfiles"), id);
    const at = nowIso();
    await tx.put("figurePlayerProfiles", {
      ...existing, status, updatedAt: at, retiredAt: status === "retired" ? at : undefined,
    });
  });
}

/** Save a new version after retraining; it gets the next version number. */
export async function addSnapshot(profileId: ID, input: SnapshotInput): Promise<FigurePlayerSnapshot> {
  return runWrite(["figurePlayerProfiles", "figurePlayerSnapshots"], async tx => {
    if (!(await tx.get("figurePlayerProfiles", profileId))) throw new SaveError(["That amiibo no longer exists."]);
    const existing = (await tx.getAll("figurePlayerSnapshots")).filter(s => s.profileId === profileId);
    const version = existing.reduce((m, s) => Math.max(m, s.version), 0) + 1;
    const snap = buildSnapshot(profileId, version, input);
    await tx.put("figurePlayerSnapshots", snap);
    return snap;
  });
}

// -------------------------------------------------------------
// Formats
// -------------------------------------------------------------

/** Fields that define a format's rules. Locked once races exist, so old results stay comparable. */
export const LOCKED_FORMAT_FIELDS = ["mode", "settings", "trackedSeats", "scoring", "timing", "allowedRacerKinds", "fillerCpu"] as const;

/** Create (no id yet) or update a format. */
export async function saveFormat(input: Omit<Format, "id" | "createdAt" | "updatedAt"> & { id?: ID }): Promise<Format> {
  return runWrite(STORE_NAMES, async tx => {
    const L = await readLookups(tx);
    const existing = input.id ? L.formats.get(input.id) : undefined;
    if (input.id && !existing) throw new SaveError(["That format no longer exists."]);

    const at = nowIso();
    const format = parseOrThrow(formatSchema, {
      ...input,
      id: existing?.id ?? newRecordBase(at).id,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      name: input.name.trim(),
      description: clean(input.description),
    });

    if (existing?.isDefaultRules || format.isDefaultRules) {
      if (!existing) throw new SaveError(["There's already a default rules format. Duplicate it to make a variation."]);
      const changed = LOCKED_FORMAT_FIELDS.filter(k => JSON.stringify(existing[k]) !== JSON.stringify(format[k]));
      if (changed.length || !format.isDefaultRules) throw new SaveError(["The default rules can't be changed. Duplicate them to make a variation."]);
    }
    if (existing) {
      const races = (await tx.getAll("races")).filter(r => r.formatId === existing.id);
      if (races.length) {
        const changed = LOCKED_FORMAT_FIELDS.filter(k => JSON.stringify(existing[k]) !== JSON.stringify(format[k]));
        if (changed.length) {
          throw new SaveError([`This format already has ${races.length} race${races.length === 1 ? "" : "s"}, so its rules are locked. Duplicate it to make a variation.`]);
        }
      }
    }
    if ((await tx.getAll("formats")).some(f => f.id !== format.id && f.mode === format.mode && !f.isArchived && f.name.toLowerCase() === format.name.toLowerCase())) {
      throw new SaveError([`There's already a ${format.mode === "air_ride" ? "Air Ride" : "Top Ride"} format called "${format.name}".`]);
    }

    L.formats.set(format.id, format);
    const problems = checkFormat(format, L);
    if (problems.length) throw new SaveError(problems);

    const settings = await tx.get("settings", "settings");
    if (format.isArchived && settings && Object.values(settings.recordFormatIds).includes(format.id)) {
      throw new SaveError(["This is the world-record format. Pick a different record format before archiving it."]);
    }
    await tx.put("formats", format);
    return format;
  });
}

export async function setRecordFormat(mode: TrackedMode, formatId: ID | null): Promise<void> {
  await runWrite(["settings", "formats"], async tx => {
    const settings = await tx.get("settings", "settings");
    if (!settings) throw new SaveError(["Settings are missing. Reload the app."]);
    if (formatId) {
      const f = await tx.get("formats", formatId);
      if (!f || f.mode !== mode) throw new SaveError(["That format isn't in this mode."]);
      if (f.isArchived) throw new SaveError(["Unarchive the format first."]);
    }
    const recordFormatIds = { ...settings.recordFormatIds };
    if (formatId) recordFormatIds[mode] = formatId; else delete recordFormatIds[mode];
    await tx.put("settings", { ...settings, recordFormatIds });
  });
}

// -------------------------------------------------------------
// Races
// -------------------------------------------------------------

export type RaceInput = Omit<Race, "id" | "createdAt" | "updatedAt"> & { id?: ID };

/**
 * Create (no id) or update a race. Gap to 1st is recalculated,
 * the mode is copied from the format, and every rule is checked.
 */
export async function saveRace(input: RaceInput): Promise<Race> {
  return runWrite(STORE_NAMES, async tx => {
    const L = await readLookups(tx);
    const format = L.formats.get(input.formatId);
    if (!format) throw new SaveError(["Pick a format."]);
    const existing = input.id ? await tx.get("races", input.id) : undefined;
    if (input.id && !existing) throw new SaveError(["That race no longer exists."]);

    const at = nowIso();
    const settings = await tx.get("settings", "settings");
    const race = parseOrThrow(raceSchema, {
      ...input,
      gameVersion: input.gameVersion ?? existing?.gameVersion ?? settings?.gameVersion,
      mode: format.mode,
      id: existing?.id ?? newRecordBase(at).id,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
      notes: clean(input.notes),
      entries: computeGaps(input.entries.map(e => ({ ...e, notes: clean(e.notes) })), input.firstPlaceTimeMs),
    });

    const problems = checkRace(race, L, "This race");
    if (problems.length) throw new SaveError(problems);

    // ---- full-run rules ----
    if (race.runId) {
      const run = L.runs.get(race.runId) as Run; // existence checked by checkRace
      if (!existing && run.status !== "in_progress") throw new SaveError(["This run is over. Start a new run to keep racing."]);
      const runRacer = run.racer.kind === "amiibo" ? run.racer.profileId : run.racer.playerId;
      for (const e of race.entries) {
        const who = e.racer.kind === "amiibo" ? e.racer.profileId : e.racer.playerId;
        if (format.runStructure.kind === "course_set" && format.runStructure.sameRacerThroughout && who !== runRacer) {
          throw new SaveError(["A run uses the same amiibo for every course."]);
        }
      }
      const runRaces = (await tx.getAll("races")).filter(r => r.runId === run.id && r.id !== race.id);
      if (format.runStructure.kind === "course_set" && format.runStructure.eachStageOnce && runRaces.some(r => r.stageId === race.stageId)) {
        throw new SaveError([`${L.stages.get(race.stageId)?.name ?? "This course"} has already been raced in this run.`]);
      }
      // A glitch forfeits the run; covering every course completes it.
      let nextRun: Run | null = null;
      if (race.glitchOccurred && format.forbidsGlitches && run.status === "in_progress") {
        nextRun = { ...run, status: "forfeit", forfeitReason: `Glitch on ${L.stages.get(race.stageId)?.name ?? "a course"}`, updatedAt: at };
      } else if (run.status === "in_progress" && format.runStructure.kind === "course_set") {
        const done = new Set([...runRaces.map(r => r.stageId), race.stageId]);
        if (format.runStructure.stageIds.every(id => done.has(id))) nextRun = { ...run, status: "complete", updatedAt: at };
      }
      if (nextRun) await tx.put("runs", nextRun);
    }

    await tx.put("races", race);
    return race;
  });
}

export async function setRaceIncluded(id: ID, includeInStats: boolean): Promise<void> {
  await runWrite(["races"], async tx => {
    const race = await tx.get("races", id);
    if (!race) throw new SaveError(["That race no longer exists."]);
    await tx.put("races", { ...race, includeInStats, updatedAt: nowIso() });
  });
}

export async function deleteRace(id: ID): Promise<void> {
  await runWrite(["races"], async tx => { await tx.delete("races", id); });
}

// -------------------------------------------------------------
// Trials
// -------------------------------------------------------------

export interface TrialInput {
  formatId: ID;
  stageId?: ID;                 // omit to race on any stages
  label: string;
  plannedRaces: number | null;
  includeInStats: boolean;
  notes?: string;
  /** The lineup: each amiibo races its latest version on the given machine. */
  seats: { profileId: ID; machineId: ID }[];
}

export async function createTrial(input: TrialInput): Promise<TestSet> {
  return runWrite(STORE_NAMES, async tx => {
    const L = await readLookups(tx);
    const format = L.formats.get(input.formatId);
    if (!format) throw new SaveError(["Pick a format."]);
    if (input.seats.length === 0) throw new SaveError(["Add at least one amiibo to the lineup."]);
    const latestVersion = (profileId: ID) =>
      [...L.snapshots.values()].filter(s => s.profileId === profileId).sort((a, b) => b.version - a.version)[0];
    const at = nowIso();
    const seats = input.seats.map(s => {
      const profile = L.profiles.get(s.profileId);
      const snap = latestVersion(s.profileId);
      if (!profile || !snap) throw new SaveError(["Every racer in the lineup needs an amiibo."]);
      if (!s.machineId) throw new SaveError([`Pick a machine for ${profile.nickname}.`]);
      return {
        id: newRecordBase(at).id,
        racer: { kind: "amiibo" as const, profileId: profile.id, snapshotId: snap.id },
        riderId: profile.riderId,
        machineId: s.machineId,
        includeInStats: true,
      };
    });
    const trial = parseOrThrow(testSetSchema, {
      ...newRecordBase(at),
      mode: format.mode,
      formatId: format.id,
      stageId: input.stageId || undefined,
      seats,
      plannedRaces: input.plannedRaces,
      label: input.label.trim(),
      status: "in_progress",
      includeInStats: input.includeInStats,
      notes: clean(input.notes),
    });
    const problems = checkTestSet(trial, L);
    if (problems.length) throw new SaveError(problems);
    await tx.put("testSets", trial);
    return trial;
  });
}

/** Change a trial's name, status, or whether its races count in core stats. */
export async function updateTrial(id: ID, patch: Partial<Pick<TestSet, "label" | "status" | "includeInStats" | "notes" | "plannedRaces">>): Promise<void> {
  await runWrite(["testSets"], async tx => {
    const trial = await tx.get("testSets", id);
    if (!trial) throw new SaveError(["That trial no longer exists."]);
    await tx.put("testSets", parseOrThrow(testSetSchema, { ...trial, ...patch, updatedAt: nowIso() }));
  });
}

/** Delete a trial. Its races are deleted too, unless keepRaces (they then become ordinary races). */
export async function deleteTrial(id: ID, keepRaces: boolean): Promise<void> {
  await runWrite(["testSets", "races"], async tx => {
    const races = (await tx.getAll("races")).filter(r => r.testSetId === id);
    for (const r of races) {
      if (keepRaces) {
        const { testSetId: _t, ...rest } = r;
        await tx.put("races", { ...rest, entries: r.entries.map(({ testSetSeatId: _s, ...e }) => e), updatedAt: nowIso() });
      } else {
        await tx.delete("races", r.id);
      }
    }
    await tx.delete("testSets", id);
  });
}

// -------------------------------------------------------------
// Full runs
// -------------------------------------------------------------

/** Start a run of a full-run format with one amiibo (its latest version). */
export async function createRun(input: { formatId: ID; profileId: ID; notes?: string }): Promise<Run> {
  return runWrite(STORE_NAMES, async tx => {
    const L = await readLookups(tx);
    const format = L.formats.get(input.formatId);
    if (!format || format.runStructure.kind !== "course_set") throw new SaveError(["Pick a full-run format."]);
    const profile = L.profiles.get(input.profileId);
    if (!profile || profile.status !== "active") throw new SaveError(["Pick an amiibo."]);
    const snap = [...L.snapshots.values()].filter(s => s.profileId === profile.id).sort((a, b) => b.version - a.version)[0];
    if (!snap) throw new SaveError([`${profile.nickname} has no version saved.`]);
    const at = nowIso();
    const run = parseOrThrow(runSchema, {
      ...newRecordBase(at),
      formatId: format.id,
      racer: { kind: "amiibo", profileId: profile.id, snapshotId: snap.id },
      startedAt: at,
      status: "in_progress",
      includeInStats: true,
      notes: clean(input.notes),
    });
    await tx.put("runs", run);
    return run;
  });
}

export async function updateRun(id: ID, patch: Partial<Pick<Run, "status" | "forfeitReason" | "videoUrl" | "submitted" | "notes" | "includeInStats">>): Promise<void> {
  await runWrite(["runs"], async tx => {
    const run = await tx.get("runs", id);
    if (!run) throw new SaveError(["That run no longer exists."]);
    const next = { ...run, ...patch, updatedAt: nowIso() };
    if (next.status !== "forfeit") delete next.forfeitReason;
    next.videoUrl = clean(next.videoUrl);
    next.notes = clean(next.notes);
    await tx.put("runs", parseOrThrow(runSchema, next));
  });
}

/** Delete a run and all of its races. */
export async function deleteRun(id: ID): Promise<void> {
  await runWrite(["runs", "races"], async tx => {
    for (const r of (await tx.getAll("races")).filter(r => r.runId === id)) await tx.delete("races", r.id);
    await tx.delete("runs", id);
  });
}

/** Keep (or drop) trial races for the core records. */
export async function setRacesKept(ids: ID[], keep: boolean): Promise<void> {
  await runWrite(["races"], async tx => {
    const at = nowIso();
    for (const id of ids) {
      const race = await tx.get("races", id);
      if (race) await tx.put("races", { ...race, keepInRecords: keep, updatedAt: at });
    }
  });
}

/** Change the game version new races are stamped with. */
export async function setGameVersion(version: string): Promise<void> {
  const v = version.trim().replace(/^ver\.?\s*/i, "");
  if (!/^[0-9A-Za-z][0-9A-Za-z.\-]{0,19}$/.test(v)) throw new SaveError(["Enter a version like 1.3.4."]);
  await runWrite(["settings"], async tx => {
    const settings = await tx.get("settings", "settings");
    if (!settings) throw new SaveError(["Settings are missing. Reload the app."]);
    await tx.put("settings", { ...settings, gameVersion: v });
  });
}

/** Save your notes on a course, character or machine. Empty clears them. */
export async function saveReferenceNotes(store: "stages" | "riders" | "machines", id: ID, notes: string): Promise<void> {
  const text = notes.trim();
  if (text.length > 5000) throw new SaveError(["Notes are limited to 5,000 characters."]);
  await runWrite([store], async tx => {
    const rec = await tx.get(store, id);
    if (!rec) throw new SaveError(["That record no longer exists. Reload the app."]);
    await tx.put(store, { ...rec, notes: text || undefined, updatedAt: nowIso() } as never);
  });
}

// -------------------------------------------------------------
// Sessions
// -------------------------------------------------------------

export interface SessionInput {
  name: string;
  formatId: ID;
  plannedRaces: number | null;
  notes?: string;
}

export async function createSession(input: SessionInput): Promise<Session> {
  return runWrite(["sessions", "formats"], async tx => {
    const format = await tx.get("formats", input.formatId);
    if (!format) throw new SaveError(["Pick a format."]);
    if (!input.name.trim()) throw new SaveError(["Give the session a name."]);
    const at = nowIso();
    const session = parseOrThrow(sessionSchema, {
      ...newRecordBase(at),
      formatId: format.id,
      mode: format.mode,
      name: input.name.trim(),
      date: at,
      plannedRaces: input.plannedRaces,
      status: "in_progress",
      notes: clean(input.notes),
    });
    await tx.put("sessions", session);
    return session;
  });
}

export async function updateSession(id: ID, patch: Partial<Pick<Session, "name" | "status" | "notes" | "plannedRaces">>): Promise<void> {
  await runWrite(["sessions"], async tx => {
    const session = await tx.get("sessions", id);
    if (!session) throw new SaveError(["That session no longer exists."]);
    await tx.put("sessions", parseOrThrow(sessionSchema, { ...session, ...patch, updatedAt: nowIso() }));
  });
}

/** Delete a session; its races are deleted too, or kept as ordinary races. */
export async function deleteSession(id: ID, keepRaces: boolean): Promise<void> {
  await runWrite(["sessions", "races"], async tx => {
    for (const r of (await tx.getAll("races")).filter(x => x.sessionId === id)) {
      if (keepRaces) {
        const { sessionId: _s, ...rest } = r;
        await tx.put("races", { ...rest, updatedAt: nowIso() });
      } else {
        await tx.delete("races", r.id);
      }
    }
    await tx.delete("sessions", id);
  });
}
