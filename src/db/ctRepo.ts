// =============================================================
// Saving City Trial records and machine proficiency. Same rules as
// repo.ts: validate inside the write, all-or-nothing, SaveError lists
// the problems in plain English.
// =============================================================

import type { CtFormat, CtMatch, CtSession, StadiumRun } from "../domain/cityTrial";
import { CT_MACHINE_BY_ID, SCANNABLE_MACHINE_IDS } from "../domain/cityTrial";
import type { ID } from "../domain/schema";
import { newRecordBase, nowIso } from "../lib/ids";
import { runWrite } from "./database";
import type { WriteTx } from "./database";
import { checkCtMatch, checkStadiumRun } from "./ctIntegrity";
import type { CtLookups } from "./ctIntegrity";
import { SaveError } from "./repo";
import { ctFormatSchema, ctMatchSchema, ctSessionSchema, describeIssues, profileSchema, stadiumRunSchema } from "./validation";
import type { z } from "zod";

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SaveError(describeIssues(result.error));
  return result.data;
}

async function lookups(tx: WriteTx): Promise<CtLookups> {
  const [formats, sessions, profiles, snapshots] = await Promise.all([
    tx.getAll("ctFormats"), tx.getAll("ctSessions"), tx.getAll("figurePlayerProfiles"), tx.getAll("figurePlayerSnapshots"),
  ]);
  const byId = <T extends { id: ID }>(rows: T[]) => new Map(rows.map(r => [r.id, r]));
  return { ctFormats: byId(formats), ctSessions: byId(sessions), profiles: byId(profiles), snapshots: byId(snapshots) };
}

const clean = (s: string | undefined) => (s && s.trim() ? s.trim() : undefined);

// -------------------------------------------------------------
// Formats
// -------------------------------------------------------------

/** Rule fields that can't change once a format has matches, so its results never mix rules. */
const LOCKED: (keyof CtFormatInput & keyof CtFormat)[] =["gameTempo", "minutes", "stadiumVote", "legendaries", "fieldEvents", "fieldChange", "bannedStadiumIds", "pointsTable", "set"];

export type CtFormatInput = Omit<CtFormat, "id" | "createdAt" | "updatedAt"> & { id?: ID };

export async function saveCtFormat(input: CtFormatInput): Promise<CtFormat> {
  return runWrite(["ctFormats", "ctMatches"], async tx => {
    const all = await tx.getAll("ctFormats");
    const name = input.name.trim();
    if (all.some(f => f.id !== input.id && !f.isArchived && f.name.trim().toLowerCase() === name.toLowerCase())) {
      throw new SaveError([`There's already a City Trial format called "${name}".`]);
    }
    const existing = input.id ? all.find(f => f.id === input.id) : undefined;
    if (input.id && !existing) throw new SaveError(["That format no longer exists."]);
    if (existing) {
      const used = (await tx.getAll("ctMatches")).some(m => m.formatId === existing.id);
      const changed = LOCKED.filter(k => JSON.stringify(existing[k] ?? null) !== JSON.stringify(input[k] ?? null));
      if (used && changed.length) {
        throw new SaveError(["This format already has matches, so its rules are fixed (otherwise old and new results would mix). Make a new format instead."]);
      }
    }
    const { id: _id, ...fields } = input;
    const record = parseOrThrow(ctFormatSchema, {
      ...(existing ?? newRecordBase()),
      ...fields,
      name,
      description: clean(input.description),
      updatedAt: nowIso(),
    });
    await tx.put("ctFormats", record);
    return record;
  });
}

// -------------------------------------------------------------
// Sessions
// -------------------------------------------------------------

export async function createCtSession(input: { name: string; formatId: ID; notes?: string }): Promise<CtSession> {
  return runWrite(["ctSessions", "ctFormats"], async tx => {
    if (!(await tx.get("ctFormats", input.formatId))) throw new SaveError(["Pick a format."]);
    const base = newRecordBase();
    const s = parseOrThrow(ctSessionSchema, {
      ...base, formatId: input.formatId, name: input.name.trim() || "Session", date: base.createdAt,
      notes: clean(input.notes), status: "in_progress",
    });
    await tx.put("ctSessions", s);
    return s;
  });
}

export async function updateCtSession(id: ID, patch: Partial<Pick<CtSession, "name" | "notes" | "status">>): Promise<void> {
  await runWrite(["ctSessions"], async tx => {
    const s = await tx.get("ctSessions", id);
    if (!s) throw new SaveError(["That session no longer exists."]);
    await tx.put("ctSessions", parseOrThrow(ctSessionSchema, {
      ...s, ...patch, name: (patch.name ?? s.name).trim() || s.name, notes: patch.notes !== undefined ? clean(patch.notes) : s.notes, updatedAt: nowIso(),
    }));
  });
}

