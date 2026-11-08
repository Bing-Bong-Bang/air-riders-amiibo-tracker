import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, Ref } from "react";
import { getAll, getAllByIndex, getById } from "../db/database";
import { saveRace } from "../db/repo";
import type { RaceInput } from "../db/repo";
import { allowsRetirement, formatGameTime, formatGap, cpuSetupText, maxRidersFor } from "../domain/schema";
import type { FinishStatus, Format, ID, Millis, Placement, Race, RaceEntry, Session, Stage, TrackedMode } from "../domain/schema";
import { newId } from "../lib/ids";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { racerLabel, snapshotLabel, useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate, useLocation } from "../lib/router";
import { Checkbox, Field, SaveErrorNotice, Select, TextArea, TimeInput } from "../components/form";
import { Badge, Button, Card, CardHeader, Notice, Spinner, cx } from "../components/ui";

// -------------------------------------------------------------
// Draft state
// -------------------------------------------------------------

interface SeatDraft {
  key: string;                  // stable React key
  entryId?: ID;                 // set when editing an existing race
  profileId: ID;
  snapshotId: ID;
  /** Rider (Kirby color/special) raced as; "" = the amiibo's usual rider. */
  riderId: ID;
  machineId: ID;
  status: FinishStatus;
  timeMs: Millis | null;
  placement: Placement | null;
  laps: (Millis | null)[];
  showLaps: boolean;
  tagIds: ID[];
  include: boolean;
  notes: string;
}

interface RaceDraft {
  formatId: ID;
  stageId: ID;
  /** Riders in the race, CPUs included. Used when the format allows any number. */
  riderCount: number;
  seats: SeatDraft[];
  include: boolean;
  glitch: boolean;
  firstPlaceTimeMs: Millis | null;
  notes: string;
}

const STATUS_LABEL: Record<FinishStatus, string> = { finished: "Finished", retired: "Retired", dnf: "DNF", dq: "DQ" };

function blankSeat(prev?: SeatDraft): SeatDraft {
  return {
    key: newId(), profileId: prev?.profileId ?? "", snapshotId: prev?.snapshotId ?? "", riderId: prev?.riderId ?? "", machineId: prev?.machineId ?? "",
    status: "finished", timeMs: null, placement: null, laps: [], showLaps: prev?.showLaps ?? false, tagIds: [], include: true, notes: "",
  };
}

/** Keep the seat setup (amiibo, machine, splits toggle), clear the results. */
function clearResults(d: RaceDraft): RaceDraft {
  return { ...d, seats: d.seats.map(s => blankSeat(s)), glitch: false, firstPlaceTimeMs: null, notes: "" };
}

function resizeSeats(seats: SeatDraft[], n: number): SeatDraft[] {
  return n <= seats.length ? seats.slice(0, n) : [...seats, ...Array.from({ length: n - seats.length }, () => blankSeat())];
}

// ---- remembered setup per mode ----
const SETUP_KEY = (mode: TrackedMode) => `air-riders-tracker.logSetup.${mode}`;
interface SavedSetup { formatId: ID; stageId: ID; riderCount?: number; seats: { profileId: ID; riderId?: ID; machineId: ID; showLaps: boolean }[] }

