// Stages: an overview table of every course in a format (Rankings → Stages),
// and a detail page per course.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { inScope, loadCoreRows } from "../domain/coreData";
import type { AmiiboScope } from "../domain/coreData";
import { AmiiboScopeSelect } from "../components/AmiiboScopeSelect";
import { CopySummaryButton, NotesCard } from "../components/LibraryBits";
import { buildSummary } from "../domain/summaries";
import { formatGameTime } from "../domain/schema";
import type { Format, ID, Millis, PaceObservation } from "../domain/schema";
import { stageOverview } from "../domain/rankDetails";
import type { StageOverview } from "../domain/rankDetails";
import { groupRows, rankSummaries, stageMedians, summarize } from "../domain/insights";
import type { ResultRow } from "../domain/insights";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, useLocation } from "../lib/router";
import { Checkbox, Select } from "../components/form";
import { StatsTable } from "../components/StatsTable";
import type { ColumnKey } from "../components/StatsTable";
import { Card, CardHeader, Notice, Spinner, StatTile, cx } from "../components/ui";

const pct = (v: number | null, digits = 0) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`);
const secs = (ms: number) => `${(Math.round(ms / 10) / 100).toFixed(2)}s`;

/** Stages in display order: the format's course list for full-run formats, else every stage of the mode. */
export function stagesFor(format: Format, ref_: Reference) {
  const ids = format.runStructure.kind === "course_set" ? new Set(format.runStructure.stageIds) : null;
  return ref_.stages.filter(s => s.mode === format.mode && (!ids || ids.has(s.id)));
}

function who(o: PaceObservation, ref_: Reference) {
  return `${ref_.profileById.get(o.rider)?.nickname ?? "?"} · ${ref_.machineById.get(o.machine)?.name ?? "?"}`;
}

// -------------------------------------------------------------
// Course facts: short highlights under the Stages table
// -------------------------------------------------------------

function stageFacts(overview: StageOverview[], total: number, ref_: Reference, name: (id: ID) => string): { label: string; text: ReactNode }[] {
  const raced = overview.filter(o => o.races > 0);
  if (!raced.length) return [];
  const facts: { label: string; text: ReactNode }[] = [];
  const b = (t: ReactNode) => <span className="font-semibold">{t}</span>;
  const by = <T,>(list: T[], f: (x: T) => number) => [...list].sort((x, y) => f(x) - f(y));

  const risky = by(raced.filter(o => (o.disasterRate ?? 0) > 0), o => -(o.disasterRate ?? 0))[0];
  if (risky) facts.push({ label: "Riskiest", text: <>{b(name(risky.stageId))}: {pct(risky.disasterRate)} of races are disasters</> });
  const clean = raced.filter(o => o.disasterRate === 0).length;
  if (clean) facts.push({ label: "Disaster-free", text: <>{b(clean)} course{clean === 1 ? "" : "s"} with no disasters yet</> });

  const noisy = raced.filter(o => o.noisePct !== null);
  if (noisy.length) {
    const most = by(noisy, o => -(o.noisePct ?? 0))[0];
    facts.push({ label: "Most unpredictable", text: <>{b(name(most.stageId))}: times vary ±{most.noisePct!.toFixed(1)}% race to race</> });
    const least = by(noisy, o => o.noisePct ?? 0)[0];
    if (least.stageId !== most.stageId) facts.push({ label: "Most consistent", text: <>{b(name(least.stageId))}: only ±{least.noisePct!.toFixed(1)}% race to race</> });
  }

  const gaps = raced.filter(o => o.machineGap);
  if (gaps.length) {
    const most = by(gaps, o => -o.machineGap!.gapMs)[0];
    facts.push({ label: "Machine matters most", text: <>{b(name(most.stageId))}: {ref_.machineById.get(most.machineGap!.fastest)?.name} is {secs(most.machineGap!.gapMs)} ahead of the next machine</> });
    const least = by(gaps, o => o.machineGap!.gapMs)[0];
    if (least.stageId !== most.stageId) facts.push({ label: "Machine barely matters", text: <>{b(name(least.stageId))}: the top two machines are only {secs(least.machineGap!.gapMs)} apart</> });
  }

  const room = by(raced.filter(o => o.best && o.medianMs && o.races >= 3), o => o.best!.timeMs / o.medianMs! - 1)[0];
  if (room) facts.push({ label: "Most room to improve", text: <>{b(name(room.stageId))}: your best is {secs(room.medianMs! - room.best!.timeMs)} faster than a typical race there</> });

  const holders = new Map<string, number>();
  for (const o of raced) if (o.best?.profileId) holders.set(o.best.profileId, (holders.get(o.best.profileId) ?? 0) + 1);
  const top = [...holders].sort((x, y) => y[1] - x[1])[0];
  if (top) facts.push({ label: "Record holder", text: <>{b(ref_.profileById.get(top[0])?.nickname ?? "?")} holds {top[1]} of {raced.length} course records</> });

  const newest = by(raced.filter(o => o.best?.racedAt), o => -Date.parse(o.best!.racedAt!))[0];
  if (newest) facts.push({ label: "Newest record", text: <>{b(name(newest.stageId))}: {formatGameTime(newest.best!.timeMs)} on {new Date(newest.best!.racedAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</> });

  const timed = raced.filter(o => o.medianMs !== null);
  if (timed.length > 1) {
    const long = by(timed, o => -o.medianMs!)[0], short = by(timed, o => o.medianMs!)[0];
    facts.push({ label: "Longest and shortest", text: <>{b(name(long.stageId))} ({formatGameTime(long.medianMs)}) and {b(name(short.stageId))} ({formatGameTime(short.medianMs)})</> });
  }

  const mostRaced = by(raced, o => -o.races)[0];
  facts.push({ label: "Most raced", text: <>{b(name(mostRaced.stageId))}: {mostRaced.races} races</> });
  const missing = total - raced.length;
  const thin = by(raced, o => o.races)[0];
  facts.push({
    label: "Needs data",
    text: missing ? <>{b(missing)} course{missing === 1 ? "" : "s"} never raced</> : <>{b(name(thin.stageId))} has the fewest races ({thin.races})</>,
  });
  return facts;
}

// -------------------------------------------------------------
// Overview table (Rankings → Stages)
// -------------------------------------------------------------

/**
 * `byProfile`: observations keyed by amiibo (names the best times);
 * `byRider`: the same results keyed by character (for coverage).
 */
export function StagesTable({ format, ref_, byProfile, byRider }: {
  format: Format; ref_: Reference; byProfile: PaceObservation[]; byRider: PaceObservation[];
}) {
  const stages = stagesFor(format, ref_);
  const overview = useMemo(
    () => stageOverview(byProfile, stages.map(s => s.id), format.disasterThresholdPct),
    [byProfile, stages, format.disasterThresholdPct],
  );
  const ridersTried = (stageId: ID) => new Set(byRider.filter(o => o.stageId === stageId).map(o => o.rider)).size;
  const raced = overview.filter(o => o.races > 0);
  const name = (id: ID) => ref_.stageById.get(id)?.name ?? "?";
  const facts = stageFacts(overview, stages.length, ref_, name);

  return (
    <Card>
      <CardHeader
        title={`Stages · ${format.name}`}
        subtitle={`${raced.length} of ${stages.length} courses raced. Click a course for machines, characters and your best times there.`}
      />
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[60rem] text-sm">
          <thead>
            <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
              <th className="py-2 pr-3 font-medium">Stage</th>
              <th className="px-2 py-2 text-right font-medium">Races</th>
              <th className="px-2 py-2 text-right font-medium" title="Fastest time ever logged here in this format">Best ever</th>
              <th className="px-2 py-2 text-right font-medium" title="Slowest finished time logged here">Worst</th>
              <th className="px-2 py-2 text-right font-medium" title="Median of every time here">Median</th>
              <th className="px-2 py-2 font-medium" title="The amiibo + machine with the fastest median here (2+ races)">Best combo</th>
              <th className="px-2 py-2 text-right font-medium" title="Typical race-to-race spread with the same amiibo and machine. High = needs more races to rank anything.">Noise</th>
              <th className="px-2 py-2 text-right font-medium" title={`Races more than ${format.disasterThresholdPct}% slower than that combo's usual time here`}>Disasters</th>
              <th className="px-2 py-2 font-medium" title="Gap between the fastest and second-fastest machine here (each with its best amiibo, 2+ races)">Machine matters</th>
              <th className="py-2 pl-2 text-right font-medium" title="Characters and machines raced here">Tried</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-night-800">
            {overview.map(o => (
              <tr key={o.stageId} className={cx(o.races === 0 && "text-night-600")}>
                <td className="py-2.5 pr-3">
                  <Link to="stage" params={{ id: o.stageId, format: format.id }} className="font-medium hover:text-air-400">{name(o.stageId)}</Link>
                </td>
                <td className="px-2 py-2.5 text-right tabular">{o.races || "—"}</td>
                <td className="px-2 py-2.5 text-right tabular">
                  {o.best ? <><div className="font-semibold text-star-400">{formatGameTime(o.best.timeMs)}</div><div className="text-xs text-night-400">{who(o.best, ref_)}</div></> : "—"}
                </td>
                <td className="px-2 py-2.5 text-right tabular text-night-300">{o.worst && o.races > 1 ? formatGameTime(o.worst.timeMs) : "—"}</td>
                <td className="px-2 py-2.5 text-right tabular">{o.medianMs !== null ? formatGameTime(o.medianMs) : "—"}</td>
                <td className="px-2 py-2.5">
                  {o.bestCombo ? <><div>{ref_.profileById.get(o.bestCombo.rider)?.nickname ?? "?"} · {ref_.machineById.get(o.bestCombo.machine)?.name}</div><div className="text-xs text-night-400 tabular">median {formatGameTime(o.bestCombo.medianMs)} ({o.bestCombo.n})</div></> : "—"}
                </td>
                <td className="px-2 py-2.5 text-right tabular">{o.noisePct !== null ? `±${o.noisePct.toFixed(1)}%` : "—"}</td>
                <td className="px-2 py-2.5 text-right tabular">{pct(o.disasterRate)}</td>
                <td className="px-2 py-2.5 text-xs">
                  {o.machineGap ? <><span className="text-night-100">{ref_.machineById.get(o.machineGap.fastest)?.name}</span> by {secs(o.machineGap.gapMs)} over {ref_.machineById.get(o.machineGap.second)?.name}</> : "—"}
                </td>
                <td className="py-2.5 pl-2 text-right text-xs tabular text-night-300">
                  {o.races ? <>{ridersTried(o.stageId)}/{ref_.riders.length} chars · {o.machinesTried}/{ref_.machines.length} machines</> : "not raced"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-night-400">
        Noise and disasters only use amiibo + machine pairs raced at least twice on that course. Best and worst are single races: interesting, but mostly luck, so they don't decide any ranking.
      </p>
      {facts.length > 0 && (
        <div className="mt-6 border-t border-night-800 pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-night-400">Course facts</h3>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3" aria-label="Course facts">
            {facts.map(f => (
              <li key={f.label} className="rounded-xl bg-night-850 px-3 py-2.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-night-400">{f.label}</span>
                <div className="mt-0.5">{f.text}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------
// Stage detail page
// -------------------------------------------------------------

const DETAIL_COLUMNS: ColumnKey[] = ["races", "best", "median", "meanCi", "spread", "disasters"];

export function StagePage() {
  const { mode } = useMode();
  const { params } = useLocation();
  const stageId = params.get("id") ?? "";
  const { data: ref_, error, loading } = useReference(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const [formatChoice, setFormatChoice] = useState<ID>(params.get("format") ?? "");
  const [amiiboScope, setAmiiboScope] = useState<AmiiboScope>("trained");

  if (error || core.error) return <Notice tone="bad" title="Couldn't load this stage">{(error ?? core.error)?.message}</Notice>;
  if (loading || core.loading || !ref_ || !core.data) return <Spinner />;
  const stage = ref_.stageById.get(stageId);
  if (!stage) return <Notice tone="bad" title="Stage not found"><Link to="leaderboards" className="underline">Back to Rankings</Link></Notice>;

  const formats = ref_.formats.filter(f => f.mode === stage.mode && (core.data!.get(f.id) ?? []).some(r => r.race.stageId === stageId));
  const format = ref_.formatById.get(formatChoice) ?? formats[0] ?? ref_.formatById.get(ref_.settings?.recordFormatIds[mode] ?? "");
  const baselineIds = new Set(ref_.profiles.filter(p => p.isBaseline).map(p => p.id));
  const rows: ResultRow[] = (format ? core.data.get(format.id) ?? [] : []).filter(r => r.race.stageId === stageId
    && inScope(amiiboScope, baselineIds, r));
  const timed = rows.filter(r => r.entry.status === "finished" && r.entry.finishTimeMs !== null)
    .sort((a, b) => (a.entry.finishTimeMs as Millis) - (b.entry.finishTimeMs as Millis));
  const medians = stageMedians(rows);
  const amiiboOf = (r: ResultRow) => (r.entry.racer.kind === "amiibo" ? r.entry.racer.profileId : "");
  const nick = (id: string) => ref_.profileById.get(id)?.nickname ?? "?";

  const table = (keyOf: (r: ResultRow) => string, label: (k: string) => { label: string; sub?: string }) =>
    rankSummaries([...groupRows(rows, keyOf)].map(([k, list]) => summarize(k, list, medians, () => format)))
      .sort((a, b) => (a.times?.medianMs ?? Infinity) - (b.times?.medianMs ?? Infinity))
      .map(s => ({ id: s.key, ...label(s.key), summary: s }));

  const machines = table(r => r.entry.machineId, k => ({ label: ref_.machineById.get(k)?.name ?? "?" }));
  const characters = table(r => r.entry.riderId, k => {
    const rd = ref_.riderById.get(k);
    return { label: rd?.name ?? "?", sub: rd?.amiiboFigure === "Kirby" ? rd.description : undefined };
  });
  const combos = table(r => `${amiiboOf(r)}|${r.entry.machineId}`, k => {
    const [p, m] = k.split("|");
    return { label: `${nick(p)} · ${ref_.machineById.get(m)?.name ?? "?"}`, sub: ref_.riderById.get(ref_.profileById.get(p)?.riderId ?? "")?.name };
  });
  const triedRiders = new Set(rows.map(r => r.entry.riderId));
  const triedMachines = new Set(rows.map(r => r.entry.machineId));
  const untriedRiders = ref_.riders.filter(r => !triedRiders.has(r.id));
  const untriedMachines = ref_.machines.filter(m => !triedMachines.has(m.id));
  const best = timed[0], worst = timed[timed.length - 1];
  const fmtWho = (r: ResultRow) => `${nick(amiiboOf(r))} · ${ref_.machineById.get(r.entry.machineId)?.name ?? "?"} · ${new Date(r.race.racedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  const median = timed.length ? (timed.length % 2 ? timed[timed.length >> 1].entry.finishTimeMs! : (timed[timed.length / 2 - 1].entry.finishTimeMs! + timed[timed.length / 2].entry.finishTimeMs!) / 2) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="leaderboards" className="text-sm text-night-400 hover:text-night-100">← Rankings</Link>
          <h1 className="mt-1 text-3xl font-bold">{stage.name}</h1>
          <p className="mt-1 text-night-300">{modeLabel(stage.mode)}{stage.defaultLaps ? ` · ${stage.defaultLaps} laps by default` : ""}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <AmiiboScopeSelect value={amiiboScope} onChange={setAmiiboScope} show={ref_.profiles.some(p => p.isBaseline)} />
          {format && timed.length > 0 && <CopySummaryButton build={() => buildSummary({
            kind: "stage", title: stage.name, format, rows, allRows: rows, notes: stage.notes,
            names: {
              stage: id => ref_.stageById.get(id)?.name ?? "?", rider: id => ref_.riderById.get(id)?.name ?? "?",
              machine: id => ref_.machineById.get(id)?.name ?? "?", amiibo: nick, stageOrder: id => ref_.stageById.get(id)?.sortOrder ?? 0,
            },
          })} />}
          {formats.length > 1 && (
            <Select aria-label="Format" className="w-auto min-w-56" value={format?.id ?? ""} onChange={e => setFormatChoice(e.target.value)}>
              {formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          )}
        </div>
      </div>

      {!format || timed.length === 0 ? (
        <Notice title="No counted races here yet">Log races or run a trial on {stage.name} to see its stats.</Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Races" value={timed.length} hint={format.name} />
            <StatTile label="Best ever" value={<span className="text-star-400">{formatGameTime(best.entry.finishTimeMs)}</span>} hint={fmtWho(best)} />
            <StatTile label="Median" value={formatGameTime(median)} hint="every counted time here" />
            <StatTile label="Worst" value={formatGameTime(worst.entry.finishTimeMs)} hint={timed.length > 1 ? fmtWho(worst) : undefined} />
          </div>

          <Card>
            <CardHeader title="Your amiibo + machine" subtitle="Fastest median first. Times compare directly because it's all one course." />
            <StatsTable rows={combos} columns={DETAIL_COLUMNS} labelHead="Combo" />
          </Card>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Machines here" subtitle="Every amiibo pooled, so a machine raced mostly by a slow amiibo looks slower than it is." />
              <StatsTable rows={machines} columns={["races", "best", "median", "disasters"]} labelHead="Machine" />
            </Card>
            <Card>
              <CardHeader title="Characters here" subtitle="Every machine pooled." />
              <StatsTable rows={characters} columns={["races", "best", "median", "disasters"]} labelHead="Character" />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Top 10 times" />
              <ol className="space-y-1.5 text-sm">
                {timed.slice(0, 10).map((r, i) => (
                  <li key={`${r.race.id}-${r.entry.id}`} className="flex items-baseline justify-between gap-3">
                    <span><span className="inline-block w-6 text-night-400">{i + 1}.</span>{fmtWho(r)}</span>
                    <span className={cx("font-mono tabular", i === 0 && "font-semibold text-star-400")}>{formatGameTime(r.entry.finishTimeMs)}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card>
              <CardHeader title="Not raced here yet" subtitle="Gaps in the data for this course." />
              <div className="space-y-2 text-sm">
                <p><span className="text-night-400">Characters: </span>{untriedRiders.length ? untriedRiders.map(r => r.name).join(", ") : "all tried"}</p>
                <p><span className="text-night-400">Machines: </span>{untriedMachines.length ? untriedMachines.map(m => m.name).join(", ") : "all tried"}</p>
              </div>
            </Card>
          </div>
        </>
      )}
      <NotesCard store="stages" id={stage.id} notes={stage.notes} what={stage.name} />
    </div>
  );
}
