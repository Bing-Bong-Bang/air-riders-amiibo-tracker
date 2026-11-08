// One session (#/session?id=…): its own stats, grouped by amiibo + machine
// and broken down by stage, insights, compare, and its races with a
// "counts in records" box each.

import { useEffect, useMemo, useState } from "react";
import { getAllByIndex, getById } from "../db/database";
import { deleteRace, deleteSession, setRaceIncluded, updateSession } from "../db/repo";
import { allowsRetirement, formatGameTime, formatGap } from "../domain/schema";
import type { FinishStatus, Format, ID, Millis, Race, Session, Stage } from "../domain/schema";
import { rankSummaries, stageMedians, summarize } from "../domain/insights";
import type { ResultRow } from "../domain/insights";
import { loadCoreRows } from "../domain/coreData";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { useMode } from "../lib/mode";
import { Link, navigate, useLocation } from "../lib/router";
import { SaveErrorNotice } from "../components/form";
import { OVERALL_COLUMNS, STAGE_COLUMNS, StatsTable, TIME_COLUMNS, retiredColumnIf } from "../components/StatsTable";
import type { ColumnKey } from "../components/StatsTable";
import { Badge, Button, Card, CardHeader, Notice, Spinner, cx } from "../components/ui";
import { SessionCompare, StageInsights, groupKey, groupName, groupSub, groupsOf, sessionRows } from "./sessionInsights";
import { setActiveSession } from "./LogRacePage";

const STATUS_LABEL: Record<FinishStatus, string> = { finished: "Finished", retired: "Retired", dnf: "DNF", dq: "DQ" };

function tableRowsFor(rows: ResultRow[], medians: Map<ID, Millis>, format: Format | undefined, ref_: Reference) {
  return rankSummaries(groupsOf(rows).map(g => summarize(g.id, rows.filter(r => groupKey(r) === g.id), medians, () => format))).map(s => {
    const [profileId, machineId] = s.key.split("|");
    const g = { id: s.key, profileId, machineId };
    return { id: s.key, label: groupName(g, ref_), sub: groupSub(g, ref_), summary: s };
  });
}

/** One stage's times: table with a target time, plus what the session says. */
function StageTimeCard({ session, stage, title, subtitle, rows, medians, coreRows, ref_, format, columns }: {
  session: Session; stage: Stage; title: string; subtitle: string; rows: ResultRow[]; medians: Map<ID, Millis>;
  coreRows: ResultRow[]; ref_: Reference; format: Format | undefined; columns: ColumnKey[];
}) {
  const onStage = rows.filter(r => r.race.stageId === stage.id);
  const cols = columns.filter(c => c !== "hits");
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <StatsTable rows={tableRowsFor(onStage, medians, format, ref_)} columns={cols} labelHead="Amiibo" />
      <StageInsights sessionId={session.id} stageId={stage.id} rows={onStage} coreRows={coreRows} ref_={ref_} />
    </Card>
  );
}

