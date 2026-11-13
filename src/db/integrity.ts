// =============================================================
// Integrity checks.
//
// The per-record checks (checkFormat, checkRace, …) run before every
// save, and checkIntegrity runs them all on import and from the Data
// page, so the entry forms and the importer enforce the same rules.
// They catch what a per-record schema can't: broken references,
// results leaking between modes, and rules that span several records.
// Each problem is returned as a plain-English sentence.
// =============================================================

import { maxRidersFor, sameFigure } from "../domain/schema";
import type {
  AmiiboFigure, AmiiboMachineFigure, Experiment, ExportFile, FigurePlayerProfile,
  FigurePlayerSnapshot, Format, ID, IncidentTag, Machine, Player, Race, Racer, Rider, Run,
  Session, Stage, TestSet,
} from "../domain/schema";

import { checkCtMatch, checkCtSession, checkStadiumRun } from "./ctIntegrity";
import type { CtLookups } from "./ctIntegrity";

export type Dataset = ExportFile["data"];

const TRACKED_MODES = new Set(["air_ride", "top_ride"]);
const MAX_PROBLEMS = 200;

/** Every record type, indexed by id. */
export interface Lookups {
  formats: Map<ID, Format>;
  riders: Map<ID, Rider>;
  machines: Map<ID, Machine>;
  stages: Map<ID, Stage>;
  players: Map<ID, Player>;
  figures: Map<ID, AmiiboFigure>;
  machineFigures: Map<ID, AmiiboMachineFigure>;
  profiles: Map<ID, FigurePlayerProfile>;
  snapshots: Map<ID, FigurePlayerSnapshot>;
  sessions: Map<ID, Session>;
  runs: Map<ID, Run>;
  testSets: Map<ID, TestSet>;
  experiments: Map<ID, Experiment>;
  tags: Map<ID, IncidentTag>;
}

export type LookupSource = Omit<Dataset, "settings" | "races" | "ctFormats" | "ctSessions" | "ctMatches" | "stadiumRuns">;

export function buildLookups(d: LookupSource): Lookups {
  const byId = <T extends { id: ID }>(rows: T[]) => new Map(rows.map(r => [r.id, r]));
  return {
    formats: byId(d.formats), riders: byId(d.riders), machines: byId(d.machines), stages: byId(d.stages),
    players: byId(d.players), figures: byId(d.amiiboFigures), machineFigures: byId(d.amiiboMachineFigures),
    profiles: byId(d.figurePlayerProfiles), snapshots: byId(d.figurePlayerSnapshots), sessions: byId(d.sessions),
    runs: byId(d.runs), testSets: byId(d.testSets), experiments: byId(d.experiments), tags: byId(d.incidentTags),
  };
}

type Add = (msg: string) => void;

function collector(): { problems: string[]; add: Add } {
  const problems: string[] = [];
  return { problems, add: msg => { if (problems.length < MAX_PROBLEMS) problems.push(msg); } };
}

// -------------------------------------------------------------
// Per-record checks
// -------------------------------------------------------------

export function checkFormat(f: Format, L: Lookups): string[] {
  const { problems, add } = collector();
  const name = `Format "${f.name}"`;
  if (!TRACKED_MODES.has(f.mode)) add(`${name} uses mode "${f.mode}", which isn't tracked yet.`);
  if (f.fillerCpu) {
    if (!L.riders.has(f.fillerCpu.riderId)) add(`${name}: the required CPU's rider doesn't exist.`);
    if (!L.machines.has(f.fillerCpu.machineId)) add(`${name}: the required CPU's machine doesn't exist.`);
  }
  if (f.runStructure.kind === "course_set") {
    if (f.runStructure.stageIds.length === 0) add(`${name}: a full run needs at least one course.`);
    for (const sid of f.runStructure.stageIds) {
      const st = L.stages.get(sid);
      if (!st) add(`${name}: run course ${sid} doesn't exist.`);
      else if (st.mode !== f.mode) add(`${name}: run course "${st.name}" belongs to another mode.`);
    }
  }
  if (f.flexibleSeats && f.runStructure.kind === "course_set") add(`${name}: a full run needs a fixed number of racers.`);
  const most = maxRidersFor(f.mode);
  if ((f.settings.numberOfRiders ?? 0) > most || f.trackedSeats > most) add(`${name}: ${f.mode === "top_ride" ? "Top Ride" : "Air Ride"} races hold at most ${most} riders.`);
  if (f.settings.numberOfRiders !== null && f.trackedSeats > f.settings.numberOfRiders) {
    add(`${name} logs ${f.trackedSeats} racers but the race only has ${f.settings.numberOfRiders} riders.`);
  }
  if (f.scoring === "placement" && f.pointsTable && f.pointsTable.length > (f.settings.numberOfRiders ?? maxRidersFor(f.mode))) {
    add(`${name}: the points table has more places than riders in the race.`);
  }
  if (f.winnerIndexWeights.median === 0 && f.winnerIndexWeights.stdDev === 0) add(`${name}: Winner Index weights can't both be 0.`);
  return problems;
}

