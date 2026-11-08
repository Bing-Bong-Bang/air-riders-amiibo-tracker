// =============================================================
// First-run seed: roster, stages, starter incident tags, the solo
// amiibo world-record format, and app settings.
//
// Runs inside one transaction and only if no settings record exists,
// so it is safe to call on every start-up and from several tabs.
// =============================================================

import {
  DEFAULT_RULES_FORMAT_TEMPLATE, INITIAL_GAME_VERSION, SEED_INCIDENT_TAGS, SEED_MACHINES, SEED_RIDERS, SEED_SETTINGS, SEED_STAGES,
  SOLO_AMIIBO_FORMAT_TEMPLATE, TOP_RIDE_DEFAULT_RULES_TEMPLATE, TOP_RIDE_SOLO_FORMAT_TEMPLATE,
} from "../domain/schema";
import type { AppSettings, Format, IncidentTag, Machine, Rider, Stage, TrackedMode } from "../domain/schema";
import { DEFAULT_CT_FORMAT_TEMPLATE, FFA_TOURNAMENT_TEMPLATE } from "../domain/cityTrial";
import type { CtFormat } from "../domain/cityTrial";
import { newRecordBase, nowIso } from "../lib/ids";
import { DATA_STORE_NAMES, runWrite } from "./database";
import type { WriteTx } from "./database";

/** The category rules as written, kept on the format for reference. */
export const SOLO_AMIIBO_RULES_TEXT = `This run is done in the Race mode in the Air Ride menu.

- Your amiibo must be the only rider in this run, including other amiibo and human players. Select "P1" on the bottom right of the character/machine select screen and set your amiibo to P1. One other CPU is allowed, as there is no way to disable them completely. The CPU must be a level 1 Kirby on a Warp Star with the maximum Handicap level of 4.
- You must use the same amiibo throughout the entire run, but your amiibo can switch machines during the run.
- In-game rules must be set as below. Rules not mentioned are up to user discretion. Your video must show your rules for the run to qualify.
  - Game Tempo: Normal
  - No. of Riders: 2
  - Rules: Laps
  - No. of Laps: Default
  - Boost Assist: Off
  - Special Assist: Off
  - Enemies: On
- IGT category: sum your amiibo's times for each course at the end of the run.
- Courses can be played in any order, but no course more than once in a single run. Try not to stall during course selection.
- No glitches/clips on any course. If your amiibo performs one accidentally, the run is forfeit and must be restarted.`;

/** The Top Ride solo category rules, written like the Air Ride ones. */
export const TOP_RIDE_SOLO_RULES_TEXT = `This run is done in Top Ride.

- Your amiibo must be the only rider in this run, including other amiibo and human players. One other CPU is required, as there is no way to disable them completely. The CPU must be a level 1 Kirby on a Warp Star with the maximum Handicap level.
- You must use the same amiibo throughout the entire run, but your amiibo can switch machines during the run.
- In-game rules must be set as below. Rules not mentioned are up to user discretion. Your video must show your rules for the run to qualify.
  - Game Tempo: Normal
  - No. of Riders: 2
  - No. of Laps: Default (4 on every stage except Mountain and Nova, which are 2)
  - Items: Off
  - Item Restrictions: Normal (default; no effect with items off)
  - Features: Limited
  - Anti-reverse: On
  - Boost Assist: Off
- IGT category: sum your amiibo's times for each stage at the end of the run.
- Stages can be played in any order, but no stage more than once in a single run.
- No glitches/clips on any stage. If your amiibo performs one accidentally, the run is forfeit and must be restarted.`;

