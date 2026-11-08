// City Trial sessions: a batch of matches in one format (a test night,
// or one tournament set). A session page shows that batch's own table,
// and for formats with sets, the points, bans and who advances.

import { useState } from "react";
import type { FormEvent } from "react";
import { ordinal, setState } from "../../domain/cityTrial";
import type { CtSession } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import { createCtSession, deleteCtSession, updateCtSession } from "../../db/ctRepo";
import type { Reference } from "../../hooks/useReference";
import { navigate } from "../../lib/router";
import { Field, SaveErrorNotice, Segmented, Select, TextArea, TextInput } from "../../components/form";
import { Badge, Button, Card, CardHeader, Notice, cx } from "../../components/ui";
import { rulesLine } from "./bits";
import type { CtData } from "./data";
import { busiestFormat, memory } from "./data";
import { MatchCard } from "./Matches";
import { AmiiboTable, ByTypeTable, CtHeadToHead } from "./Overview";

function StartForm({ data, onCancel }: { data: CtData; onCancel: () => void }) {
  const today = new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const [name, setName] = useState(`City Trial, ${today}`);
  const [formatId, setFormatId] = useState<ID>(busiestFormat(data)?.id ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const format = data.formatById.get(formatId);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const s = await createCtSession({ name, formatId, notes });
      memory.setActiveSession(s.id);
      navigate("city", { tab: "log", session: s.id });
    } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title="Start a session" subtitle="A session keeps one night of testing, or one tournament set, together. It stays in one format." />
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="cts-name"><TextInput id="cts-name" value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Format" htmlFor="cts-format" hint={format ? rulesLine(format) : undefined}>
            <Select id="cts-format" value={formatId} onChange={e => setFormatId(e.target.value)}>
              {data.formats.filter(f => !f.isArchived).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notes (optional)" htmlFor="cts-notes">
          <TextArea id="cts-notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="What are you testing?" />
        </Field>
        <SaveErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !formatId}>{busy ? "Starting…" : "Start and log matches"}</Button>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export function Sessions({ ref_, data }: { ref_: Reference; data: CtData }) {
  const [starting, setStarting] = useState(false);
  const count = (id: ID) => data.matches.filter(m => m.sessionId === id).length;
  const card = (s: CtSession) => {
    const lineup = [...new Set(data.matches.filter(m => m.sessionId === s.id).flatMap(m => m.entries.map(e => e.profileId)))]
      .map(id => ref_.profileById.get(id)?.nickname ?? "?");
    return (
      <Card key={s.id}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <button type="button" className="font-display text-lg font-bold hover:text-air-400" onClick={() => navigate("city", { tab: "session", id: s.id })}>{s.name}</button>
            <p className="text-sm text-night-300">{data.formatById.get(s.formatId)?.name} · {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</p>
            {lineup.length > 0 && <p className="text-sm text-night-400">{lineup.join(", ")}</p>}
          </div>
          <div className="flex gap-2">
            <Badge>{count(s.id)} match{count(s.id) === 1 ? "" : "es"}</Badge>
            {s.status === "complete" && <Badge>Finished</Badge>}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => navigate("city", { tab: "session", id: s.id })}>Open</Button>
          {s.status !== "complete" && <Button variant="ghost" onClick={() => navigate("city", { tab: "log", session: s.id })}>Log matches</Button>}
        </div>
      </Card>
    );
  };
  const open = data.sessions.filter(s => s.status !== "complete");
  const done = data.sessions.filter(s => s.status === "complete");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-night-300">
          Put your amiibo in a match together, no CPUs, and run it again and again: that's a session. Or log one tournament set as a session
          and it adds up the points.
        </p>
        {!starting && <Button variant="primary" onClick={() => setStarting(true)}>Start a session</Button>}
      </div>
      {starting && <StartForm data={data} onCancel={() => setStarting(false)} />}
      {!data.sessions.length && !starting && <Notice title="No sessions yet">Start one, then log matches into it.</Notice>}
      {open.length > 0 && <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wider text-night-400">In progress</h2>{open.map(card)}</div>}
      {done.length > 0 && <div className="space-y-3"><h2 className="text-sm font-semibold uppercase tracking-wider text-night-400">Finished</h2>{done.map(card)}</div>}
    </div>
  );
}

export function SessionDetail({ ref_, data, id }: { ref_: Reference; data: CtData; id: ID }) {
  const session = data.sessionById.get(id);
  const [view, setView] = useState<"table" | "types" | "h2h">("table");
  const [confirm, setConfirm] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(session?.notes ?? "");
  if (!session) return <Notice tone="bad" title="That session doesn't exist" />;
  const format = data.formatById.get(session.formatId);
  const matches = data.matches.filter(m => m.sessionId === id);
  const set = format ? setState(format, matches) : null;
  const finished = session.status === "complete";

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">{session.name}</h2>
            <p className="text-sm text-night-300">{format?.name} · {matches.length} match{matches.length === 1 ? "" : "es"}{format ? ` · ${rulesLine(format)}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!finished && <Button variant="primary" onClick={() => navigate("city", { tab: "log", session: id })}>Log a match</Button>}
            <Button variant="ghost" onClick={() => { if (!finished && memory.activeSession() === id) memory.setActiveSession(null); void updateCtSession(id, { status: finished ? "in_progress" : "complete" }); }}>{finished ? "Reopen" : "Mark finished"}</Button>
          </div>
        </div>
        {editingNotes ? (
          <div className="mt-3 space-y-2">
            <TextArea aria-label="Session notes" value={notes} onChange={e => setNotes(e.target.value)} />
            <div className="flex gap-2">
              <Button onClick={() => { void updateCtSession(id, { notes }); setEditingNotes(false); }}>Save notes</Button>
              <Button variant="ghost" onClick={() => setEditingNotes(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 text-sm">
            {session.notes ? <p className="whitespace-pre-wrap text-night-300">{session.notes}</p> : null}
            <button type="button" className="text-xs text-air-400 hover:underline" onClick={() => { setNotes(session.notes ?? ""); setEditingNotes(true); }}>{session.notes ? "Edit notes" : "Add notes"}</button>
          </div>
        )}
      </Card>

      {set && format?.set && (
        <Card>
          <CardHeader
            title={`Set standings · round ${Math.min(set.roundsPlayed, format.set.rounds)} of ${format.set.rounds}`}
            subtitle={`Points ${format.pointsTable?.join(" / ")}. Top ${format.set.advance} advance.${format.set.banPlayedType ? " A stadium type is off for the rest of the set once played." : ""}`}
          />
          {set.standings.length === 0 ? <p className="text-sm text-night-400">No rounds logged yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-night-300">
                <tr><th className="py-1.5 text-left">Place</th><th className="py-1.5 text-left">Amiibo</th><th className="py-1.5 text-right">Points</th><th className="py-1.5 text-right">Rounds</th><th className="py-1.5 text-right">Tiebreak</th><th /></tr>
              </thead>
              <tbody>
                {set.standings.map((s, i) => (
                  <tr key={s.profileId} className={cx("border-t border-night-800", s.advances && "text-ok-400")}>
                    <td className="py-1.5 tabular">{ordinal(i + 1)}</td>
                    <td className="py-1.5 font-semibold">{ref_.profileById.get(s.profileId)?.nickname ?? "?"}</td>
                    <td className="py-1.5 text-right tabular">{s.points}</td>
                    <td className="py-1.5 text-right tabular">{s.rounds}</td>
                    <td className="py-1.5 text-right tabular">{s.tiebreakPlace ? ordinal(s.tiebreakPlace) : ""}</td>
                    <td className="py-1.5 text-right">{s.advances && <Badge tone="ok">Advances</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {set.playedTypes.length > 0 && <p className="mt-3 text-sm text-night-300">Off for the rest of the set: {set.playedTypes.join(", ")}.</p>}
          {set.needsTiebreaker && (
            <Notice title="Tied at the cut">
              Play a {format.set.tiebreakerMinutes ?? 3}-minute tiebreaker with the tied amiibo on the same stadium, and log it with Tiebreaker ticked.
            </Notice>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title="This session's amiibo"
          subtitle="Every match in the session, whether or not it counts in your records."
          action={<Segmented label="View" value={view} onChange={setView} options={[{ value: "table", label: "Summary" }, { value: "types", label: "By stadium type" }, { value: "h2h", label: "Head to head" }]} />}
        />
        {view === "table" && <AmiiboTable ref_={ref_} matches={matches} format={format} minSample={ref_.settings?.minSample ?? 5} />}
        {view === "types" && <ByTypeTable ref_={ref_} matches={matches} format={format} />}
        {view === "h2h" && <CtHeadToHead ref_={ref_} matches={matches} />}
      </Card>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-night-400">Matches</h3>
        {matches.length === 0 && <Notice title="No matches yet" />}
        {matches.map(m => <MatchCard key={m.id} ref_={ref_} data={data} match={m} />)}
      </div>

      <Card>
        {!confirm ? (
          <Button variant="ghost" className="hover:text-bad-400" onClick={() => setConfirm(true)}>Delete session…</Button>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Delete "{session.name}"?</span>
            <Button onClick={() => { void deleteCtSession(id, true).then(() => navigate("city", { tab: "sessions" })); }}>Delete, keep its matches</Button>
            <Button variant="danger" onClick={() => { void deleteCtSession(id, false).then(() => navigate("city", { tab: "sessions" })); }}>Delete with its matches</Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