export function checkRacer(where: string, racer: Racer, riderId: ID, L: Lookups, add: Add): void {
  if (racer.kind === "human") {
    if (!L.players.has(racer.playerId)) add(`${where}: player doesn't exist.`);
    return;
  }
  const profile = L.profiles.get(racer.profileId);
  const snap = L.snapshots.get(racer.snapshotId);
  if (!profile) add(`${where}: amiibo profile doesn't exist.`);
  if (!snap) add(`${where}: amiibo snapshot doesn't exist.`);
  if (profile && snap && snap.profileId !== profile.id) add(`${where}: snapshot belongs to a different amiibo.`);
  if (profile && !sameFigure(L.riders.get(profile.riderId), L.riders.get(riderId))) add(`${where}: rider doesn't match amiibo "${profile.nickname}".`);
  if (racer.machineFigureId && !L.machineFigures.has(racer.machineFigureId)) add(`${where}: machine figure doesn't exist.`);
}

export function checkTestSet(t: TestSet, L: Lookups): string[] {
  const { problems, add } = collector();
  const where = `Test trial "${t.label}"`;
  const f = L.formats.get(t.formatId);
  if (!f) { add(`${where} points at a missing format.`); return problems; }
  if (t.mode !== f.mode) add(`${where} is filed under a different mode from its format.`);
  if (t.stageId) {
    const st = L.stages.get(t.stageId);
    if (!st) add(`${where} points at a missing stage.`);
    else if (st.mode !== f.mode) add(`${where} uses a stage from another mode.`);
  }
  if (f.flexibleSeats ? t.seats.length > f.trackedSeats : t.seats.length !== f.trackedSeats) {
    add(`${where} has ${t.seats.length} racers; its format logs ${f.flexibleSeats ? "up to " : ""}${f.trackedSeats}.`);
  }
  const seatRacers = new Set(t.seats.map(s => (s.racer.kind === "amiibo" ? s.racer.profileId : s.racer.playerId)));
  if (seatRacers.size !== t.seats.length) add(`${where}: the same racer is in the lineup twice.`);
  if (t.experimentId) {
    const ex = L.experiments.get(t.experimentId);
    if (!ex) add(`${where} points at a missing experiment.`);
    else if (ex.formatId !== t.formatId) add(`${where} is in an experiment for a different format.`);
  }
  for (const seat of t.seats) {
    if (!L.riders.has(seat.riderId)) add(`${where}: a seat's rider doesn't exist.`);
    if (!L.machines.has(seat.machineId)) add(`${where}: a seat's machine doesn't exist.`);
    if (!f.allowedRacerKinds.includes(seat.racer.kind)) add(`${where}: a seat's racer type isn't allowed by the format.`);
    checkRacer(`${where} seat`, seat.racer, seat.riderId, L, add);
  }
  if (t.plannedRaces !== null && t.plannedRaces < 1) add(`${where} plans fewer than 1 race.`);
  return problems;
}

/**
 * Checks one race on its own. `where` prefixes each message, e.g.
 * "This race" in the entry form, "Race 1a2b3c4d" in a dataset check.
 */
