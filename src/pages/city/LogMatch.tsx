// Log one City Trial match. The quick path is: stadium, who played,
// their places. Stat totals, machines, KOs, stadium scores, field events
// and field changes are all optional and tucked away until opened.

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  FIELD_CHANGE_AREAS, FIELD_CHANGE_BY_ID, FIELD_EVENTS, GIGANTES_ID, MAX_FLOATING_ISLANDS, SCANNABLE_MACHINES, STADIUM_BY_ID, STAT_KEYS,
  placesFromScores, scoreValue,
  STAT_LABELS, STAT_MAX, STAT_MIN, fieldEventKey, ordinal, setState,
} from "../../domain/cityTrial";
import type { CtEntry, CtMatch, CtScores, StatKey } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import { saveCtMatch } from "../../db/ctRepo";
import type { Reference } from "../../hooks/useReference";
import { newId, nowIso } from "../../lib/ids";
import { navigate } from "../../lib/router";
import { Checkbox, Chip, Field, NumberInput, SaveErrorNotice, Select, TextArea } from "../../components/form";
import { Badge, Button, Card, CardHeader, Notice, cx } from "../../components/ui";
import { AmiiboPicker, MachineSelect, PlaceSelect, ScoreInputs, StadiumSelect, machineName, rulesLine, scoresText } from "./bits";
import type { CtData } from "./data";
import { memory } from "./data";

interface Row {
  place: number | null;
  statTotal: number | null;
  stats: Partial<Record<StatKey, number | null>>;
  machineId: string;
  scannedMachineId: string;
  kos: number | null;
  scores: CtScores;
  isGigantes: boolean;
  room2: boolean;
  eventPlaces: Record<string, number | null>;
  notes: string;
  open: boolean;
}

const emptyRow = (): Row => ({
  place: null, statTotal: null, stats: {}, machineId: "", scannedMachineId: "", kos: null, scores: {}, isGigantes: false, room2: false, eventPlaces: {}, notes: "", open: false,
});

function rowFromEntry(e: CtEntry): Row {
  return {
    place: e.place, statTotal: e.statTotal ?? null, stats: { ...(e.stats ?? {}) }, machineId: e.machineId ?? "", scannedMachineId: e.scannedMachineId ?? "", kos: e.kos ?? null,
    scores: { ...(e.scores ?? {}) }, isGigantes: !!e.isGigantes, room2: e.room === 2, eventPlaces: { ...(e.eventPlaces ?? {}) },
    notes: e.notes ?? "", open: false,
  };
}

const statSum = (stats: Row["stats"]) => {
  const vals = STAT_KEYS.map(k => stats[k]).filter((v): v is number => typeof v === "number");
  return { sum: vals.reduce((a, b) => a + b, 0), count: vals.length };
};

