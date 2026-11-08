// Sessions: start one, see open and finished ones. Races join a session
// from Log race; the session page shows that batch's own stats.

import { useState } from "react";
import type { FormEvent } from "react";
import { getAll, getAllByIndex } from "../db/database";
import { createSession } from "../db/repo";
import type { ID, Session } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate } from "../lib/router";
import { Field, SaveErrorNotice, Select, TextArea, TextInput } from "../components/form";
import { Badge, Button, Card, CardHeader, Notice, Spinner } from "../components/ui";
import { setActiveSession } from "./LogRacePage";

function defaultFormatId(ref_: Reference, mode: string): ID {
  const active = ref_.formats.filter(f => !f.isArchived && f.mode === mode);
  return (active.find(f => f.isDefaultRules) ?? active.find(f => f.id === ref_.settings?.recordFormatIds[mode as "air_ride"]) ?? active[0])?.id ?? "";
}

function StartSessionForm({ ref_, onCancel }: { ref_: Reference; onCancel: () => void }) {
  const { mode } = useMode();
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const [name, setName] = useState(`Session, ${today}`);
  const [formatId, setFormatId] = useState(defaultFormatId(ref_, mode));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const formats = ref_.formats.filter(f => !f.isArchived && f.mode === mode);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const s = await createSession({ name, formatId, plannedRaces: null, notes });
      setActiveSession(mode, s.id);
      navigate("log", { session: s.id });
    } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Start a session" subtitle="Name it, pick the format, then log races into it. Each race can use any stage, lineup and machines." />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="ss-name"><TextInput id="ss-name" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Format" htmlFor="ss-format" hint="A session stays in one format, so its stats never mix rules.">
            <Select id="ss-format" value={formatId} onChange={e => setFormatId(e.target.value)}>
              {formats.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === ref_.settings?.recordFormatIds[mode] ? " ★" : ""}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notes (optional)" htmlFor="ss-notes">
          <TextArea id="ss-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What are you testing or practising?" />
        </Field>
        <SaveErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !formatId}>{busy ? "Starting…" : "Start and log races"}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function SessionCard({ session, ref_, raceCount, counted, lineup }: { session: Session; ref_: Reference; raceCount: number; counted: number; lineup: string[] }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="session" params={{ id: session.id }} className="font-display text-lg font-bold hover:text-air-400">{session.name}</Link>
          <p className="text-sm text-night-300">{ref_.formatById.get(session.formatId)?.name} · {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
          {lineup.length > 0 && <p className="text-sm text-night-400">{lineup.join(", ")}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge>{raceCount} race{raceCount === 1 ? "" : "s"}</Badge>
          <Badge tone={counted > 0 ? "ok" : "neutral"}>{counted} in records</Badge>
          {session.status === "complete" && <Badge>Finished</Badge>}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button onClick={() => navigate("session", { id: session.id })}>Open</Button>
        {session.status !== "complete" && <Button variant="ghost" onClick={() => { setActiveSession(session.mode ?? "air_ride", session.id); navigate("log", { session: session.id }); }}>Log races</Button>}
      </div>
    </Card>
  );
}

export function SessionsPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const data = useLiveQuery(async () => {
    const [sessions, races, formats] = await Promise.all([getAll("sessions"), getAllByIndex("races", "mode", mode), getAll("formats")]);
    const modeOf = new Map(formats.map(f => [f.id, f.mode]));
    const counts = new Map<ID, number>(), counted = new Map<ID, number>(), lineup = new Map<ID, Set<ID>>();
    for (const r of races) {
      if (!r.sessionId) continue;
      counts.set(r.sessionId, (counts.get(r.sessionId) ?? 0) + 1);
      if (r.includeInStats) counted.set(r.sessionId, (counted.get(r.sessionId) ?? 0) + 1);
      const set = lineup.get(r.sessionId) ?? new Set<ID>();
      for (const e of r.entries) if (e.racer.kind === "amiibo") set.add(e.racer.profileId);
      lineup.set(r.sessionId, set);
    }
    const mine = sessions.filter(s => (s.mode ?? modeOf.get(s.formatId)) === mode).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { sessions: mine, counts, counted, lineup };
  }, [mode], ["sessions", "races", "formats"]);
  const [starting, setStarting] = useState(false);

  if (error || data.error) return <Notice tone="bad" title="Couldn't load sessions">{(error ?? data.error)?.message}</Notice>;
  if (loading || data.loading || !ref_ || !data.data) return <Spinner />;

  const open = data.data.sessions.filter(s => s.status !== "complete");
  const done = data.data.sessions.filter(s => s.status === "complete");
  const activeProfiles = ref_.profiles.filter(p => p.status === "active").length;
  const card = (s: Session) => (
    <SessionCard key={s.id} session={s} ref_={ref_} raceCount={data.data!.counts.get(s.id) ?? 0} counted={data.data!.counted.get(s.id) ?? 0}
      lineup={[...(data.data!.lineup.get(s.id) ?? [])].map(id => ref_.profileById.get(id)?.nickname ?? "?")} />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{modeLabel(mode)} sessions</h1>
          <p className="mt-1 max-w-3xl text-night-300">A session groups races (a test, a practice night, tournament prep) so you can see that batch's own stats and compare it with others. You log its races on Log race, and choose race by race whether each counts in your records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.data.sessions.length > 0 && <Button onClick={() => navigate("compare")}>Compare sessions</Button>}
          {!starting && activeProfiles > 0 && <Button variant="primary" onClick={() => setStarting(true)}>Start a session</Button>}
        </div>
      </div>
      {activeProfiles === 0 && <Notice title="Add an amiibo first"><Link to="amiibo" className="font-semibold text-air-400 underline">Go to Amiibo</Link></Notice>}
      {starting && <StartSessionForm ref_={ref_} onCancel={() => setStarting(false)} />}
      {open.length === 0 && done.length === 0 && !starting && activeProfiles > 0 && <Notice title="No sessions yet">Start one, then log races into it.</Notice>}
      {open.length > 0 && <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wider text-night-400">In progress</h2>{open.map(card)}</div>}
      {done.length > 0 && <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wider text-night-400">Finished</h2>{done.map(card)}</div>}
    </div>
  );
}
