// A machine's own page (#/machine?id=…): how it does on each course, who
// rides it best, your notes, and a shareable summary.

import { useMemo, useState } from "react";
import { buildObservations, inScope, loadCoreRows, scopeFilter } from "../domain/coreData";
import type { AmiiboScope } from "../domain/coreData";
import { formatGameTime } from "../domain/schema";
import type { ID, Millis } from "../domain/schema";
import { groupRows, rankSummaries, stageMedians, summarize } from "../domain/insights";
import type { ResultRow } from "../domain/insights";
import { stageOverview } from "../domain/rankDetails";
import { buildSummary } from "../domain/summaries";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, useLocation } from "../lib/router";
import { Select } from "../components/form";
import { StatsTable } from "../components/StatsTable";
import { AmiiboScopeSelect } from "../components/AmiiboScopeSelect";
import { CopySummaryButton, NotesCard } from "../components/LibraryBits";
import { Card, CardHeader, Notice, Spinner, StatTile, cx } from "../components/ui";
import { stagesFor } from "./StagePage";

const secs = (ms: number) => `${(Math.round(Math.abs(ms) / 10) / 100).toFixed(2)}s`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function MachinePage() {
  const { mode } = useMode();
  const { params } = useLocation();
  const machineId = params.get("id") ?? "";
  const { data: ref_, error, loading } = useReference(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const [formatChoice, setFormatChoice] = useState<ID>(params.get("format") ?? "");
  const [amiiboScope, setAmiiboScope] = useState<AmiiboScope>("trained");

  const formats = ref_ && core.data ? ref_.formats.filter(f => (core.data!.get(f.id) ?? []).some(r => r.entry.machineId === machineId)) : [];
  const recordId = ref_?.settings?.recordFormatIds[mode];
  const format = (ref_ && ref_.formatById.get(formatChoice)) ?? formats.find(f => f.id === recordId) ?? formats[0];

  const data = useMemo(() => {
    if (!ref_ || !core.data || !format) return null;
    const baselineIds = new Set(ref_.profiles.filter(p => p.isBaseline).map(p => p.id));
    const allRows = (core.data.get(format.id) ?? []).filter(r => inScope(amiiboScope, baselineIds, r));
    const rows = allRows.filter(r => r.entry.machineId === machineId);
    const obs = buildObservations(core.data.get(format.id) ?? [], { includeLegendaries: true, latestVersionOnly: false, riderKey: "profile", ...scopeFilter(amiiboScope, ref_.profiles) }, ref_).obs;
    const overview = stageOverview(obs, stagesFor(format, ref_).map(s => s.id), format.disasterThresholdPct);
    return { allRows, rows, obs, overview };
  }, [ref_, core.data, format, machineId, amiiboScope]);

  if (error || core.error) return <Notice tone="bad" title="Couldn't load this machine">{(error ?? core.error)?.message}</Notice>;
  if (loading || core.loading || !ref_ || !core.data) return <Spinner />;
  const machine = ref_.machineById.get(machineId);
  if (!machine) return <Notice tone="bad" title="Machine not found"><Link to="leaderboards" className="underline">Back to Rankings</Link></Notice>;

  const rows = data?.rows ?? [];
  const allRows = data?.allRows ?? [];
  const timed = rows.filter(r => r.entry.status === "finished" && r.entry.finishTimeMs !== null);
  const medians = stageMedians(allRows);
  const overall = summarize("all", rows, medians, () => format);
  const nick = (id: string) => ref_.profileById.get(id)?.nickname ?? "?";
  const amiiboOf = (r: ResultRow) => (r.entry.racer.kind === "amiibo" ? r.entry.racer.profileId : "");

  // Per course: this machine's best and median, and where it places among machines (by each machine's fastest combo median, 2+ races).
  const courses = format ? stagesFor(format, ref_).map(stage => {
    const here = timed.filter(r => r.race.stageId === stage.id);
    const best = [...here].sort((a, b) => (a.entry.finishTimeMs as Millis) - (b.entry.finishTimeMs as Millis))[0];
    const combos = new Map<string, number[]>();
    for (const o of (data?.obs ?? []).filter(o => o.stageId === stage.id)) combos.set(`${o.rider}|${o.machine}`, [...(combos.get(`${o.rider}|${o.machine}`) ?? []), o.timeMs]);
    const perMachine = new Map<ID, number>();
    for (const [k, ts] of combos) {
      if (ts.length < 2) continue;
      const m = k.split("|")[1], med = median(ts);
      if (!perMachine.has(m) || med < perMachine.get(m)!) perMachine.set(m, med);
    }
    const ranked = [...perMachine].sort((a, b) => a[1] - b[1]);
    const pos = ranked.findIndex(([m]) => m === machineId);
    return {
      stage, races: here.length, best,
      medianMs: here.length ? median(here.map(r => r.entry.finishTimeMs as Millis)) : null,
      place: pos >= 0 ? { pos: pos + 1, of: ranked.length, behindMs: ranked[pos][1] - ranked[0][1], leader: ranked[0][0] } : null,
    };
  }) : [];
  const wins = courses.filter(c => c.place?.pos === 1 && c.place.of > 1).length;
  const compared = courses.filter(c => c.place && c.place.of > 1).length;

  const riderTable = rankSummaries([...groupRows(rows, r => r.entry.riderId)].map(([k, list]) => summarize(k, list, medians, () => format)))
    .map(s => ({ id: s.key, label: ref_.riderById.get(s.key)?.name ?? "?", summary: s }));
  const amiiboTable = rankSummaries([...groupRows(rows, amiiboOf)].map(([k, list]) => summarize(k, list, medians, () => format)))
    .map(s => ({ id: s.key, label: nick(s.key), sub: ref_.riderById.get(ref_.profileById.get(s.key)?.riderId ?? "")?.name, summary: s }));

  const summaryText = () => format ? buildSummary({
    kind: "machine", title: machine.name, format, rows, allRows, notes: machine.notes,
    subtitle: compared ? `Fastest machine on ${wins} of ${compared} courses where machines were compared` : undefined,
    names: {
      stage: id => ref_.stageById.get(id)?.name ?? "?", rider: id => ref_.riderById.get(id)?.name ?? "?",
      machine: id => ref_.machineById.get(id)?.name ?? "?", amiibo: nick, stageOrder: id => ref_.stageById.get(id)?.sortOrder ?? 0,
    },
  }) : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="leaderboards" className="text-sm text-night-400 hover:text-night-100">← Rankings</Link>
          <h1 className="mt-1 text-3xl font-bold">{machine.name}</h1>
          <p className="mt-1 text-night-300">{modeLabel(mode)}{machine.isLegendary ? " · legendary machine" : ""}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <AmiiboScopeSelect value={amiiboScope} onChange={setAmiiboScope} show={ref_.profiles.some(p => p.isBaseline)} />
          {formats.length > 1 && (
            <Select aria-label="Format" className="w-auto min-w-56" value={format?.id ?? ""} onChange={e => setFormatChoice(e.target.value)}>
              {formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          )}
          {format && timed.length > 0 && <CopySummaryButton build={summaryText} />}
        </div>
      </div>

      {!format || timed.length === 0 ? (
        <Notice title={`No counted ${machine.name} races yet`}>Log races or run a trial on {machine.name} to see how it does.</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Races" value={timed.length} hint={format.name} />
            <StatTile label="Courses" value={new Set(timed.map(r => r.race.stageId)).size} hint="with a time on it" />
            <StatTile label="Pace vs field" value={overall.pacePct === null ? "—" : `${overall.pacePct > 0 ? "+" : overall.pacePct < 0 ? "−" : "±"}${Math.abs(overall.pacePct).toFixed(1)}%`} hint="vs each course's median" />
            <StatTile label="Fastest machine on" value={compared ? `${wins} of ${compared}` : "—"} hint="courses where 2+ machines were compared" />
          </div>

          <Card>
            <CardHeader title="Course by course" subtitle={`${machine.name}'s best and typical time on each course, and where it places among the machines raced there (each machine at its best amiibo, 2+ races).`} />
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
                    <th className="py-2 pr-3 font-medium">Course</th>
                    <th className="px-2 py-2 text-right font-medium">Races</th>
                    <th className="px-2 py-2 text-right font-medium">Best</th>
                    <th className="px-2 py-2 text-right font-medium">Median</th>
                    <th className="py-2 pl-2 font-medium">Among machines</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-night-800">
                  {courses.map(c => (
                    <tr key={c.stage.id} className={cx(c.races === 0 && "text-night-600")}>
                      <td className="py-2 pr-3"><Link to="stage" params={{ id: c.stage.id, format: format.id }} className="font-medium hover:text-air-400">{c.stage.name}</Link></td>
                      <td className="px-2 py-2 text-right tabular">{c.races || "—"}</td>
                      <td className="px-2 py-2 text-right tabular">{c.best ? <><span className="font-mono">{formatGameTime(c.best.entry.finishTimeMs)}</span><div className="text-xs text-night-400">{nick(amiiboOf(c.best))}</div></> : "not raced"}</td>
                      <td className="px-2 py-2 text-right font-mono tabular">{c.medianMs !== null ? formatGameTime(c.medianMs) : "—"}</td>
                      <td className="py-2 pl-2">
                        {!c.place || c.place.of < 2 ? <span className="text-night-600">—</span>
                          : c.place.pos === 1 ? <span className="text-ok-400">fastest of {c.place.of}</span>
                          : <>{c.place.pos} of {c.place.of} <span className="text-xs text-night-400">({secs(c.place.behindMs)} behind {ref_.machineById.get(c.place.leader)?.name})</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Characters on it" subtitle="Pace vs each course's median." />
              <StatsTable rows={riderTable} columns={["races", "pace"]} labelHead="Character" />
            </Card>
            <Card>
              <CardHeader title="Your amiibo on it" />
              <StatsTable rows={amiiboTable} columns={["races", "pace"]} labelHead="Amiibo" />
            </Card>
          </div>
        </>
      )}

      <NotesCard store="machines" id={machine.id} notes={machine.notes} what={machine.name} />
    </div>
  );
}