export function LogMatch({ ref_, data, editId, presetSession }: { ref_: Reference; data: CtData; editId: ID | null; presetSession: ID | null }) {
  const editing = editId ? data.matches.find(m => m.id === editId) : undefined;
  const liveFormats = data.formats.filter(f => !f.isArchived || f.id === editing?.formatId);
  const openSessions = data.sessions.filter(s => s.status !== "complete" || s.id === editing?.sessionId || s.id === presetSession);

  // Like Log race: a session you open stays the one you log into until you pick another or finish it.
  const usable = (id: ID | null | undefined) => !!id && data.sessionById.has(id) && data.sessionById.get(id)?.status !== "complete";
  const initialSession = editing ? editing.sessionId ?? ""
    : usable(presetSession) ? presetSession as ID
    : usable(memory.activeSession()) ? memory.activeSession() as ID
    : "";
  const [sessionId, setSessionIdState] = useState<ID | "">(initialSession);
  const [picked, setPicked] = useState(false);
  const setSessionId = (id: ID | "") => { setPicked(true); setSessionIdState(id); if (!editing) memory.setActiveSession(id || null); };
  // Opening a session's "Log a match" makes it the active one.
  useEffect(() => { if (!editing && presetSession) memory.setActiveSession(presetSession); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (editing) return;
    // A session finished or deleted elsewhere can't take new matches: drop back to none.
    if (sessionId && !usable(sessionId)) {
      if (data.sessionById.has(sessionId)) { setSessionIdState(""); memory.setActiveSession(null); }
      return;
    }
    // A session started a moment ago may arrive after this page opened: pick it up, unless you've chosen in the menu.
    if (!sessionId && !picked) {
      const want = usable(presetSession) ? presetSession : usable(memory.activeSession()) ? memory.activeSession() : null;
      if (want) setSessionIdState(want);
    }
  }, [data.sessions]); // eslint-disable-line react-hooks/exhaustive-deps
  const [formatId, setFormatId] = useState<ID>(() =>
    editing?.formatId
    ?? (initialSession ? data.sessionById.get(initialSession)?.formatId : undefined)
    ?? liveFormats.find(f => f.id === memory.lastFormat())?.id
    ?? liveFormats.find(f => f.isDefaultRules)?.id ?? liveFormats[0]?.id ?? "");
  const format = data.formatById.get(formatId);

  const activeIds = new Set(ref_.profiles.filter(p => p.status === "active" || editing?.entries.some(e => e.profileId === p.id)).map(p => p.id));
  const [picks, setPicks] = useState<ID[]>(() => editing ? editing.entries.map(e => e.profileId) : memory.lastPicks().filter(id => activeIds.has(id)));
  const [rows, setRows] = useState<Record<ID, Row>>(() => Object.fromEntries((editing?.entries ?? []).map(e => [e.profileId, rowFromEntry(e)])));
  const [stadiumId, setStadiumId] = useState<string | null>(editing?.stadiumId ?? null);
  const [riderCount, setRiderCount] = useState<number | null>(editing?.riderCount ?? null);
  const [split, setSplit] = useState(!!editing?.room2);
  const [room2Stadium, setRoom2Stadium] = useState<string | null>(editing?.room2?.stadiumId ?? null);
  const [room2Riders, setRoom2Riders] = useState<number | null>(editing?.room2?.riders ?? null);
  const [events, setEvents] = useState<string[]>(editing?.fieldEvents ?? []);
  const [changes, setChanges] = useState<string[]>(editing?.fieldChanges ?? []);
  const [showEvents, setShowEvents] = useState(!!editing?.fieldEvents?.length);
  const [showChanges, setShowChanges] = useState(!!editing?.fieldChanges?.length);
  const [counts, setCounts] = useState(editing ? editing.includeInStats : memory.sessionCounts(initialSession));
  const [tiebreaker, setTiebreaker] = useState(!!editing?.isTiebreaker);
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<CtMatch | null>(null);
  const [resetKey, setResetKey] = useState(0);

  // Picking a session fixes the format (a session never mixes rules).
  useEffect(() => {
    const s = sessionId ? data.sessionById.get(sessionId) : undefined;
    if (s && s.formatId !== formatId) setFormatId(s.formatId);
    if (!editing) setCounts(memory.sessionCounts(sessionId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const session = sessionId ? data.sessionById.get(sessionId) : undefined;
  const sessionMatches = useMemo(() => (sessionId ? data.matches.filter(m => m.sessionId === sessionId && m.id !== editId) : []), [data.matches, sessionId, editId]);
  const set = format && session ? setState(format, sessionMatches) : null;

  const riders = riderCount ?? Math.max(2, picks.length);
  const stadium = stadiumId ? STADIUM_BY_ID.get(stadiumId) : undefined;
  const isGigantes = stadiumId === GIGANTES_ID;
  const room2Size = split ? (room2Riders ?? picks.filter(id => rows[id]?.room2).length) : 0;
  const roomSizeFor = (id: ID) => (!split ? riders : rows[id]?.room2 ? Math.max(1, room2Size) : Math.max(1, riders - room2Size));
  const maxRiders = 16;
  const islands = changes.filter(c => FIELD_CHANGE_BY_ID.get(c)?.island).length;

  const rowOf = (id: ID) => rows[id] ?? emptyRow();
  const patch = (id: ID, p: Partial<Row>) => setRows(r => ({ ...r, [id]: { ...rowOf(id), ...r[id], ...p } }));
  const nameOf = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";
  // Places from scores: each stadium (room) ranked by the score the game decides it on.
  const [fillMsg, setFillMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const roomOf = (id: ID) => (split && rowOf(id).room2 ? 2 : 1);
  const roomStadium = (room: number) => (room === 2 ? room2Stadium : stadiumId);
  const canFill = !isGigantes && picks.some(id => {
    const st = STADIUM_BY_ID.get(roomStadium(roomOf(id)) ?? "");
    return !!st && scoreValue(rowOf(id).scores, st.decidedBy.kind) !== null;
  });
  const fillPlaces = () => {
    const next: Record<ID, number> = {};
    const notes: string[] = [];
    for (const room of split ? [1, 2] : [1]) {
      const ids = picks.filter(id => roomOf(id) === room);
      if (!ids.length) continue;
      const st = STADIUM_BY_ID.get(roomStadium(room) ?? "");
      if (!st) { notes.push(room === 2 ? "Pick the second stadium first." : "Pick the stadium first."); continue; }
      const size = room === 2 ? Math.max(1, room2Size) : split ? Math.max(1, riders - room2Size) : riders;
      const missing = ids.filter(id => scoreValue(rowOf(id).scores, st.decidedBy.kind) === null);
      if (missing.length) { notes.push(`${st.name}: ${missing.map(nameOf).join(", ")} ${missing.length === 1 ? "has" : "have"} no ${st.decidedBy.label.toLowerCase()}, so places can't be worked out.`); continue; }
      if (ids.length < size) { notes.push(`${st.name}: ${size} riders but only ${ids.length} logged, so their exact places aren't known.`); continue; }
      const places = placesFromScores(st.id, ids.map(id => ({ key: id, scores: rowOf(id).scores })));
      places?.forEach((pl, id) => { next[id] = pl; });
    }
    const filled = Object.keys(next).length;
    if (filled) setRows(r => Object.fromEntries([...new Set([...Object.keys(r), ...Object.keys(next)])].map(id => [id, { ...(r[id] ?? emptyRow()), ...(next[id] !== undefined ? { place: next[id] } : {}) }])));
    setFillMsg(filled ? { ok: true, text: `Filled ${filled} place${filled === 1 ? "" : "s"} from scores.${notes.length ? ` ${notes.join(" ")}` : ""}` } : { ok: false, text: notes.join(" ") || "Nothing to fill." });
  };
  const placedEvents = FIELD_EVENTS.filter(e => e.hasPlacements && events.includes(fieldEventKey(e)));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    if (!format) { setError(new Error("Pick a format.")); return; }
    if (!picks.length) { setError(new Error("Pick at least one amiibo.")); return; }
    setBusy(true);
    try {
      const entries: CtEntry[] = picks.map(pid => {
        const p = ref_.profileById.get(pid);
        const r = rowOf(pid);
        const old = editing?.entries.find(e => e.profileId === pid);
        const snapshotId = old?.snapshotId ?? ref_.snapshotsByProfile.get(pid)?.[0]?.id ?? "";
        const stats = Object.fromEntries(STAT_KEYS.filter(k => typeof r.stats[k] === "number").map(k => [k, r.stats[k] as number]));
        const { sum, count } = statSum(r.stats);
        const total = count === STAT_KEYS.length ? sum : r.statTotal;
        const scores = Object.fromEntries(Object.entries(r.scores).filter(([, v]) => typeof v === "number")) as CtScores;
        const eventPlaces = Object.fromEntries(Object.entries(r.eventPlaces).filter(([k, v]) => typeof v === "number" && events.includes(k))) as Record<string, number>;
        return {
          id: old?.id ?? newId(),
          profileId: pid,
          snapshotId,
          riderId: p?.riderId ?? "",
          place: r.place,
          ...(typeof total === "number" ? { statTotal: total } : {}),
          ...(count ? { stats } : {}),
          ...(r.machineId ? { machineId: r.machineId } : {}),
          ...(r.scannedMachineId ? { scannedMachineId: r.scannedMachineId } : {}),
          ...(typeof r.kos === "number" ? { kos: r.kos } : {}),
          ...(Object.keys(scores).length ? { scores } : {}),
          ...(isGigantes && r.isGigantes ? { isGigantes: true } : {}),
          ...(split && r.room2 ? { room: 2 as const } : {}),
          ...(Object.keys(eventPlaces).length ? { eventPlaces } : {}),
          ...(r.notes.trim() ? { notes: r.notes.trim() } : {}),
        };
      });
      const match = await saveCtMatch({
        id: editing?.id,
        formatId: format.id,
        sessionId: sessionId || undefined,
        playedAt: editing?.playedAt ?? nowIso(),
        stadiumId,
        riderCount: riders,
        room2: split && !isGigantes ? { stadiumId: room2Stadium, riders: Math.max(1, room2Size) } : undefined,
        entries,
        fieldEvents: events.length ? events : undefined,
        fieldChanges: changes.length ? changes : undefined,
        isTiebreaker: format.set && tiebreaker ? true : undefined,
        includeInStats: counts,
        gameVersion: editing?.gameVersion,
        notes,
      });
      memory.setLastPicks(picks);
      memory.setLastFormat(format.id);
      if (editing) {
        navigate("city", sessionId ? { tab: "session", id: sessionId } : { tab: "matches" });
        return;
      }
      setSaved(match);
      // Keep who played, the format and the session; clear this match's results.
      setRows({});
      setStadiumId(null);
      setEvents([]);
      setChanges([]);
      setTiebreaker(false);
      setNotes("");
      setSplit(false);
      setRoom2Stadium(null);
      setRoom2Riders(null);
      setResetKey(k => k + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!liveFormats.length) return <Notice title="No City Trial formats">Add one on the Formats tab first.</Notice>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <form onSubmit={submit} className="space-y-5" key={resetKey}>
      {!editing && (openSessions.length > 0 || session) && (
        <Card className={cx("p-4", session && "border-star-400/40 bg-star-400/5")}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="Session" htmlFor="ct-session" className="min-w-64">
              <Select id="ct-session" value={sessionId} onChange={e => setSessionId(e.target.value)}>
                <option value="">None (ordinary match)</option>
                {openSessions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            {session && (
              <div className="flex flex-wrap items-center gap-3 pb-2 text-sm">
                <span className="text-night-300">{sessionMatches.length} match{sessionMatches.length === 1 ? "" : "es"} so far</span>
                <button type="button" className="font-semibold text-star-400 hover:underline" onClick={() => navigate("city", { tab: "session", id: session.id })}>View session →</button>
              </div>
            )}
          </div>
        </Card>
      )}
      {editing?.sessionId && <p className="text-sm text-night-400">This match is in the session "{data.sessionById.get(editing.sessionId)?.name ?? "?"}".</p>}
      {saved && !editing && (
        <Notice tone="ok" title="Match saved">
          {stadiumName(saved.stadiumId)}: {[...saved.entries].sort((a, b) => (a.place ?? 99) - (b.place ?? 99)).map(e => `${e.place ? ordinal(e.place) : "—"} ${nameOf(e.profileId)}`).join(", ")}.
          {" "}The lineup is kept for the next one.
        </Notice>
      )}

      <Card>
        <CardHeader title={editing ? "Edit match" : "Log a City Trial match"} subtitle={format ? rulesLine(format) : undefined} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Format" htmlFor="ct-format" hint={session ? "Set by the session" : undefined}>
            <Select id="ct-format" value={formatId} disabled={!!session} onChange={e => setFormatId(e.target.value)}>
              {liveFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Stadium" htmlFor="ct-stadium">
            <StadiumSelect id="ct-stadium" value={stadiumId} onChange={setStadiumId} format={format} playedTypes={tiebreaker ? [] : set?.playedTypes ?? []} />
          </Field>
          <Field label="Riders in the match" htmlFor="ct-riders" hint="Everyone, including ones you don't log">
            <NumberInput id="ct-riders" min={2} max={maxRiders} value={riderCount ?? Math.max(2, picks.length)} onChange={v => setRiderCount(v)} />
          </Field>
        </div>

        {set && format?.set && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="air">Round {Math.min(set.roundsPlayed + 1, format.set.rounds)} of {format.set.rounds}</Badge>
            {set.playedTypes.length > 0 && <span className="text-night-300">Already played this set: {set.playedTypes.join(", ")}</span>}
            {set.needsTiebreaker && <Badge tone="star">Tied at the cut: play a tiebreaker</Badge>}
          </div>
        )}

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-night-300">Amiibo in this match</div>
          <AmiiboPicker
            ref_={ref_}
            picked={picks}
            max={16}
            onChange={ids => { setPicks(ids); if (riderCount !== null && ids.length > riderCount) setRiderCount(ids.length); }}
          />
          {ref_.profiles.filter(p => p.status === "active").length === 0 && (
            <p className="mt-2 text-sm text-night-400">Add your amiibo on the Amiibo page first.</p>
          )}
        </div>
      </Card>

      {picks.length > 0 && (
        <Card>
          <CardHeader
            title="Results"
            subtitle="Place is all you need. Ties share a place (1st, 1st, 3rd). Open More for stats, machine, KOs and score."
            action={canFill ? <Button variant="ghost" onClick={fillPlaces}>Fill places from scores</Button> : undefined}
          />
          {fillMsg && <div className="mb-3"><Notice tone={fillMsg.ok ? "ok" : "neutral"}>{fillMsg.text}</Notice></div>}
          <div className="space-y-3">
            {picks.map(pid => {
              const r = rowOf(pid);
              const { sum, count } = statSum(r.stats);
              const who = nameOf(pid);
              const entryStadium = split && r.room2 ? room2Stadium : stadiumId;
              const entryStadiumDef = entryStadium ? STADIUM_BY_ID.get(entryStadium) : undefined;
              return (
                <div key={pid} className="rounded-xl border border-night-700 bg-night-850 p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="min-w-32 flex-1">
                      <div className="font-semibold">{who}</div>
                      <div className="text-xs text-night-400">{ref_.riderById.get(ref_.profileById.get(pid)?.riderId ?? "")?.name}</div>
                    </div>
                    <label className="space-y-1">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Place</span>
                      <PlaceSelect ariaLabel={`${who} place`} value={r.place} onChange={v => patch(pid, { place: v })} size={roomSizeFor(pid)} />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Stat total</span>
                      <NumberInput
                        aria-label={`${who} stat total`}
                        className="w-28"
                        value={count ? sum : r.statTotal}
                        disabled={count > 0}
                        title={count ? "Worked out from the stats below" : undefined}
                        onChange={v => patch(pid, { statTotal: v })}
                      />
                    </label>
                    {split && !isGigantes && (
                      <Checkbox checked={r.room2} onChange={v => patch(pid, { room2: v })} label="Second stadium" />
                    )}
                    {isGigantes && (
                      <Checkbox checked={r.isGigantes} onChange={v => patch(pid, { isGigantes: v })} label="Drove Gigantes" />
                    )}
                    <Button variant="ghost" onClick={() => patch(pid, { open: !r.open })} aria-expanded={r.open}>{r.open ? "Less" : "More"}</Button>
                  </div>
                  {!r.open && (r.machineId || typeof r.kos === "number" || Object.keys(r.scores).length > 0) && (
                    <p className="mt-2 text-xs text-night-400">
                      {[r.machineId && machineName(r.machineId), typeof r.kos === "number" && `${r.kos} KOs`, scoresText(entryStadium, r.scores)].filter(Boolean).join(" · ")}
                    </p>
                  )}
                  {r.open && (
                    <div className="mt-4 space-y-4 border-t border-night-700 pt-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-night-300">Machine at the end</span>
                          <MachineSelect ariaLabel={`${who} machine`} value={r.machineId} onChange={v => patch(pid, { machineId: v })} legendaries={format?.legendaries ?? true} />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-night-300">Scanned in with</span>
                          <Select aria-label={`${who} scanned in with`} value={r.scannedMachineId} onChange={e => patch(pid, { scannedMachineId: e.target.value })}>
                            <option value="">Not noted</option>
                            {SCANNABLE_MACHINES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </Select>
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs font-semibold uppercase tracking-wider text-night-300">KOs</span>
                          <NumberInput aria-label={`${who} KOs`} min={0} value={r.kos} onChange={v => patch(pid, { kos: v })} />
                        </label>
                      </div>
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-night-300">
                          Stats {count > 0 && <span className="normal-case tracking-normal text-night-400">· total {sum}{count < STAT_KEYS.length ? ` from ${count} of ${STAT_KEYS.length}` : ""}</span>}
                        </div>
                        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
                          {STAT_KEYS.map(k => (
                            <label key={k} className="block space-y-1">
                              <span className="block text-xs text-night-400">{STAT_LABELS[k]}</span>
                              <NumberInput aria-label={`${who} ${STAT_LABELS[k]}`} min={STAT_MIN} max={STAT_MAX} value={r.stats[k] ?? null} onChange={v => patch(pid, { stats: { ...r.stats, [k]: v } })} />
                            </label>
                          ))}
                        </div>
                      </div>
                      {entryStadiumDef ? (
                        <div>
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-night-300">Score in {entryStadiumDef.name}</div>
                          <ScoreInputs stadium={entryStadiumDef} value={r.scores} onChange={v => patch(pid, { scores: v })} who={who} />
                        </div>
                      ) : <p className="text-sm text-night-400">Pick the stadium to log a score.</p>}
                      <label className="block space-y-1">
                        <span className="text-xs font-semibold uppercase tracking-wider text-night-300">Notes</span>
                        <TextArea aria-label={`${who} notes`} value={r.notes} onChange={e => patch(pid, { notes: e.target.value })} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <div className="space-y-4">
          {!isGigantes && riders > 8 && (
            <div>
              <Checkbox checked={split} onChange={setSplit} label="The match split into two stadiums" hint="Big matches send at most 8 riders to each stadium. Log the second one if you know how it went." />
              {split && (
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <Field label="Second stadium" htmlFor="ct-room2">
                    <StadiumSelect id="ct-room2" value={room2Stadium} onChange={setRoom2Stadium} format={format} />
                  </Field>
                  <Field label="Riders in the second stadium" htmlFor="ct-room2-riders">
                    <NumberInput id="ct-room2-riders" min={1} max={8} value={room2Riders ?? Math.max(1, picks.filter(id => rows[id]?.room2).length)} onChange={setRoom2Riders} />
                  </Field>
                </div>
              )}
            </div>
          )}

          <div>
            <Button variant="ghost" onClick={() => setShowEvents(!showEvents)} aria-expanded={showEvents}>
              {showEvents ? "Hide field events" : "Field events"}{events.length ? ` (${events.length})` : ""}
            </Button>
            {showEvents && (
              <div className="mt-2 space-y-3">
                {format && !format.fieldEvents && <p className="text-sm text-night-400">This format has field events off.</p>}
                <div className="flex flex-wrap gap-1.5">
                  {FIELD_EVENTS.map(e => {
                    const k = fieldEventKey(e);
                    return <Chip key={k} active={events.includes(k)} onClick={() => setEvents(events.includes(k) ? events.filter(x => x !== k) : [...events, k])}>{e.name}</Chip>;
                  })}
                </div>
                {placedEvents.map(e => {
                  const k = fieldEventKey(e);
                  return (
                    <div key={k} className="rounded-xl bg-night-850 p-3">
                      <div className="mb-2 text-sm font-semibold">{e.name} places (optional)</div>
                      <div className="flex flex-wrap gap-3">
                        {picks.map(pid => (
                          <label key={pid} className="space-y-1">
                            <span className="block text-xs text-night-400">{nameOf(pid)}</span>
                            <PlaceSelect ariaLabel={`${nameOf(pid)} ${e.name} place`} size={riders} value={rowOf(pid).eventPlaces[k] ?? null}
                              onChange={v => patch(pid, { eventPlaces: { ...rowOf(pid).eventPlaces, [k]: v } })} />
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <Button variant="ghost" onClick={() => setShowChanges(!showChanges)} aria-expanded={showChanges}>
              {showChanges ? "Hide field changes" : "Field changes"}{changes.length ? ` (${changes.length})` : ""}
            </Button>
            {showChanges && (
              <div className="mt-2 space-y-3">
                {format && !format.fieldChange && <p className="text-sm text-night-400">This format has field change off.</p>}
                {FIELD_CHANGE_AREAS.map(a => (
                  <div key={a.area}>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-night-400">{a.area}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {a.changes.map(c => {
                        const on = changes.includes(c.id);
                        const blocked = !on && !!c.island && islands >= MAX_FLOATING_ISLANDS;
                        return (
                          <span key={c.id} className={cx(blocked && "pointer-events-none opacity-40")} title={blocked ? `At most ${MAX_FLOATING_ISLANDS} islands` : c.gameplay ? "Changes how the map plays" : "Cosmetic"}>
                            <Chip active={on} onClick={() => setChanges(on ? changes.filter(x => x !== c.id) : [...changes, c.id])}>
                              {c.name}{c.gameplay ? "" : " ·"}
                            </Chip>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-xs text-night-400">A dot marks a cosmetic change.</p>
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Checkbox
              checked={counts}
              onChange={v => { setCounts(v); if (!editing) memory.setSessionCounts(sessionId, v); }}
              label="Counts in records"
              hint="Untick for a match you want to keep but not trust."
            />
            {format?.set && (
              <Checkbox checked={tiebreaker} onChange={setTiebreaker} label="Tiebreaker" hint={`Settles a tie after round ${format.set.rounds}; adds no points.`} />
            )}
          </div>
          <Field label="Notes" htmlFor="ct-notes">
            <TextArea id="ct-notes" value={notes} onChange={e => setNotes(e.target.value)} />
          </Field>
          <SaveErrorNotice error={error} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={busy || !picks.length}>{busy ? "Saving…" : editing ? "Save changes" : "Save match"}</Button>
            {editing && <Button variant="ghost" onClick={() => history.back()}>Cancel</Button>}
          </div>
        </div>
      </Card>
    </form>
    <aside className="lg:sticky lg:top-20 lg:self-start">
      <SidePanel ref_={ref_} data={data} sessionId={sessionId} formatId={formatId} highlightId={saved?.id ?? null} />
    </aside>
    </div>
  );
}

/** What you've logged so far: this session's matches (and set standings), or recent matches in this format. */
function SidePanel({ ref_, data, sessionId, formatId, highlightId }: { ref_: Reference; data: CtData; sessionId: ID | ""; formatId: ID; highlightId: ID | null }) {
  const session = sessionId ? data.sessionById.get(sessionId) : undefined;
  const format = data.formatById.get(session?.formatId ?? formatId);
  const list = session ? data.matches.filter(m => m.sessionId === session.id) : data.matches.filter(m => m.formatId === formatId);
  const set = session && format ? setState(format, list) : null;
  const name = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";
  return (
    <Card className="p-4">
      <h2 className="font-semibold">{session ? session.name : "Recent matches"}</h2>
      <p className="text-xs text-night-400">{session ? `${list.length} match${list.length === 1 ? "" : "es"} in this session` : format?.name}</p>
      {set && set.standings.length > 0 && (
        <ol className="mt-3 space-y-1 text-sm" aria-label="Set standings">
          {set.standings.map((st, i) => (
            <li key={st.profileId} className={cx("flex justify-between", st.advances && "text-ok-400")}>
              <span>{ordinal(i + 1)} {name(st.profileId)}</span><span className="tabular">{st.points} pts</span>
            </li>
          ))}
        </ol>
      )}
      {list.length === 0 ? <p className="mt-3 text-sm text-night-400">Nothing logged yet.</p> : (
        <ul className="mt-3 divide-y divide-night-800 text-sm">
          {list.slice(0, 8).map(m => {
            const top = [...m.entries].filter(e => e.place !== null && (e.room ?? 1) === 1).sort((a, b) => (a.place as number) - (b.place as number)).slice(0, 3);
            return (
              <li key={m.id} className={cx("py-2", m.id === highlightId && "text-star-400")}>
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{stadiumName(m.stadiumId)}</span>
                  {m.isTiebreaker && <Badge tone="star">TB</Badge>}
                </div>
                <div className="text-xs text-night-400">{top.length ? top.map(e => `${ordinal(e.place as number)} ${name(e.profileId)}`).join(" · ") : "no places"}</div>
              </li>
            );
          })}
        </ul>
      )}
      {session && list.length > 8 && <button type="button" className="mt-2 text-xs text-star-400 hover:underline" onClick={() => navigate("city", { tab: "session", id: session.id })}>All {list.length} matches →</button>}
    </Card>
  );
}

function stadiumName(id: string | null) {
  return (id && STADIUM_BY_ID.get(id)?.name) || "Match";
}
