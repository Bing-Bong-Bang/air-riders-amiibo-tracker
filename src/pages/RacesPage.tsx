import { useEffect, useState } from "react";
import { getAll, getAllByIndex } from "../db/database";
import { deleteRace, setRaceIncluded } from "../db/repo";
import { formatGameTime, formatGap } from "../domain/schema";
import type { ID, Race, RaceEntry } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { racerLabel, useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate } from "../lib/router";
import { SaveErrorNotice, Select, TextInput } from "../components/form";
import { Badge, Button, Card, Notice, Spinner, cx } from "../components/ui";

const PAGE = 50;
const STATUS: Record<RaceEntry["status"], string> = { finished: "", retired: "Retired", dnf: "DNF", dq: "DQ" };

function EntryLine({ e, ref_ }: { e: RaceEntry; ref_: Reference }) {
  const profile = e.racer.kind === "amiibo" ? ref_.profileById.get(e.racer.profileId) : undefined;
  const snap = e.racer.kind === "amiibo" ? ref_.snapshotById.get(e.racer.snapshotId) : undefined;
  return (
    <div className={cx("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5", !e.includeInStats && "opacity-50")}>
      <span>
        {e.placement && <span className="mr-1.5 font-semibold text-night-300">{e.placement}.</span>}
        <span className="font-medium">{e.racer.kind === "amiibo" ? racerLabel(ref_, e.racer.profileId, e.riderId) : profile?.nickname ?? "?"}</span>
        {snap && <span className="text-night-400"> v{snap.version}</span>}
        <span className="text-night-300"> · {ref_.machineById.get(e.machineId)?.name ?? "?"}</span>
        {!e.includeInStats && <span className="ml-2"><Badge>racer excluded</Badge></span>}
      </span>
      <span className="font-mono tabular">
        {e.finishTimeMs !== null ? formatGameTime(e.finishTimeMs) : <span className="text-bad-400">{STATUS[e.status]}</span>}
        {e.gapToFirstMs ? <span className="ml-2 text-xs text-night-400">{formatGap(e.gapToFirstMs)}</span> : null}
      </span>
    </div>
  );
}