/** The Top Ride solo speedrun format: every Top Ride stage once, times summed. */
export function buildTopRideSoloFormat(riders: Rider[], machines: Machine[], stages: Stage[], at = nowIso()): Format {
  const t = TOP_RIDE_SOLO_FORMAT_TEMPLATE;
  const rider = riders.find(r => r.name === t.fillerCpu.riderName);
  const machine = machines.find(m => m.name === t.fillerCpu.machineName);
  if (!rider || !machine) throw new Error("Roster is missing the Top Ride CPU's rider or machine.");
  return {
    ...newRecordBase(at),
    mode: "top_ride",
    name: t.name,
    settings: { ...t.settings },
    trackedSeats: t.trackedSeats,
    allowedRacerKinds: [...t.allowedRacerKinds],
    fillerCpu: { riderId: rider.id, machineId: machine.id, cpuLevel: t.fillerCpu.cpuLevel, handicap: t.fillerCpu.handicap, count: t.fillerCpu.count },
    scoring: t.scoring,
    timing: t.timing,
    runStructure: {
      kind: "course_set",
      stageIds: stages.filter(s => s.mode === "top_ride" && !s.isArchived).sort((a, b) => a.sortOrder - b.sortOrder).map(s => s.id),
      anyOrder: true, eachStageOnce: true, sameRacerThroughout: true, machineMayChange: true,
    },
    objective: t.objective,
    winnerIndexWeights: { ...t.winnerIndexWeights },
    disasterThresholdPct: t.disasterThresholdPct,
    forbidsGlitches: t.forbidsGlitches,
    requiresVideo: t.requiresVideo,
    description: TOP_RIDE_SOLO_RULES_TEXT,
    isArchived: false,
  };
}

/** The default-rules format for one mode (each mode has its own game defaults). */
export function buildDefaultRulesFormat(mode: TrackedMode, at = nowIso()): Format {
  const t = mode === "top_ride" ? TOP_RIDE_DEFAULT_RULES_TEMPLATE : DEFAULT_RULES_FORMAT_TEMPLATE;
  return {
    ...newRecordBase(at),
    mode,
    name: t.name,
    settings: { ...t.settings },
    trackedSeats: t.trackedSeats,
    flexibleSeats: t.flexibleSeats,
    isDefaultRules: t.isDefaultRules,
    allowedRacerKinds: [...t.allowedRacerKinds],
    scoring: t.scoring,
    timing: t.timing,
    runStructure: { ...t.runStructure },
    objective: t.objective,
    winnerIndexWeights: { ...t.winnerIndexWeights },
    disasterThresholdPct: t.disasterThresholdPct,
    forbidsGlitches: t.forbidsGlitches,
    requiresVideo: t.requiresVideo,
    description: t.description,
    isArchived: false,
  };
}

/** Build every seed record. Exported so tests can inspect it. */
export function buildSeedRecords(at = nowIso()) {
  const riders: Rider[] = SEED_RIDERS.map((r, i) => ({ ...newRecordBase(at), ...r, amiiboFigure: r.amiiboFigure ?? r.name, sortOrder: i + 1 }));
  const machines: Machine[] = SEED_MACHINES.map((m, i) => ({ ...newRecordBase(at), ...m, sortOrder: i + 1 }));
  const modeOrder = new Map<string, number>();
  const stages: Stage[] = SEED_STAGES.map(s => {
    const sortOrder = (modeOrder.get(s.mode) ?? 0) + 1;
    modeOrder.set(s.mode, sortOrder);
    return { ...newRecordBase(at), ...s, sortOrder, isArchived: false };
  });
  const incidentTags: IncidentTag[] = SEED_INCIDENT_TAGS.map(t => ({ ...newRecordBase(at), ...t, isArchived: false }));

  const t = SOLO_AMIIBO_FORMAT_TEMPLATE;
  const fillerRider = riders.find(r => r.name === t.fillerCpu.riderName);
  const fillerMachine = machines.find(m => m.name === t.fillerCpu.machineName);
  if (!fillerRider || !fillerMachine) throw new Error("Seed roster is missing the filler CPU's rider or machine.");

  const soloFormat: Format = {
    ...newRecordBase(at),
    mode: "air_ride",
    name: t.name,
    settings: { ...t.settings },
    trackedSeats: t.trackedSeats,
    allowedRacerKinds: [...t.allowedRacerKinds],
    fillerCpu: {
      riderId: fillerRider.id,
      machineId: fillerMachine.id,
      cpuLevel: t.fillerCpu.cpuLevel,
      handicap: t.fillerCpu.handicap,
      count: t.fillerCpu.count,
    },
    scoring: t.scoring,
    timing: t.timing,
    runStructure: {
      ...t.runStructure,
      stageIds: stages.filter(s => s.mode === "air_ride").map(s => s.id),
    },
    objective: t.objective,
    winnerIndexWeights: { ...t.winnerIndexWeights },
    disasterThresholdPct: t.disasterThresholdPct,
    forbidsGlitches: t.forbidsGlitches,
    requiresVideo: t.requiresVideo,
    description: SOLO_AMIIBO_RULES_TEXT,
    isArchived: false,
  };

  const topSolo = buildTopRideSoloFormat(riders, machines, stages, at);
  const settings: AppSettings = {
    ...SEED_SETTINGS,
    defaultFormatId: soloFormat.id,
    recordFormatIds: { air_ride: soloFormat.id, top_ride: topSolo.id },
  };

  const formats = [soloFormat, buildDefaultRulesFormat("air_ride", at), buildDefaultRulesFormat("top_ride", at), topSolo];
  return { riders, machines, stages, incidentTags, formats, settings, ctFormats: buildCtSeedFormats(at) };
}