/** Delete a session; its matches are kept (unlinked) or deleted with it. */
export async function deleteCtSession(id: ID, keepMatches: boolean): Promise<void> {
  await runWrite(["ctSessions", "ctMatches"], async tx => {
    for (const m of (await tx.getAll("ctMatches")).filter(x => x.sessionId === id)) {
      if (keepMatches) {
        const { sessionId: _s, ...rest } = m;
        await tx.put("ctMatches", { ...rest, updatedAt: nowIso() });
      } else await tx.delete("ctMatches", m.id);
    }
    await tx.delete("ctSessions", id);
  });
}

// -------------------------------------------------------------
// Matches and stadium runs
// -------------------------------------------------------------

export type CtMatchInput = Omit<CtMatch, "id" | "createdAt" | "updatedAt"> & { id?: ID };

export async function saveCtMatch(input: CtMatchInput): Promise<CtMatch> {
  return runWrite(["ctMatches", "ctFormats", "ctSessions", "figurePlayerProfiles", "figurePlayerSnapshots", "settings"], async tx => {
    const existing = input.id ? await tx.get("ctMatches", input.id) : undefined;
    if (input.id && !existing) throw new SaveError(["That match no longer exists."]);
    const settings = await tx.get("settings", "settings");
    const { id: _id, ...fields } = input;
    const record = parseOrThrow(ctMatchSchema, {
      ...(existing ?? newRecordBase()),
      ...fields,
      gameVersion: input.gameVersion ?? existing?.gameVersion ?? settings?.gameVersion,
      notes: clean(input.notes),
      updatedAt: nowIso(),
    });
    const problems = checkCtMatch(record, await lookups(tx));
    if (problems.length) throw new SaveError(problems);
    await tx.put("ctMatches", record);
    return record;
  });
}

export async function deleteCtMatch(id: ID): Promise<void> {
  await runWrite(["ctMatches"], tx => tx.delete("ctMatches", id));
}

export async function setCtMatchIncluded(id: ID, includeInStats: boolean): Promise<void> {
  await runWrite(["ctMatches"], async tx => {
    const m = await tx.get("ctMatches", id);
    if (m) await tx.put("ctMatches", { ...m, includeInStats, updatedAt: nowIso() });
  });
}

export type StadiumRunInput = Omit<StadiumRun, "id" | "createdAt" | "updatedAt"> & { id?: ID };

export async function saveStadiumRun(input: StadiumRunInput): Promise<StadiumRun> {
  return runWrite(["stadiumRuns", "ctFormats", "ctSessions", "figurePlayerProfiles", "figurePlayerSnapshots", "settings"], async tx => {
    const existing = input.id ? await tx.get("stadiumRuns", input.id) : undefined;
    if (input.id && !existing) throw new SaveError(["That stadium run no longer exists."]);
    const settings = await tx.get("settings", "settings");
    const { id: _id, ...fields } = input;
    const record = parseOrThrow(stadiumRunSchema, {
      ...(existing ?? newRecordBase()),
      ...fields,
      gameVersion: input.gameVersion ?? existing?.gameVersion ?? settings?.gameVersion,
      notes: clean(input.notes),
      updatedAt: nowIso(),
    });
    const problems = checkStadiumRun(record, await lookups(tx));
    if (problems.length) throw new SaveError(problems);
    await tx.put("stadiumRuns", record);
    return record;
  });
}

export async function deleteStadiumRun(id: ID): Promise<void> {
  await runWrite(["stadiumRuns"], tx => tx.delete("stadiumRuns", id));
}

// -------------------------------------------------------------
// Machine proficiency
// -------------------------------------------------------------

/** Save an amiibo's proficiency. Only machines below 100 are stored; all maxed = nothing stored. */
export async function setProficiency(profileId: ID, values: Record<string, number>): Promise<void> {
  await runWrite(["figurePlayerProfiles"], async tx => {
    const p = await tx.get("figurePlayerProfiles", profileId);
    if (!p) throw new SaveError(["That amiibo no longer exists."]);
    const below: Record<string, number> = {};
    for (const [k, v] of Object.entries(values)) {
      if (!SCANNABLE_MACHINE_IDS.includes(k)) continue;
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new SaveError([`${CT_MACHINE_BY_ID.get(k)?.name}: proficiency runs from 0 to 100.`]);
      if (n < 100) below[k] = n;
    }
    const { machineProficiency: _old, ...rest } = p;
    await tx.put("figurePlayerProfiles", parseOrThrow(profileSchema, {
      ...rest,
      ...(Object.keys(below).length ? { machineProficiency: below } : {}),
      updatedAt: nowIso(),
    }));
  });
}