export function RacesPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const races = useLiveQuery(() => getAllByIndex("races", "mode", mode), [mode], ["races"]);
  const sessions = useLiveQuery(async () => new Map((await getAll("sessions")).map(s => [s.id, s])), [], ["sessions"]);
  const [formatId, setFormatId] = useState<ID>("");
  const [stageId, setStageId] = useState<ID>("");
  const [profileId, setProfileId] = useState<ID>("");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [actionError, setActionError] = useState<unknown>(null);
  // Optimistic "Stats" ticks: shown immediately, dropped once the saved data agrees.
  const [pendingInclude, setPendingInclude] = useState<Record<ID, boolean>>({});
  useEffect(() => {
    if (!races.data) return;
    setPendingInclude(prev => {
      const next = { ...prev };
      for (const r of races.data ?? []) if (next[r.id] === r.includeInStats) delete next[r.id];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [races.data]);

  if (error || races.error) return <Notice tone="bad" title="Couldn't load races">{(error ?? races.error)?.message}</Notice>;
  if (loading || races.loading || !ref_) return <Spinner />;

  const q = query.trim().toLowerCase();
  const filtered = (races.data ?? [])
    .filter(r => (!formatId || r.formatId === formatId) && (!stageId || r.stageId === stageId)
      && (!profileId || r.entries.some(e => e.racer.kind === "amiibo" && e.racer.profileId === profileId))
      && (!q || [r.notes, ...r.entries.map(e => e.notes)].some(n => n?.toLowerCase().includes(q))))
    .sort((a, b) => b.racedAt.localeCompare(a.racedAt));
  const counted = filtered.filter(r => pendingInclude[r.id] ?? r.includeInStats).length;

  const act = async (fn: () => Promise<void>) => {
    setActionError(null);
    try { await fn(); } catch (e) { setActionError(e); }
  };
  const toggleInclude = async (id: ID, value: boolean) => {
    setPendingInclude(prev => ({ ...prev, [id]: value }));
    setActionError(null);
    try {
      await setRaceIncluded(id, value);
    } catch (e) {
      setActionError(e);
      setPendingInclude(prev => { const next = { ...prev }; delete next[id]; return next; });
    }
  };
  const isIncluded = (r: Race) => pendingInclude[r.id] ?? r.includeInStats;
  const remove = (r: Race) => {
    if (window.confirm("Delete this race? This can't be undone.")) void act(() => deleteRace(r.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{modeLabel(mode)} races</h1>
          <p className="mt-1 text-night-300">{filtered.length} shown · {counted} counted in stats</p>
        </div>
        <Button variant="primary" onClick={() => navigate("log")}>Log a race</Button>
      </div>

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label="Filter by format" value={formatId} onChange={e => { setFormatId(e.target.value); setShown(PAGE); }}>
            <option value="">All formats</option>
            {ref_.formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
          </Select>
          <Select aria-label="Filter by stage" value={stageId} onChange={e => { setStageId(e.target.value); setShown(PAGE); }}>
            <option value="">All stages</option>
            {ref_.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Select aria-label="Filter by amiibo" value={profileId} onChange={e => { setProfileId(e.target.value); setShown(PAGE); }}>
            <option value="">All amiibo</option>
            {ref_.profiles.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
          </Select>
          <TextInput type="search" aria-label="Search race notes" placeholder="Search notes…" value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE); }} />
        </div>
      </Card>

      <SaveErrorNotice error={actionError} />

      {filtered.length === 0 ? (
        <Notice title={(races.data ?? []).length ? "No races match these filters" : `No ${modeLabel(mode)} races yet`}>
          {!(races.data ?? []).length && <Link to="log" className="font-semibold text-air-400 underline">Log your first race</Link>}
        </Notice>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-night-800">
            {filtered.slice(0, shown).map(r => (
              <li key={r.id} className={cx("grid gap-3 px-5 py-4 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-start", !isIncluded(r) && "bg-night-950/60")}>
                <div className="text-sm">
                  <div className="font-semibold">{ref_.stageById.get(r.stageId)?.name ?? "?"}</div>
                  <div className="text-night-400">{new Date(r.racedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                  {!formatId && <div className="mt-0.5 truncate text-xs text-night-400">{ref_.formatById.get(r.formatId)?.name}</div>}
                  {r.sessionId && (
                    <div className="mt-0.5 text-xs">
                      <span className="text-night-400">Session: </span>
                      <Link to="session" params={{ id: r.sessionId }} className="font-semibold text-air-400 hover:underline">{sessions.data?.get(r.sessionId)?.name ?? "…"}</Link>
                    </div>
                  )}
                  {r.gameVersion && <div className="mt-0.5 text-xs text-night-400" title="Game version this race was played on">Ver. {r.gameVersion}</div>}
                </div>
                <div className={cx("space-y-1 text-sm", !isIncluded(r) && "opacity-60")}>
                  {[...r.entries].sort((a, b) => (a.placement ?? 9) - (b.placement ?? 9)).map(e => <EntryLine key={e.id} e={e} ref_={ref_} />)}
                  {(r.notes || r.glitchOccurred || r.firstPlaceTimeMs) && (
                    <div className="flex flex-wrap gap-2 pt-1 text-xs text-night-400">
                      {r.glitchOccurred && <Badge tone="bad">glitch</Badge>}
                      {r.firstPlaceTimeMs && <span>1st (CPU): {formatGameTime(r.firstPlaceTimeMs)}</span>}
                      {r.notes && <span className="whitespace-pre-wrap">“{r.notes}”</span>}
                    </div>
                  )}
                  {r.entries.some(e => e.notes) && (
                    <div className="text-xs text-night-400">{r.entries.filter(e => e.notes).map(e => e.notes).join(" · ")}</div>
                  )}
                </div>
                <div className="flex items-center gap-1 sm:justify-end">
                  <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-xs text-night-300" title="Count this race in stats">
                    <input type="checkbox" checked={isIncluded(r)} onChange={e => void toggleInclude(r.id, e.target.checked)} className="h-4 w-4 accent-air-500" />
                    Stats
                  </label>
                  <Button variant="ghost" className="px-2.5 py-1" onClick={() => navigate("log", { edit: r.id })}>Edit</Button>
                  <Button variant="ghost" className="px-2.5 py-1 hover:text-bad-400" onClick={() => remove(r)}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
          {filtered.length > shown && (
            <div className="border-t border-night-800 p-4 text-center">
              <Button onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more</Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