/** City Trial's default rules and the 4-player FFA tournament sets. */
export function buildCtSeedFormats(at = nowIso()): CtFormat[] {
  const base = (t: typeof DEFAULT_CT_FORMAT_TEMPLATE | typeof FFA_TOURNAMENT_TEMPLATE): CtFormat => ({
    ...newRecordBase(at),
    ...structuredClone(t),
    isArchived: false,
  });
  return [base(DEFAULT_CT_FORMAT_TEMPLATE), base(FFA_TOURNAMENT_TEMPLATE)];
}

async function writeSeed(tx: WriteTx): Promise<void> {
  const seed = buildSeedRecords();
  await tx.putMany("riders", seed.riders);
  await tx.putMany("machines", seed.machines);
  await tx.putMany("stages", seed.stages);
  await tx.putMany("incidentTags", seed.incidentTags);
  await tx.putMany("formats", seed.formats);
  await tx.putMany("ctFormats", seed.ctFormats);
  await tx.put("settings", seed.settings);
}

/**
 * Seed the database if it has never been seeded; otherwise add anything
 * newer versions of the app seed (currently: the default-rules format
 * for each mode). Returns true if it seeded from scratch.
 */
export async function ensureSeeded(): Promise<boolean> {
  return runWrite(DATA_STORE_NAMES, async tx => {
    if (!(await tx.get("settings", "settings"))) {
      await writeSeed(tx);
      return true;
    }
    // Kirby specials: rename the original Kirby riders in place (same ids, so every race keeps its rider).
    const RIDER_UPGRADES: Record<string, string> = {
      "Kirby": "Kirby (Ultra Sword)", "Blast Kirby": "Kirby (Crash)", "Ice Kirby": "Kirby (Snow Bowl)", "Fire Kirby": "Kirby (Burn)", "Sword Kirby": "Sword Kirby",
    };
    const seedByName = new Map(SEED_RIDERS.map(r => [r.name, r]));
    for (const rider of await tx.getAll("riders")) {
      const target = seedByName.get(RIDER_UPGRADES[rider.name] ?? rider.name);
      if (!target) continue;
      if (rider.name === target.name && rider.amiiboFigure !== undefined && rider.characterGroup === target.characterGroup) continue; // already up to date
      await tx.put("riders", {
        ...rider,
        name: target.name,
        characterGroup: target.characterGroup, // Sword Kirby is its own character, not one of the Kirby colors
        hasAmiibo: target.hasAmiibo,
        description: target.description,
        amiiboFigure: target.amiiboFigure ?? target.name,
        updatedAt: nowIso(),
      });
    }

    // Game version tracking: settings get the current version, older races are assumed to be on it.
    const settings = await tx.get("settings", "settings");
    if (settings && !settings.gameVersion) {
      await tx.put("settings", { ...settings, gameVersion: INITIAL_GAME_VERSION });
      for (const race of await tx.getAll("races")) {
        if (!race.gameVersion) await tx.put("races", { ...race, gameVersion: INITIAL_GAME_VERSION });
      }
    }

    await migrateTrialsToSessions(tx);

    const formats = await tx.getAll("formats");
    for (const mode of ["air_ride", "top_ride"] as const) {
      if (!formats.some(f => f.mode === mode && f.isDefaultRules)) {
        // Keep names unique: an existing user format may already be called "Default rules".
        const f = buildDefaultRulesFormat(mode);
        if (formats.some(x => x.mode === mode && !x.isArchived && x.name.toLowerCase() === f.name.toLowerCase())) f.name = "Default rules (game)";
        await tx.put("formats", f);
      }
    }

    // Top Ride stage laps: Mountain and Nova are 2 laps by default.
    const TOP_RIDE_LAPS: Record<string, number> = { Mountain: 2, Nova: 2 };
    const allStages = await tx.getAll("stages");
    for (const st of allStages) {
      const laps = st.mode === "top_ride" ? TOP_RIDE_LAPS[st.name] : undefined;
      if (laps && st.defaultLaps !== laps) await tx.put("stages", { ...st, defaultLaps: laps, updatedAt: nowIso() });
    }

    // Top Ride's default rules used to copy Air Ride's settings: give it the real Top Ride defaults.
    const all = await tx.getAll("formats");
    const trDefault = all.find(f => f.mode === "top_ride" && f.isDefaultRules);
    if (trDefault && trDefault.settings.items === undefined) {
      const t = TOP_RIDE_DEFAULT_RULES_TEMPLATE;
      await tx.put("formats", { ...trDefault, settings: { ...t.settings }, trackedSeats: t.trackedSeats, description: t.description, updatedAt: nowIso() });
    }

    // Top Ride solo: keep it on the category's settings until races are logged on it (then its rules are fixed).
    const trSolo = all.find(f => f.mode === "top_ride" && f.runStructure.kind === "course_set" && f.name.startsWith(TOP_RIDE_SOLO_FORMAT_TEMPLATE.name));
    const want = TOP_RIDE_SOLO_FORMAT_TEMPLATE.settings;
    if (trSolo && JSON.stringify({ ...trSolo.settings }) !== JSON.stringify({ ...trSolo.settings, ...want })
      && !(await tx.getAll("races")).some(r => r.formatId === trSolo.id)) {
      await tx.put("formats", { ...trSolo, settings: { ...want }, description: TOP_RIDE_SOLO_RULES_TEXT, updatedAt: nowIso() });
    }

    // Top Ride solo speedrun format, once.
    if (!all.some(f => f.mode === "top_ride" && f.runStructure.kind === "course_set")) {
      const topSolo = buildTopRideSoloFormat(await tx.getAll("riders"), await tx.getAll("machines"), allStages);
      if (all.some(f => f.mode === "top_ride" && !f.isArchived && f.name.toLowerCase() === topSolo.name.toLowerCase())) topSolo.name = `${topSolo.name} (game)`;
      await tx.put("formats", topSolo);
      const st = await tx.get("settings", "settings");
      if (st && !st.recordFormatIds.top_ride) await tx.put("settings", { ...st, recordFormatIds: { ...st.recordFormatIds, top_ride: topSolo.id } });
    }

    // City Trial arrived: give it its starting formats once.
    if ((await tx.getAll("ctFormats")).length === 0) await tx.putMany("ctFormats", buildCtSeedFormats());
    return false;
  });
}

