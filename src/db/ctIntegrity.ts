// =============================================================
// City Trial integrity checks: references, places and stadium rules
// that a per-record schema can't see. Run before every save and on
// import, like the race checks.
// =============================================================

import { FIELD_CHANGE_BY_ID, FIELD_EVENT_BY_ID, GIGANTES_ID, MAX_FLOATING_ISLANDS, SCANNABLE_MACHINE_IDS, STADIUM_BY_ID, CT_MACHINE_BY_ID } from "../domain/cityTrial";
import type { CtEntry, CtFormat, CtMatch, CtSession, StadiumRun } from "../domain/cityTrial";
import type { FigurePlayerProfile, FigurePlayerSnapshot, ID } from "../domain/schema";

export interface CtLookups {
  ctFormats: Map<ID, CtFormat>;
  ctSessions: Map<ID, CtSession>;
  profiles: Map<ID, FigurePlayerProfile>;
  snapshots: Map<ID, FigurePlayerSnapshot>;
}

function checkRacer(e: { profileId: ID; snapshotId: ID; riderId: ID }, L: CtLookups, who: string, add: (s: string) => void) {
  const p = L.profiles.get(e.profileId);
  if (!p) { add(`${who}: amiibo doesn't exist.`); return; }
  const s = L.snapshots.get(e.snapshotId);
  if (!s || s.profileId !== p.id) add(`${who}: amiibo version doesn't match the amiibo.`);
  if (e.riderId !== p.riderId) add(`${who}: rider doesn't match the amiibo.`);
}

export function checkCtMatch(m: CtMatch, L: CtLookups): string[] {
  const problems: string[] = [];
  const add = (s: string) => problems.push(s);
  const where = `City Trial match ${m.id.slice(0, 8)}`;
  if (!L.ctFormats.has(m.formatId)) add(`${where}: its format doesn't exist.`);
  if (m.sessionId) {
    const s = L.ctSessions.get(m.sessionId);
    if (!s) add(`${where}: its session doesn't exist.`);
    else if (s.formatId !== m.formatId) add(`${where}: it's in a session with a different format.`);
  }
  if (m.stadiumId && !STADIUM_BY_ID.has(m.stadiumId)) add(`${where}: unknown stadium.`);
  if (m.room2?.stadiumId && !STADIUM_BY_ID.has(m.room2.stadiumId)) add(`${where}: unknown second stadium.`);
  if (m.room2 && m.stadiumId === GIGANTES_ID) add(`${where}: VS. Gigantes holds every rider, so the match can't split.`);
  if (m.entries.length > m.riderCount) add(`${where}: more amiibo logged (${m.entries.length}) than riders in the match (${m.riderCount}).`);
  if (m.room2 && m.room2.riders >= m.riderCount) add(`${where}: the second stadium can't hold every rider.`);

  const seen = new Set<ID>();
  const giants = m.entries.filter(e => e.isGigantes).length;
  if (giants > 1) add(`${where}: only one rider can drive Gigantes.`);
  if (giants && m.stadiumId !== GIGANTES_ID) add(`${where}: a Gigantes driver is marked, but the stadium isn't VS. Gigantes.`);
  for (const e of m.entries) {
    const who = `${where}, ${L.profiles.get(e.profileId)?.nickname ?? "an amiibo"}`;
    checkRacer(e, L, who, add);
    if (seen.has(e.profileId)) add(`${who}: logged twice in one match.`);
    seen.add(e.profileId);
    checkEntryPlace(m, e, who, add);
    if (e.room === 2 && !m.room2) add(`${who}: marked as in the second stadium, but the match didn't split.`);
    if (e.machineId && !CT_MACHINE_BY_ID.has(e.machineId)) add(`${who}: unknown machine.`);
    if (e.scannedMachineId && !SCANNABLE_MACHINE_IDS.includes(e.scannedMachineId)) add(`${who}: only machines with amiibo figures can be scanned in.`);
    for (const k of Object.keys(e.eventPlaces ?? {})) {
      if (!FIELD_EVENT_BY_ID.get(k)?.hasPlacements) add(`${who}: a place was logged for an event without places.`);
      else if (!(m.fieldEvents ?? []).includes(k)) add(`${who}: a place was logged for an event that isn't ticked.`);
    }
  }
  for (const k of m.fieldEvents ?? []) if (!FIELD_EVENT_BY_ID.has(k)) add(`${where}: unknown field event.`);
  let islands = 0;
  for (const k of m.fieldChanges ?? []) {
    const c = FIELD_CHANGE_BY_ID.get(k);
    if (!c) add(`${where}: unknown field change.`);
    else if (c.island) islands++;
  }
  if (islands > MAX_FLOATING_ISLANDS) add(`${where}: at most ${MAX_FLOATING_ISLANDS} floating islands can appear.`);
  return problems;
}

function checkEntryPlace(m: CtMatch, e: CtEntry, who: string, add: (s: string) => void) {
  if (e.place === null) return;
  const size = !m.room2 ? m.riderCount : e.room === 2 ? m.room2.riders : m.riderCount - m.room2.riders;
  if (e.place > size) add(`${who}: placed ${e.place} of only ${size}.`);
}

export function checkStadiumRun(r: StadiumRun, L: CtLookups): string[] {
  const problems: string[] = [];
  const add = (s: string) => problems.push(s);
  const where = `Stadium run ${r.id.slice(0, 8)}`;
  const stadium = STADIUM_BY_ID.get(r.stadiumId);
  if (!stadium) add(`${where}: unknown stadium.`);
  else if (r.players > stadium.maxPlayers) add(`${where}: ${stadium.name} holds at most ${stadium.maxPlayers} riders.`);
  if (r.entries.length > r.players) add(`${where}: more amiibo logged than riders in the stadium.`);
  const seen = new Set<ID>();
  for (const e of r.entries) {
    const who = `${where}, ${L.profiles.get(e.profileId)?.nickname ?? "an amiibo"}`;
    checkRacer(e, L, who, add);
    if (seen.has(e.profileId)) add(`${who}: logged twice.`);
    seen.add(e.profileId);
    if (e.place !== undefined && e.place > r.players) add(`${who}: placed ${e.place} of only ${r.players}.`);
    if (e.machineId && !CT_MACHINE_BY_ID.has(e.machineId)) add(`${who}: unknown machine.`);
    if (e.scannedMachineId && !SCANNABLE_MACHINE_IDS.includes(e.scannedMachineId)) add(`${who}: only machines with amiibo figures can be scanned in.`);
  }
  return problems;
}

export function checkCtSession(s: CtSession, L: CtLookups): string[] {
  return L.ctFormats.has(s.formatId) ? [] : [`City Trial session "${s.name}" points at a missing format.`];
}