function SessionStats({ session, races, ref_ }: { session: Session; races: Race[]; ref_: Reference }) {
  const mode = session.mode ?? ref_.formatById.get(session.formatId)?.mode ?? "air_ride";
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const rows = useMemo(() => sessionRows(races), [races]);
  const medians = useMemo(() => stageMedians(rows), [rows]);
  const stagesRaced = useMemo(() => {
    const ids = new Set(rows.map(r => r.race.stageId));
    return ref_.stages.filter(s => ids.has(s.id));
  }, [rows, ref_.stages]);

  if (rows.length === 0) {
    return <Card><CardHeader title="Stats" /><p className="text-sm text-night-400">Stats appear here after the first race. <Link to="log" params={{ session: session.id }} className="font-semibold text-air-400 underline">Log a race</Link></p></Card>;
  }

  const format = ref_.formatById.get(session.formatId);
  const byPlace = rows.some(r => r.entry.placement !== undefined);
  const raceTotal = new Set(rows.map(r => r.race.id)).size;
  const showRetired = !!format && allowsRetirement(format);
  const overallColumns = retiredColumnIf(byPlace ? OVERALL_COLUMNS : stagesRaced.length === 1 ? TIME_COLUMNS : ["races", "pace", "dnf"], showRetired);
  const stageColumns = retiredColumnIf(byPlace ? [...STAGE_COLUMNS, "disasters", "hits"] as ColumnKey[] : TIME_COLUMNS, showRetired);
  const perStage = stagesRaced.length > 1 || byPlace;
  const coreRows = core.data?.get(session.formatId) ?? [];

  return (
    <div className="space-y-6">
      {!perStage && stagesRaced.length === 1 ? (
        <StageTimeCard session={session} stage={stagesRaced[0]} title={`Overall · ${stagesRaced[0].name}`}
          subtitle={`${raceTotal} race${raceTotal === 1 ? "" : "s"}, grouped by amiibo + machine.`}
          rows={rows} medians={medians} coreRows={coreRows} ref_={ref_} format={format} columns={overallColumns} />
      ) : (
        <Card>
          <CardHeader title="Overall" subtitle={`${raceTotal} race${raceTotal === 1 ? "" : "s"} on ${stagesRaced.length} stage${stagesRaced.length === 1 ? "" : "s"}, grouped by amiibo + machine.${byPlace || stagesRaced.length > 1 ? " Pace compares each time with the stage's median, so different stages can be combined." : ""}${stagesRaced.length > 1 ? " Times are broken down by stage below." : ""}`} />
          <StatsTable rows={tableRowsFor(rows, medians, format, ref_)} columns={overallColumns} labelHead="Amiibo" />
        </Card>
      )}

      {perStage && stagesRaced.map(stage => {
        const count = new Set(rows.filter(r => r.race.stageId === stage.id).map(r => r.race.id)).size;
        return (
          <StageTimeCard key={stage.id} session={session} stage={stage} title={stage.name}
            subtitle={`${count} race${count === 1 ? "" : "s"}. Times are comparable here because they're all on one stage.`}
            rows={rows} medians={medians} coreRows={coreRows} ref_={ref_} format={format} columns={stageColumns} />
        );
      })}

      <SessionCompare session={session} races={races} ref_={ref_} />
    </div>
  );
}

function DeletePanel({ session, raceCount, onCancel }: { session: Session; raceCount: number; onCancel: () => void }) {
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await deleteSession(session.id, keep); navigate("sessions"); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-xl border border-bad-400/40 bg-bad-400/5 p-4" role="alertdialog" aria-label="Delete session">
      <h3 className="font-semibold text-bad-400">Delete "{session.name}"?</h3>
      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2"><input type="radio" checked={keep} onChange={() => setKeep(true)} className="mt-1 accent-air-500" />
          <span>Keep its {raceCount} race{raceCount === 1 ? "" : "s"} as ordinary races (they stay in your race history)</span></label>
        <label className="flex items-start gap-2"><input type="radio" checked={!keep} onChange={() => setKeep(false)} className="mt-1 accent-air-500" />
          <span>Delete its {raceCount} race{raceCount === 1 ? "" : "s"} too</span></label>
      </div>
      <SaveErrorNotice error={error} />
      <div className="flex gap-2">
        <Button variant="danger" onClick={go} disabled={busy}>{busy ? "Deleting…" : "Delete session"}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Keep it</Button>
      </div>
    </div>
  );
}