export function checkRace(race: Race, L: Lookups, where = `Race ${race.id.slice(0, 8)}`): string[] {
  const { problems, add } = collector();
  const f = L.formats.get(race.formatId);
  if (!f) { add(`${where} points at a missing format.`); return problems; }
  if (race.mode !== f.mode) add(`${where} is filed under ${race.mode} but its format is ${f.mode}.`);
  const st = L.stages.get(race.stageId);
  if (!st) add(`${where} points at a missing stage.`);
  else if (st.mode !== f.mode) add(`${where} uses a stage from another mode.`);
  if (st && f.runStructure.kind === "course_set" && race.runId && !f.runStructure.stageIds.includes(st.id)) {
    add(`${where}: "${st.name}" isn't one of this format's run courses.`);
  }
  if (race.sessionId) {
    const session = L.sessions.get(race.sessionId);
    if (!session) add(`${where} points at a missing session.`);
    else if (session.formatId !== race.formatId) add(`${where} is in a session of a different format.`);
  }
  if (race.runId) {
    const run = L.runs.get(race.runId);
    if (!run) add(`${where} points at a missing run.`);
    else if (run.formatId !== race.formatId) add(`${where} belongs to a run of a different format.`);
  }

  const set = race.testSetId ? L.testSets.get(race.testSetId) : undefined;
  if (race.testSetId && !set) add(`${where} points at a missing test trial.`);
  if (set && set.formatId !== race.formatId) add(`${where} doesn't match its trial's format.`);
  if (set?.stageId && set.stageId !== race.stageId) add(`${where} isn't on its trial's stage.`);

  if (f.flexibleSeats ? race.entries.length > f.trackedSeats : race.entries.length !== f.trackedSeats) {
    add(`${where} has ${race.entries.length} racers; its format logs ${f.flexibleSeats ? "up to " : ""}${f.trackedSeats}.`);
  }
  const ridersInRace = f.settings.numberOfRiders ?? race.riderCount ?? maxRidersFor(f.mode);
  if (f.settings.numberOfRiders !== null && race.riderCount !== undefined && race.riderCount !== f.settings.numberOfRiders) {
    add(`${where}: says ${race.riderCount} riders but the format has ${f.settings.numberOfRiders}.`);
  }
  if (race.riderCount !== undefined && race.entries.length > race.riderCount) add(`${where}: more racers logged than riders in the race.`);
  if ((race.riderCount ?? race.entries.length) > maxRidersFor(f.mode)) add(`${where}: more riders than a ${f.mode === "top_ride" ? "Top Ride" : "Air Ride"} race holds.`);

  const placements = new Set<number>();
  const racerKeys = new Set<string>();
  race.entries.forEach((e, i) => {
    const who = race.entries.length > 1 ? `${where}, racer ${i + 1}` : where;
    if (!L.riders.has(e.riderId)) add(`${who}: rider doesn't exist.`);
    if (!L.machines.has(e.machineId)) add(`${who}: machine doesn't exist.`);
    if (!f.allowedRacerKinds.includes(e.racer.kind)) add(`${who}: racer type "${e.racer.kind}" isn't allowed by the format.`);
    checkRacer(who, e.racer, e.riderId, L, add);

    const key = e.racer.kind === "human" ? `h:${e.racer.playerId}` : `a:${e.racer.profileId}`;
    if (racerKeys.has(key)) add(`${where}: the same racer appears twice.`);
    racerKeys.add(key);

    if (f.scoring === "placement" && e.placement === undefined && e.status === "finished") add(`${who}: placement is missing.`);
    if (e.placement !== undefined) {
      if (placements.has(e.placement)) add(`${where}: two racers share placement ${e.placement}.`);
      placements.add(e.placement);
      if (e.placement > ridersInRace) add(`${who}: placement ${e.placement} is beyond the ${ridersInRace} riders in the race.`);
    }
    // A placed racer may skip its time (e.g. only your main amiibo was timed); otherwise time formats need one.
    if (e.status === "finished" && e.finishTimeMs === null && f.scoring === "time" && e.placement === undefined) add(`${who}: finish time is missing.`);
    if (e.status !== "finished" && e.finishTimeMs !== null) add(`${who}: a racer who didn't finish can't have a time.`);
    if (e.finishTimeMs !== null && e.finishTimeMs % 10 !== 0) add(`${who}: time must be in whole hundredths.`);
    if (e.lapTimesMs?.length && e.finishTimeMs !== null) {
      const sum = e.lapTimesMs.reduce((a, b) => a + b, 0);
      if (sum !== e.finishTimeMs) add(`${who}: lap splits add up to a different time than the finish time.`);
    }
    for (const tagId of e.incidentTagIds ?? []) {
      const tag = L.tags.get(tagId);
      if (!tag) add(`${who}: incident tag doesn't exist.`);
      else if (tag.stageId && tag.stageId !== race.stageId) add(`${who}: incident "${tag.name}" belongs to a different stage.`);
    }
    if (set) {
      const seat = set.seats.find(s => s.id === e.testSetSeatId);
      if (!seat) add(`${who}: not linked to a seat of its test trial.`);
      else if (seat.riderId !== e.riderId || seat.machineId !== e.machineId) add(`${who}: doesn't match its test-trial seat.`);
    }
  });

  const finished = race.entries
    .filter(e => e.status === "finished" && e.finishTimeMs !== null && e.placement !== undefined)
    .sort((a, b) => (a.placement as number) - (b.placement as number));
  for (let i = 1; i < finished.length; i++) {
    if (Number(finished[i].finishTimeMs) < Number(finished[i - 1].finishTimeMs)) {
      add(`${where}: a lower placement has a faster time.`);
      break;
    }
  }
  if (race.firstPlaceTimeMs !== undefined && race.entries.some(e => e.finishTimeMs !== null && e.finishTimeMs < (race.firstPlaceTimeMs as number))) {
    add(`${where}: a racer beat the recorded 1st-place time.`);
  }
  return problems;
}