function loadSetup(mode: TrackedMode): SavedSetup | null {
  try { return JSON.parse(localStorage.getItem(SETUP_KEY(mode)) ?? "null") as SavedSetup | null; } catch { return null; }
}
function storeSetup(mode: TrackedMode, d: RaceDraft): void {
  try {
    localStorage.setItem(SETUP_KEY(mode), JSON.stringify({
      formatId: d.formatId, stageId: d.stageId, riderCount: d.riderCount,
      seats: d.seats.map(s => ({ profileId: s.profileId, riderId: s.riderId, machineId: s.machineId, showLaps: s.showLaps })),
    } satisfies SavedSetup));
  } catch { /* storage unavailable */ }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---- the session you're logging into (per mode), and its "counts in records" choice ----
const ACTIVE_SESSION_KEY = (mode: TrackedMode) => `air-riders-tracker.activeSession.${mode}`;
const COUNTS_KEY = (sessionId: ID) => `air-riders-tracker.sessionCounts.${sessionId}`;

export function setActiveSession(mode: TrackedMode, sessionId: ID | null): void {
  try { if (sessionId) localStorage.setItem(ACTIVE_SESSION_KEY(mode), sessionId); else localStorage.removeItem(ACTIVE_SESSION_KEY(mode)); } catch { /* storage unavailable */ }
}
function getActiveSession(mode: TrackedMode): ID | null {
  try { return localStorage.getItem(ACTIVE_SESSION_KEY(mode)); } catch { return null; }
}
/** Session races count in records unless you untick it; the choice sticks per session. */
function loadCounts(sessionId: ID): boolean {
  try { return localStorage.getItem(COUNTS_KEY(sessionId)) !== "0"; } catch { return true; }
}
function storeCounts(sessionId: ID, v: boolean): void {
  try { localStorage.setItem(COUNTS_KEY(sessionId), v ? "1" : "0"); } catch { /* storage unavailable */ }
}

/** How many amiibo a race of this format logs, given what's in use now. */
function seatCountFor(format: Format | undefined, current: number): number {
  if (!format) return 1;
  return format.flexibleSeats ? clamp(current, 1, format.trackedSeats) : format.trackedSeats;
}

function lapsFor(format: Format | undefined, stage: Stage | undefined): number {
  const l = format?.settings.laps;
  return typeof l === "number" ? l : stage?.defaultLaps ?? 3;
}

function stagesFor(format: Format | undefined, ref_: Reference): Stage[] {
  if (format?.runStructure.kind === "course_set") {
    const allowed = new Set(format.runStructure.stageIds);
    return ref_.stages.filter(s => allowed.has(s.id));
  }
  return ref_.stages.filter(s => !s.isArchived);
}

function latestSnapshotId(ref_: Reference, profileId: ID): ID {
  return ref_.snapshotsByProfile.get(profileId)?.[0]?.id ?? "";
}

/**
 * Build the initial draft: remembered setup, else the default rules (or
 * the record format) and the first stage. `presetProfileId` (from an amiibo's "New data entry"
 * button) goes in racer 1.
 */
function initialDraft(mode: TrackedMode, ref_: Reference, presetProfileId?: ID | null): RaceDraft {
  const saved = loadSetup(mode);
  const formats = ref_.formats.filter(f => !f.isArchived);
  const format = formats.find(f => f.id === saved?.formatId)
    ?? formats.find(f => f.isDefaultRules)
    ?? formats.find(f => f.id === ref_.settings?.recordFormatIds[mode]) ?? formats[0];
  const stages = stagesFor(format, ref_);
  const stage = stages.find(s => s.id === saved?.stageId) ?? stages[0];
  const n = seatCountFor(format, saved?.seats.length ?? 1);
  const active = new Set(ref_.profiles.filter(p => p.status === "active").map(p => p.id));
  const seats = Array.from({ length: n }, (_, i) => {
    const s = saved?.seats[i];
    const seat = blankSeat();
    if (s && active.has(s.profileId)) {
      seat.profileId = s.profileId;
      seat.snapshotId = latestSnapshotId(ref_, s.profileId);
    }
    if (s && ref_.machineById.has(s.machineId)) seat.machineId = s.machineId;
    seat.showLaps = s?.showLaps ?? false;
    return seat;
  });
  const preset = presetProfileId ? ref_.profileById.get(presetProfileId) : undefined;
  if (preset && preset.status === "active" && seats.length) {
    // Move it to racer 1; clear any other seat already holding it.
    seats.forEach(seat => { if (seat.profileId === preset.id) { seat.profileId = ""; seat.snapshotId = ""; seat.riderId = ""; } });
    seats[0].profileId = preset.id;
    seats[0].riderId = "";
    seats[0].snapshotId = latestSnapshotId(ref_, preset.id);
  }
  const riderCount = clamp(saved?.riderCount ?? Math.max(n, 2), n, format ? maxRidersFor(format.mode) : 6);
  return { formatId: format?.id ?? "", stageId: stage?.id ?? "", riderCount, seats, include: true, glitch: false, firstPlaceTimeMs: null, notes: "" };
}

function draftFromRace(race: Race): RaceDraft {
  return {
    formatId: race.formatId,
    stageId: race.stageId,
    riderCount: race.riderCount ?? race.entries.length,
    include: race.includeInStats,
    glitch: race.glitchOccurred ?? false,
    firstPlaceTimeMs: race.firstPlaceTimeMs ?? null,
    notes: race.notes ?? "",
    seats: race.entries.map(e => ({
      key: newId(),
      entryId: e.id,
      profileId: e.racer.kind === "amiibo" ? e.racer.profileId : "",
      snapshotId: e.racer.kind === "amiibo" ? e.racer.snapshotId : "",
      riderId: e.riderId,
      machineId: e.machineId,
      status: e.status,
      timeMs: e.finishTimeMs,
      placement: e.placement ?? null,
      laps: e.lapTimesMs ?? [],
      showLaps: (e.lapTimesMs?.length ?? 0) > 0,
      tagIds: e.incidentTagIds ?? [],
      include: e.includeInStats,
      notes: e.notes ?? "",
    })),
  };
}

// -------------------------------------------------------------
// One racer row
// -------------------------------------------------------------

function SeatEditor({ seat, index, total, format, stage, ref_, onChange, timeRef, showPlacement, maxPlace }: {
  seat: SeatDraft; index: number; total: number; format: Format; stage: Stage | undefined; ref_: Reference;
  onChange: (s: SeatDraft) => void; timeRef?: Ref<HTMLInputElement>; showPlacement: boolean; maxPlace: number;
}) {
  const set = <K extends keyof SeatDraft>(k: K, v: SeatDraft[K]) => onChange({ ...seat, [k]: v });
  const profile = ref_.profileById.get(seat.profileId);
  const snaps = ref_.snapshotsByProfile.get(seat.profileId) ?? [];
  const lapCount = lapsFor(format, stage);
  const laps = Array.from({ length: lapCount }, (_, i) => seat.laps[i] ?? null);
  const lapSum = laps.every(l => l !== null) ? (laps as Millis[]).reduce((a, b) => a + b, 0) : null;
  const pid = `seat-${seat.key}`;

  // Active amiibo grouped by rider; keep a retired one visible if it's already selected (editing).
  const groups = ref_.riders
    .map(r => ({ rider: r, profiles: ref_.profiles.filter(p => p.riderId === r.id && (p.status === "active" || p.id === seat.profileId)) }))
    .filter(g => g.profiles.length);

  return (
    <div className={cx("space-y-4", total > 1 && "rounded-xl border border-night-700 p-4")}>
      {total > 1 && <h3 className="text-sm font-semibold text-night-300">Racer {index + 1}</h3>}
      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <Field label="Amiibo" htmlFor={`${pid}-amiibo`} hint={profile ? ref_.riderById.get(profile.riderId)?.name : undefined}>
          <Select id={`${pid}-amiibo`} value={seat.profileId} onChange={e => onChange({ ...seat, profileId: e.target.value, snapshotId: latestSnapshotId(ref_, e.target.value), riderId: "" })}>
            <option value="">Choose…</option>
            {groups.map(g => (
              <optgroup key={g.rider.id} label={g.rider.name}>
                {g.profiles.map(p => <option key={p.id} value={p.id}>{p.nickname}{p.isBaseline ? " (baseline)" : ""}{p.status === "retired" ? " (retired)" : ""}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        {snaps.length > 1 && (
          <Field label="Amiibo version" htmlFor={`${pid}-snap`} hint="Goes up when a retrain changes its personality">
            <Select id={`${pid}-snap`} value={seat.snapshotId} onChange={e => set("snapshotId", e.target.value)}>
              {snaps.map((s, i) => <option key={s.id} value={s.id}>{snapshotLabel(s)}{i === 0 ? " (latest)" : ""}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Machine" htmlFor={`${pid}-machine`}>
          <Select id={`${pid}-machine`} value={seat.machineId} onChange={e => set("machineId", e.target.value)}>
            <option value="">Choose…</option>
            {ref_.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,10rem)_1fr] sm:items-start">
        <Field label="Finish time" htmlFor={`${pid}-time`}>
          <TimeInput
            id={`${pid}-time`}
            inputRef={timeRef}
            value={seat.timeMs}
            onChange={v => set("timeMs", v)}
            disabled={seat.status !== "finished"}
          />
        </Field>
        {showPlacement && (
          <Field label={format.scoring === "placement" ? "Place" : "Place (optional)"} htmlFor={`${pid}-place`}>
            <Select id={`${pid}-place`} value={seat.placement ?? ""} onChange={e => set("placement", e.target.value ? (Number(e.target.value) as Placement) : null)}>
              <option value="">—</option>
              {Array.from({ length: maxPlace }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}{["st", "nd", "rd"][n - 1] ?? "th"}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-6">
          {(allowsRetirement(format) || seat.status !== "finished") && (
            <Checkbox checked={seat.status !== "finished"} label="Retired"
              onChange={v => onChange({ ...seat, status: v ? (seat.status !== "finished" ? seat.status : "retired") : "finished", timeMs: v ? null : seat.timeMs })} />
          )}
          <Checkbox checked={seat.showLaps} onChange={v => set("showLaps", v)} label="Lap splits" />
        </div>
      </div>

      {seat.showLaps && (
        <div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {laps.map((lap, i) => (
              <Field key={i} label={`Lap ${i + 1}`} htmlFor={`${pid}-lap-${i}`}>
                <TimeInput
                  id={`${pid}-lap-${i}`}
                  value={lap}
                  onChange={v => {
                    const next = [...laps];
                    next[i] = v;
                    const sum = next.every(x => x !== null) ? (next as Millis[]).reduce((a, b) => a + b, 0) : null;
                    onChange({ ...seat, laps: next, timeMs: seat.timeMs === null && sum !== null && seat.status === "finished" ? sum : seat.timeMs });
                  }}
                />
              </Field>
            ))}
          </div>
          {lapSum !== null && seat.timeMs !== null && lapSum !== seat.timeMs && (
            <p className="text-xs text-bad-400">Splits add up to {formatGameTime(lapSum)}, not {formatGameTime(seat.timeMs)}.</p>
          )}
        </div>
      )}


      <Field label="Notes" htmlFor={`${pid}-notes`}>
        <TextArea id={`${pid}-notes`} rows={1} value={seat.notes} onChange={e => set("notes", e.target.value)} placeholder="Anything worth remembering about this run" />
      </Field>
    </div>
  );
}

// -------------------------------------------------------------
// Recent races on this stage
// -------------------------------------------------------------

function RecentPanel({ formatId, stageId, ref_, highlightId, session }: { formatId: ID; stageId: ID; ref_: Reference; highlightId: ID | null; session: Session | null }) {
  const { data } = useLiveQuery(
    async () => (session ? getAllByIndex("races", "sessionId", session.id)
      : formatId && stageId ? getAllByIndex("races", "formatId_stageId", [formatId, stageId]) : []),
    [formatId, stageId, session?.id], ["races"],
  );
  const races = (data ?? []).slice().sort((a, b) => b.racedAt.localeCompare(a.racedAt));
  const counted = races.filter(r => session || r.includeInStats).flatMap(r => r.entries.filter(e => e.includeInStats && e.finishTimeMs !== null));
  const best = counted.reduce<RaceEntry | null>((b, e) => (!b || Number(e.finishTimeMs) < Number(b.finishTimeMs) ? e : b), null);
  const stage = ref_.stageById.get(stageId);
  const who = (e: RaceEntry) => {
    const name = e.racer.kind === "amiibo" ? racerLabel(ref_, e.racer.profileId, e.riderId) : "Player";
    return `${name} · ${ref_.machineById.get(e.machineId)?.name ?? "?"}`;
  };

  return (
    <Card>
      <CardHeader title={session ? session.name : stage ? stage.name : "Recent races"}
        subtitle={session ? `${races.length} race${races.length === 1 ? "" : "s"} in this session` : `${races.length} race${races.length === 1 ? "" : "s"} in this format`} />
      {best && (
        <div className="mb-4 rounded-xl border border-star-400/30 bg-star-400/5 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wider text-star-400">{session ? "Best in this session" : "Best counted time"}</div>
          <div className="font-mono text-2xl font-semibold tabular">{formatGameTime(best.finishTimeMs)}</div>
          <div className="text-sm text-night-300">{who(best)}</div>
        </div>
      )}
      {races.length === 0 ? (
        <p className="text-sm text-night-400">Nothing logged here yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {races.slice(0, 10).map(r => (
            <li key={r.id} className={cx("rounded-lg px-3 py-2 text-sm", r.id === highlightId ? "bg-ok-400/10 ring-1 ring-ok-400/40" : "bg-night-850", !r.includeInStats && "opacity-50")}>
              {r.entries.map(e => (
                <div key={e.id} className="flex justify-between gap-2">
                  <span className="truncate text-night-300">{e.placement ? `${e.placement}. ` : ""}{who(e)}</span>
                  <span className="font-mono tabular">{e.finishTimeMs !== null ? formatGameTime(e.finishTimeMs) : e.status === "finished" ? "—" : STATUS_LABEL[e.status]}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// -------------------------------------------------------------
// Page
// -------------------------------------------------------------

function LogRaceForm({ mode, ref_, editRace, presetProfileId, presetSessionId }: {
  mode: TrackedMode; ref_: Reference; editRace: Race | null; presetProfileId: ID | null; presetSessionId: ID | null;
}) {
  const allSessionsQ = useLiveQuery(() => getAll("sessions"), [], ["sessions"]);
  const sessionsQ = { data: allSessionsQ.data?.filter(s => s.status !== "complete") };
  const [sessionId, setSessionId] = useState<ID>(() => editRace?.sessionId ?? presetSessionId ?? getActiveSession(mode) ?? "");
  const [d, setD] = useState<RaceDraft>(() => {
    const base = editRace ? draftFromRace(editRace) : initialDraft(mode, ref_, presetProfileId);
    return !editRace && sessionId ? { ...base, include: loadCounts(sessionId) } : base;
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Race | null>(null);
  const firstTimeRef = useRef<HTMLInputElement>(null);

  const formats = ref_.formats.filter(f => !f.isArchived || f.id === d.formatId);
  const format = ref_.formatById.get(d.formatId);
  const openSessions = (sessionsQ.data ?? []).filter(s => (s.mode ?? ref_.formatById.get(s.formatId)?.mode) === mode);
  const session = sessionId ? (sessionsQ.data ?? []).find(s => s.id === sessionId) ?? null : null;
  const sessionRaceCount = useLiveQuery(async () => (sessionId ? (await getAllByIndex("races", "sessionId", sessionId)).length : 0), [sessionId], ["races"]).data ?? 0;
  // A finished or deleted session can't take new races: drop back to none.
  useEffect(() => {
    if (!editRace && sessionId && sessionsQ.data && !session) { setSessionId(""); setActiveSession(mode, null); setD(prev => ({ ...prev, include: true })); }
  }, [editRace, sessionId, sessionsQ.data, session, mode]);
  // The session decides the format.
  useEffect(() => { if (session && session.formatId !== d.formatId) setFormat(session.formatId); }, [session?.formatId]); // eslint-disable-line react-hooks/exhaustive-deps
  const chooseSession = (id: ID) => {
    setSessionId(id);
    setActiveSession(mode, id || null);
    setD(prev => ({ ...prev, include: id ? loadCounts(id) : true }));
  };
  const stages = stagesFor(format, ref_);
  const stage = ref_.stageById.get(d.stageId);
  const ridersFixed = format?.settings.numberOfRiders ?? null;
  const riders = ridersFixed ?? Math.max(d.riderCount, d.seats.length);
  // Places matter when ranked by place, or when anyone besides the rules' required CPU is racing.
  const showPlacement = !!format && (format.scoring === "placement" || riders - (format.fillerCpu?.count ?? 0) > 1);
  const anyPlaced = d.seats.some(s => s.placement !== null);
  const showFirstTime = showPlacement && anyPlaced && !d.seats.some(s => s.placement === 1);

  const setFormat = (formatId: ID) => {
    const f = ref_.formatById.get(formatId);
    const st = stagesFor(f, ref_);
    setD(prev => {
      const n = seatCountFor(f, prev.seats.length);
      return {
        ...prev, formatId, stageId: st.some(s => s.id === prev.stageId) ? prev.stageId : st[0]?.id ?? "",
        seats: resizeSeats(prev.seats, n), riderCount: Math.max(prev.riderCount, n),
      };
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!format) return setError(new Error("Pick a format."));
    if (!d.stageId) return setError(new Error("Pick a stage."));
    for (const [i, s] of d.seats.entries()) {
      const who = d.seats.length > 1 ? `Racer ${i + 1}: ` : "";
      if (!s.profileId || !s.snapshotId) return setError(new Error(`${who}choose an amiibo.`));
      if (!s.machineId) return setError(new Error(`${who}choose a machine.`));
      if (s.status === "finished" && s.timeMs === null && format.scoring === "time" && !(showPlacement && s.placement !== null)) {
        return setError(new Error(`${who}enter a finish time like 01:25.72${showPlacement ? ", or just a place" : ""}.`));
      }
      if (s.showLaps && s.laps.some(l => l !== null) && s.laps.slice(0, lapsFor(format, stage)).some(l => l === null)) {
        return setError(new Error(`${who}fill in every lap split, or untick lap splits.`));
      }
    }

    const input: RaceInput = {
      id: editRace?.id,
      mode,
      formatId: d.formatId,
      stageId: d.stageId,
      racedAt: editRace?.racedAt ?? new Date().toISOString(),
      riderCount: ridersFixed === null ? riders : undefined,
      runId: editRace?.runId,
      testSetId: editRace?.testSetId,
      keepInRecords: editRace?.keepInRecords,
      gameVersion: editRace?.gameVersion,
      sessionId: editRace ? editRace.sessionId : sessionId || undefined,
      includeInStats: d.include,
      glitchOccurred: d.glitch || undefined,
      firstPlaceTimeMs: showFirstTime && d.firstPlaceTimeMs !== null ? d.firstPlaceTimeMs : undefined,
      notes: d.notes,
      entries: d.seats.map(s => {
        const profile = ref_.profileById.get(s.profileId);
        const laps = s.showLaps ? s.laps.slice(0, lapsFor(format, stage)).filter((l): l is Millis => l !== null) : [];
        const original = editRace?.entries.find(e2 => e2.id === s.entryId);
        return {
          id: s.entryId ?? newId(),
          racer: { kind: "amiibo", profileId: s.profileId, snapshotId: s.snapshotId },
          riderId: profile?.riderId || "",   // an amiibo's color (and special) is fixed when it's added
          machineId: s.machineId,
          placement: showPlacement && s.placement !== null ? s.placement : undefined,
          status: s.status,
          finishTimeMs: s.status === "finished" ? s.timeMs : null,
          lapTimesMs: laps.length ? laps : undefined,
          includeInStats: s.include,
          testSetSeatId: original?.testSetSeatId,
          incidentTagIds: s.tagIds.length ? s.tagIds : undefined,
          notes: s.notes,
        };
      }),
    };

    setBusy(true);
    try {
      const race = await saveRace(input);
      if (editRace) {
        navigate("races");
        return;
      }
      storeSetup(mode, d);
      if (sessionId) storeCounts(sessionId, d.include);
      setSaved(race);
      setD(clearResults(d));
      requestAnimationFrame(() => firstTimeRef.current?.focus());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };


  const savedSummary = saved && saved.entries.map(e => {
    const name = e.racer.kind === "amiibo" ? racerLabel(ref_, e.racer.profileId, e.riderId) : "?";
    const result = e.finishTimeMs !== null ? formatGameTime(e.finishTimeMs) : STATUS_LABEL[e.status];
    const gap = e.gapToFirstMs ? ` (${formatGap(e.gapToFirstMs)})` : "";
    return `${e.placement ? `${e.placement}. ` : ""}${name} ${result}${gap}`;
  }).join(" · ");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={submit} className="space-y-6" noValidate>
        {(openSessions.length > 0 || session) && !editRace && (
          <Card className={cx("p-4", session && "border-air-500/40 bg-air-500/5")}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Field label="Session" htmlFor="lr-session" className="min-w-64">
                <Select id="lr-session" value={sessionId} onChange={e => chooseSession(e.target.value)}>
                  <option value="">None (ordinary race)</option>
                  {openSessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </Field>
              {session && (
                <div className="flex flex-wrap items-center gap-3 pb-2 text-sm">
                  <span className="text-night-300">{sessionRaceCount} race{sessionRaceCount === 1 ? "" : "s"} so far</span>
                  <Link to="session" params={{ id: session.id }} className="font-semibold text-air-400 hover:underline">View session →</Link>
                </div>
              )}
            </div>
          </Card>
        )}
        {editRace?.sessionId && (
          <p className="text-sm text-night-400">This race is in the session "{allSessionsQ.data?.find(s => s.id === editRace.sessionId)?.name ?? "?"}".</p>
        )}
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Format" htmlFor="lr-format" hint={session ? "Set by the session" : undefined}>
              <Select id="lr-format" value={d.formatId} onChange={e => setFormat(e.target.value)} disabled={!!editRace || !!session}>
                {formats.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === ref_.settings?.recordFormatIds[mode] ? " ★" : ""}</option>)}
              </Select>
            </Field>
            <Field label="Stage" htmlFor="lr-stage" hint={stage ? `${lapsFor(format, stage)} lap${lapsFor(format, stage) === 1 ? "" : "s"}` : undefined}>
              <Select id="lr-stage" value={d.stageId} onChange={e => setD(prev => ({ ...prev, stageId: e.target.value, seats: prev.seats.map(s => ({ ...s, tagIds: [] })) }))}>
                {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            {format?.flexibleSeats && (
              <Field label="Your amiibo in this race" htmlFor="lr-seats">
                <Select id="lr-seats" value={d.seats.length} onChange={e => {
                  const n = Number(e.target.value);
                  setD(prev => ({ ...prev, seats: resizeSeats(prev.seats, n), riderCount: Math.max(prev.riderCount, n) }));
                }}>
                  {Array.from({ length: format.trackedSeats }, (_, i) => i + 1).map(k => <option key={k} value={k}>{k}</option>)}
                </Select>
              </Field>
            )}
            {format && ridersFixed === null && (
              <Field label="Riders in this race" hint="CPUs included" htmlFor="lr-riders">
                <Select id="lr-riders" value={riders} onChange={e => setD(prev => ({ ...prev, riderCount: Number(e.target.value) }))}>
                  {Array.from({ length: maxRidersFor(format.mode) }, (_, i) => i + 1).filter(k => k >= d.seats.length).map(k => <option key={k} value={k}>{k}</option>)}
                </Select>
              </Field>
            )}
          </div>
          {format?.fillerCpu && (
            <p className="mt-3 text-sm text-night-400">
              Setup: {cpuSetupText(format.fillerCpu, ref_.riderById.get(format.fillerCpu.riderId), ref_.machineById.get(format.fillerCpu.machineId))}. Not logged.
            </p>
          )}
          <p className="mt-2 text-xs text-night-400">
            Game version <span className="font-semibold text-night-300">{editRace?.gameVersion ?? ref_.settings?.gameVersion ?? "not set"}</span>
          </p>
        </Card>

        {format && (
          <Card>
            <div className="space-y-4">
              {d.seats.map((seat, i) => (
                <SeatEditor
                  key={seat.key}
                  seat={seat}
                  index={i}
                  total={d.seats.length}
                  format={format}
                  stage={stage}
                  ref_={ref_}
                  timeRef={i === 0 ? firstTimeRef : undefined}
                  showPlacement={showPlacement}
                  maxPlace={riders}
                  onChange={next => setD(prev => ({ ...prev, seats: prev.seats.map((s, j) => (j === i ? next : s)) }))}
                />
              ))}
              {showFirstTime && (
                <Field label="1st place time (optional)" hint="A CPU won? Enter its time so gaps to 1st still work." htmlFor="lr-first" className="max-w-xs">
                  <TimeInput id="lr-first" value={d.firstPlaceTimeMs} onChange={v => setD(prev => ({ ...prev, firstPlaceTimeMs: v }))} />
                </Field>
              )}
            </div>
          </Card>
        )}

        <SaveErrorNotice error={error} />
        {saved && !error && (
          <Notice tone="ok" title="Saved">
            {savedSummary}{saved.sessionId ? ` · ${saved.includeInStats ? "counts in records" : "session only"}` : ""}. Ready for the next race: same setup, results cleared.
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy || !format} className="px-6 py-2.5 text-base">
            {busy ? "Saving…" : editRace ? "Save changes" : "Save race"}
          </Button>
          {(session || editRace?.sessionId) && (
            <Checkbox checked={d.include} onChange={v => setD(prev => ({ ...prev, include: v }))} label="Counts in records" />
          )}
          {editRace && <Button variant="ghost" onClick={() => navigate("races")}>Cancel</Button>}
          <span className="text-xs text-night-400">Enter in a time box saves</span>
        </div>
      </form>

      <aside className="lg:sticky lg:top-20 lg:self-start">
        <RecentPanel formatId={d.formatId} stageId={d.stageId} ref_={ref_} highlightId={saved?.id ?? null} session={session} />
      </aside>
    </div>
  );
}

export function LogRacePage() {
  const { mode } = useMode();
  const { params } = useLocation();
  const editId = params.get("edit");
  const presetProfileId = params.get("amiibo");
  const presetSessionId = params.get("session");
  const { data: ref_, error, loading } = useReference(mode);
  const edit = useLiveQuery(async () => (editId ? (await getById("races", editId)) ?? null : null), [editId], []);

  // If an edit link points at a race from the other mode, follow it there.
  const { setMode } = useMode();
  useEffect(() => {
    if (edit.data && edit.data.mode !== mode) setMode(edit.data.mode);
  }, [edit.data, mode, setMode]);

  const activeProfiles = useMemo(() => ref_?.profiles.filter(p => p.status === "active").length ?? 0, [ref_]);

  if (error) return <Notice tone="bad" title="Couldn't load the race form">{error.message}</Notice>;
  if (loading || !ref_ || edit.loading) return <Spinner />;
  if (editId && !edit.data) return <Notice tone="bad" title="That race wasn't found">It may have been deleted. <Link to="races" className="underline">Back to races</Link></Notice>;

  const formats = ref_.formats.filter(f => !f.isArchived);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{edit.data ? "Edit race" : `Log a ${modeLabel(mode)} race`}</h1>
        {!edit.data && <p className="mt-1 text-night-300">After saving, the setup stays put so the next race is just a time and Enter.</p>}
      </div>
      {activeProfiles === 0 && !edit.data ? (
        <Notice title="Add an amiibo first">Races are logged for your amiibo. <Link to="amiibo" className="font-semibold text-air-400 underline">Go to Amiibo</Link></Notice>
      ) : formats.length === 0 && !edit.data ? (
        <Notice title={`No ${modeLabel(mode)} formats yet`}><Link to="formats" className="font-semibold text-air-400 underline">Create a format</Link> to log {modeLabel(mode)} races.</Notice>
      ) : edit.data && edit.data.mode !== mode ? (
        <Spinner />
      ) : (
        <LogRaceForm key={`${mode}-${editId ?? "new"}-${presetProfileId ?? ""}-${presetSessionId ?? ""}`} mode={mode} ref_={ref_} editRace={edit.data ?? null} presetProfileId={presetProfileId} presetSessionId={presetSessionId} />
      )}
      {!edit.data && <Badge>Tip: type times like 01:25.72, 1:25.72 or just 012572</Badge>}
    </div>
  );
}