export function SessionPage() {
  const { mode, setMode } = useMode();
  const { params } = useLocation();
  const id = params.get("id") ?? "";
  const sessionQ = useLiveQuery(async () => (id ? (await getById("sessions", id)) ?? null : null), [id], ["sessions"]);
  const session = sessionQ.data ?? null;
  const formatQ = useLiveQuery(async () => (session ? (await getById("formats", session.formatId)) ?? null : null), [session?.formatId], ["formats"]);
  const sessionMode = session?.mode ?? formatQ.data?.mode;
  const { data: ref_, error, loading } = useReference(sessionMode ?? mode);
  const racesQ = useLiveQuery(async () => (id ? getAllByIndex("races", "sessionId", id) : []), [id], ["races"]);
  const [panel, setPanel] = useState<"none" | "delete">("none");
  const [actionError, setActionError] = useState<unknown>(null);
  const [pending, setPending] = useState<Record<ID, boolean>>({});
  useEffect(() => { if (sessionMode && sessionMode !== mode) setMode(sessionMode); }, [sessionMode, mode, setMode]);
  useEffect(() => {
    setPending(prev => {
      const next = { ...prev };
      for (const r of racesQ.data ?? []) if (next[r.id] === r.includeInStats) delete next[r.id];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [racesQ.data]);

  if (sessionQ.loading || loading || racesQ.loading) return <Spinner />;
  if (!session) return <Notice tone="bad" title="That session wasn't found">It may have been deleted. <Link to="sessions" className="underline">Back to sessions</Link></Notice>;
  if (error || !ref_) return <Notice tone="bad" title="Couldn't load the session">{error?.message}</Notice>;
  if (sessionMode && sessionMode !== mode) return <Spinner />;

  const format = ref_.formatById.get(session.formatId);
  const races = (racesQ.data ?? []).slice().sort((a, b) => b.racedAt.localeCompare(a.racedAt));
  const act = async (fn: () => Promise<void>) => { setActionError(null); try { await fn(); } catch (e) { setActionError(e); } };
  const counts = (r: Race) => pending[r.id] ?? r.includeInStats;
  const counted = races.filter(counts).length;
  const toggle = async (r: Race, v: boolean) => {
    setPending(prev => ({ ...prev, [r.id]: v }));
    setActionError(null);
    try { await setRaceIncluded(r.id, v); } catch (e) {
      setActionError(e);
      setPending(prev => { const next = { ...prev }; delete next[r.id]; return next; });
    }
  };
  const nick = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";
  const lineup = [...new Set(races.flatMap(r => r.entries.map(e => (e.racer.kind === "amiibo" ? nick(e.racer.profileId) : "?"))))];
  const open = session.status !== "complete";

  return (
    <div className="space-y-6">
      <div>
        <Link to="sessions" className="text-sm text-night-400 hover:text-night-100">← Sessions</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{session.name}</h1>
            <p className="mt-1 text-night-300">
              {format?.name ?? "Missing format"} · {new Date(session.date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              {lineup.length > 0 && <> · {lineup.join(", ")}</>}
            </p>
            {session.notes && <p className="mt-1 max-w-3xl text-sm text-night-400">{session.notes}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{races.length} race{races.length === 1 ? "" : "s"}</Badge>
            {!open && <Badge>Finished</Badge>}
            {open && <Button variant="primary" onClick={() => { setActiveSession(mode, session.id); navigate("log", { session: session.id }); }}>Log races</Button>}
            {open
              ? <Button onClick={() => void act(() => updateSession(session.id, { status: "complete" }))}>Finish session</Button>
              : <Button onClick={() => void act(() => updateSession(session.id, { status: "in_progress" }))}>Reopen</Button>}
            <Button variant="ghost" className="hover:text-bad-400" onClick={() => setPanel(panel === "delete" ? "none" : "delete")}>Delete…</Button>
          </div>
        </div>
      </div>

      <SaveErrorNotice error={actionError} />
      {panel === "delete" && <DeletePanel session={session} raceCount={races.length} onCancel={() => setPanel("none")} />}
      {!format && <Notice tone="bad" title="This session's format is missing" />}

      <SessionStats session={session} races={racesQ.data ?? []} ref_={ref_} />

      {races.length > 0 && (
        <Card>
          <CardHeader title="Races in this session"
            subtitle={<><span className="font-semibold text-night-100">{counted} of {races.length} race{races.length === 1 ? "" : "s"} count in your records</span>. Newest first. Every race shows in this session's stats either way; tick Records to also count it in Rankings, Best picks and stat pages.</>} />
          <ul className="divide-y divide-night-800">
            {races.map(r => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 text-sm">
                  <div className="font-semibold">{ref_.stageById.get(r.stageId)?.name}</div>
                  <div className="text-night-300">
                    {[...r.entries].sort((a, b) => (a.placement ?? 9) - (b.placement ?? 9)).map(e => {
                      const name = e.racer.kind === "amiibo" ? nick(e.racer.profileId) : "?";
                      const machine = ref_.machineById.get(e.machineId)?.name ?? "?";
                      const result = e.finishTimeMs !== null ? formatGameTime(e.finishTimeMs) : e.status === "finished" ? "" : STATUS_LABEL[e.status];
                      return `${e.placement ? `${e.placement}. ` : ""}${name} (${machine})${result ? ` ${result}` : ""}${e.gapToFirstMs ? ` (${formatGap(e.gapToFirstMs)})` : ""}`;
                    }).join(" · ")}
                  </div>
                  {r.notes && <div className="text-xs text-night-400">{r.notes}</div>}
                </div>
                <div className="flex items-center gap-1">
                  <label className={cx("mr-2 flex cursor-pointer items-center gap-1.5 text-xs", counts(r) ? "text-ok-400" : "text-night-300")} title="Count this race in your records">
                    <input type="checkbox" checked={counts(r)} onChange={e => void toggle(r, e.target.checked)} className="h-4 w-4 accent-air-500" aria-label="Counts in records" />
                    Records
                  </label>
                  <Button variant="ghost" className="px-2.5 py-1" onClick={() => navigate("log", { edit: r.id })}>Edit</Button>
                  <Button variant="ghost" className="px-2.5 py-1 hover:text-bad-400" onClick={() => { if (window.confirm("Delete this race?")) void act(() => deleteRace(r.id)); }}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