// -------------------------------------------------------------
// Whole-dataset check
// -------------------------------------------------------------

export function checkIntegrity(data: Dataset): string[] {
  const { problems, add } = collector();

  // ---- unique ids per table ----
  const tables: [string, { id: ID }[]][] = [
    ["formats", data.formats], ["riders", data.riders], ["machines", data.machines],
    ["stages", data.stages], ["players", data.players], ["amiibo figures", data.amiiboFigures],
    ["machine figures", data.amiiboMachineFigures], ["profiles", data.figurePlayerProfiles],
    ["snapshots", data.figurePlayerSnapshots], ["sessions", data.sessions], ["runs", data.runs],
    ["test trials", data.testSets], ["experiments", data.experiments],
    ["incident tags", data.incidentTags], ["races", data.races],
    ["City Trial formats", data.ctFormats], ["City Trial sessions", data.ctSessions],
    ["City Trial matches", data.ctMatches], ["stadium runs", data.stadiumRuns],
  ];
  for (const [label, rows] of tables) {
    const seen = new Set<ID>();
    for (const row of rows) {
      if (seen.has(row.id)) add(`Duplicate id ${row.id} in ${label}.`);
      seen.add(row.id);
    }
  }

  const L = buildLookups(data);

  for (const f of data.formats) checkFormat(f, L).forEach(add);
  for (const s of data.stages) if (!TRACKED_MODES.has(s.mode)) add(`Stage "${s.name}" uses untracked mode "${s.mode}".`);
  for (const t of data.incidentTags) if (t.stageId && !L.stages.has(t.stageId)) add(`Incident tag "${t.name}" points at a missing stage.`);

  // ---- amiibo ----
  const activeByFigure = new Map<ID, number>();
  const activeNicknames = new Map<string, number>();
  for (const f of data.amiiboFigures) if (!L.riders.has(f.riderId)) add(`Figure "${f.label}" points at a missing rider.`);
  for (const f of data.amiiboMachineFigures) if (!L.machines.has(f.machineId)) add(`Machine figure "${f.label}" points at a missing machine.`);
  for (const p of data.figurePlayerProfiles) {
    if (!L.riders.has(p.riderId)) add(`Amiibo "${p.nickname}" points at a missing rider.`);
    else if (p.swordKirby && L.riders.get(p.riderId)?.characterGroup !== "Kirby") add(`Amiibo "${p.nickname}" is marked as a Sword Kirby figure but isn't a Kirby.`);
    if (p.figureId) {
      const fig = L.figures.get(p.figureId);
      if (!fig) add(`Amiibo "${p.nickname}" points at a missing figure.`);
      else if (fig.riderId !== p.riderId) add(`Amiibo "${p.nickname}" is a different rider from its figure.`);
    }
    if (p.derivedFromProfileId && !L.profiles.has(p.derivedFromProfileId)) add(`Amiibo "${p.nickname}" was derived from a missing profile.`);
    if (p.status === "active") {
      if (p.figureId) activeByFigure.set(p.figureId, (activeByFigure.get(p.figureId) ?? 0) + 1);
      const key = p.nickname.trim().toLowerCase();
      activeNicknames.set(key, (activeNicknames.get(key) ?? 0) + 1);
    }
  }
  for (const [figureId, n] of activeByFigure) if (n > 1) add(`Figure "${L.figures.get(figureId)?.label}" has ${n} active profiles; only one is allowed.`);
  for (const [nick, n] of activeNicknames) if (n > 1) add(`${n} active amiibo share the name "${nick}".`);

  const versions = new Map<ID, Set<number>>();
  for (const s of data.figurePlayerSnapshots) {
    if (!L.profiles.has(s.profileId)) { add(`Snapshot v${s.version} points at a missing profile.`); continue; }
    const set = versions.get(s.profileId) ?? new Set<number>();
    if (set.has(s.version)) add(`Amiibo "${L.profiles.get(s.profileId)?.nickname}" has two v${s.version} snapshots.`);
    set.add(s.version);
    versions.set(s.profileId, set);
  }

  // ---- runs, sessions, experiments, test trials ----
  for (const r of data.runs) if (!L.formats.has(r.formatId)) add(`A run points at a missing format.`);
  for (const s of data.sessions) if (!L.formats.has(s.formatId)) add(`Session "${s.name}" points at a missing format.`);
  for (const e of data.experiments) if (!L.formats.has(e.formatId)) add(`Experiment "${e.name}" points at a missing format.`);
  for (const t of data.testSets) checkTestSet(t, L).forEach(add);

  // ---- races ----
  const runStages = new Map<ID, Set<ID>>();
  for (const race of data.races) {
    checkRace(race, L).forEach(add);
    const f = L.formats.get(race.formatId);
    if (race.runId && f?.runStructure.kind === "course_set" && f.runStructure.eachStageOnce) {
      const done = runStages.get(race.runId) ?? new Set<ID>();
      if (done.has(race.stageId)) add(`Race ${race.id.slice(0, 8)}: its run already has a race on this course.`);
      done.add(race.stageId);
      runStages.set(race.runId, done);
    }
  }

  // ---- City Trial ----
  const CL: CtLookups = {
    ctFormats: new Map(data.ctFormats.map(f => [f.id, f])),
    ctSessions: new Map(data.ctSessions.map(s => [s.id, s])),
    profiles: L.profiles, snapshots: L.snapshots,
  };
  for (const s of data.ctSessions) checkCtSession(s, CL).forEach(add);
  for (const m of data.ctMatches) checkCtMatch(m, CL).forEach(add);
  for (const r of data.stadiumRuns) checkStadiumRun(r, CL).forEach(add);

  // ---- settings ----
  for (const [mode, formatId] of Object.entries(data.settings.recordFormatIds)) {
    if (!formatId) continue;
    const f = L.formats.get(formatId);
    if (!f) add(`The ${mode.replace("_", " ")} record format doesn't exist.`);
    else if (f.mode !== mode) add(`The ${mode.replace("_", " ")} record format belongs to another mode.`);
  }
  if (data.settings.defaultFormatId && !L.formats.has(data.settings.defaultFormatId)) add(`The default format doesn't exist.`);

  if (problems.length === MAX_PROBLEMS) problems.push("…and possibly more. Fix these first.");
  return problems;
}