/** Wipe every store and seed again, as one all-or-nothing change. */
export async function resetToSeed(): Promise<void> {
  await runWrite(DATA_STORE_NAMES, async tx => {
    for (const store of DATA_STORE_NAMES) await tx.clear(store);
    await writeSeed(tx);
  });
}

/**
 * Trials became sessions. Each trial turns into a session with the same id
 * and name; its races join the session, and each race's keep-for-records
 * choice becomes its own "counts in records" box. Glitched races in a
 * no-glitch format, which trials never kept, stay out. Safe to run twice.
 */
export async function migrateTrialsToSessions(tx: WriteTx): Promise<number> {
  const trials = await tx.getAll("testSets");
  if (!trials.length) return 0;
  const formats = new Map((await tx.getAll("formats")).map(f => [f.id, f]));
  const races = await tx.getAll("races");
  for (const t of trials) {
    if (!(await tx.get("sessions", t.id))) {
      await tx.put("sessions", {
        id: t.id, createdAt: t.createdAt, updatedAt: nowIso(),
        formatId: t.formatId, name: t.label, date: t.createdAt, notes: t.notes,
        mode: t.mode, plannedRaces: t.plannedRaces, status: t.status,
      });
    }
    const format = formats.get(t.formatId);
    for (const race of races.filter(r => r.testSetId === t.id)) {
      const kept = (race.keepInRecords ?? t.includeInStats) && !(race.glitchOccurred && format?.forbidsGlitches);
      const { testSetId: _t, keepInRecords: _k, ...rest } = race;
      await tx.put("races", {
        ...rest,
        sessionId: t.id,
        includeInStats: race.includeInStats && kept,
        entries: race.entries.map(({ testSetSeatId: _s, ...e }) => e),
        updatedAt: nowIso(),
      });
    }
    await tx.delete("testSets", t.id);
  }
  return trials.length;
}
