// Leaderboards: characters (Kirby colors on demand), machines, combos and
// your amiibo, ranked by adjusted pace (stage and partner held equal)
// within ONE format, plus a Stages overview.

import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { buildObservations, gameVersionsIn, inScope, loadCoreRows, scopeFilter } from "../domain/coreData";
import type { AmiiboScope, RiderKey } from "../domain/coreData";
import { AmiiboScopeSelect } from "../components/AmiiboScopeSelect";
import { buildLeaderboard, formatGameTime } from "../domain/schema";
import type { Format, ID, LeaderboardRow, LeaderboardSubject, PaceObservation } from "../domain/schema";
import { fullRunMs, subjectDetails, typicalCourseMs } from "../domain/rankDetails";
import type { SubjectDetails } from "../domain/rankDetails";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, useLocation } from "../lib/router";
import { Checkbox, Segmented, Select } from "../components/form";
import { Badge, Card, CardHeader, Notice, Spinner, cx } from "../components/ui";
import { StagesTable } from "./StagePage";
import { CoverageMap, HeadToHead } from "./RankingsExtras";

type View = "characterGroup" | "machine" | "combo" | "profile" | "stages" | "coverage" | "h2h";

const VIEWS: { value: View; label: string }[] = [
  { value: "characterGroup", label: "Characters" },
  { value: "machine", label: "Machines" },
  { value: "combo", label: "Combos" },
  { value: "profile", label: "Your amiibo" },
  { value: "stages", label: "Stages" },
  { value: "coverage", label: "Coverage" },
  { value: "h2h", label: "Head to head" },
];

const VIEW_HELP: Record<Exclude<View, "stages" | "coverage" | "h2h">, string> = {
  characterGroup: "Every character with timed results, with the machine and stage held equal. Kirby's four colors are pooled; open Kirby to see each color.",
  machine: "Each machine, with the rider and stage held equal.",
  combo: "Rider + machine pairs. Synergy is how much better (−) or worse (+) a pair does than its rider and machine predict separately.",
  profile: "Each of your trained amiibo, with machine and stage held equal.",
};

const fmtSigned = (v: number, digits = 1) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}%`;
const fmtSecs = (ms: number) => `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${(Math.round(Math.abs(ms) / 10) / 100).toFixed(2)}s`;
const fmtRunSecs = (ms: number) => `${ms > 0 ? "+" : ms < 0 ? "−" : "±"}${(Math.abs(ms) / 1000).toFixed(1)}s`;

/**
 * Pace as a bar from the average line: right and green = faster,
 * left and red = slower. Length is scaled to the biggest gap in the table.
 * How sure the estimate is lives in Rank (range) and Confidence instead.
 */
export function PaceBar({ row, extent }: { row: LeaderboardRow; extent: number }) {
  const v = Math.max(-extent, Math.min(extent, -row.pacePct)); // positive = faster
  const half = (Math.abs(v) / extent) * 50;
  const faster = v > 0;
  return (
    <div className="relative h-6 w-full" role="img" aria-label={`${fmtSigned(row.pacePct)}: ${faster ? "faster" : "slower"} than average`}>
      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded bg-night-600" />
      {half > 0.2 && (
        <div
          className={cx("absolute top-1/2 h-3.5 -translate-y-1/2", faster ? "rounded-r-md bg-ok-400" : "rounded-l-md bg-bad-400")}
          style={faster ? { left: "50%", width: `${half}%` } : { right: "50%", width: `${half}%` }}
        />
      )}
    </div>
  );
}

const CONFIDENCE: Record<LeaderboardRow["confidence"], { label: string; tone: "ok" | "star" | "neutral"; title: string }> = {
  high: { label: "Solid", tone: "ok", title: "Enough races; the rank is unlikely to change" },
  medium: { label: "Could move", tone: "star", title: "Enough races, but neighbouring ranks overlap" },
  low: { label: "Few races", tone: "neutral", title: "Below the minimum race count; treat as a hint" },
};

type RowKind = "characterGroup" | "rider" | "machine" | "combo" | "profile";

function labelFor(kind: RowKind, key: string, ref_: Reference): { name: string; sub?: string } {
  if (kind === "machine") return { name: ref_.machineById.get(key)?.name ?? "?" };
  if (kind === "characterGroup") return { name: key };
  if (kind === "profile") {
    const p = ref_.profileById.get(key);
    return { name: p?.nickname ?? "?", sub: p ? ref_.riderById.get(p.riderId)?.name : undefined };
  }
  if (kind === "combo") {
    const [r, m] = key.split("|");
    return { name: `${ref_.riderById.get(r)?.name ?? "?"} + ${ref_.machineById.get(m)?.name ?? "?"}` };
  }
  const r = ref_.riderById.get(key);
  return { name: r?.name ?? "?", sub: r?.amiiboFigure === "Kirby" && r.description ? r.description : undefined };
}

function linkFor(kind: RowKind, key: string, ref_: Reference, formatId?: ID): { to: "stats" | "machine"; params: Record<string, string> } | null {
  if (kind === "machine") return { to: "machine", params: formatId ? { id: key, format: formatId } : { id: key } };
  if (kind === "rider") return { to: "stats", params: { rider: key } };
  if (kind === "profile") return { to: "stats", params: { profile: key } };
  if (kind === "characterGroup") {
    const members = ref_.riders.filter(r => r.characterGroup === key);
    return members.length === 1 ? { to: "stats", params: { rider: members[0].id } } : null;
  }
  return null;
}

export function LeaderboardsPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const [formatChoice, setFormatChoice] = useState<ID>("");
  const { params } = useLocation();
  const [viewChoice, setView] = useState<View>(() => (VIEWS.some(v => v.value === params.get("view")) ? params.get("view") as View : "characterGroup"));
  const [stageId, setStageId] = useState<ID>("");
  const [legendaries, setLegendaries] = useState(true);
  const [gameVersion, setGameVersion] = useState<string>("");
  const [amiiboScope, setAmiiboScope] = useState<AmiiboScope>("trained");
  const [latestOnly, setLatestOnly] = useState(false);
  const [details, setDetails] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ col: string; dir: 1 | -1 }>({ col: "rank", dir: 1 });

  const formats: Format[] = ref_?.formats.filter(f => !f.isArchived || (core.data?.get(f.id)?.length ?? 0) > 0) ?? [];
  const timedCount = (f: Format) => (core.data?.get(f.id) ?? []).filter(r => r.entry.finishTimeMs !== null).length;
  const recordId = ref_?.settings?.recordFormatIds[mode];
  const auto = formats.find(f => f.id === recordId && timedCount(f) > 0) ?? [...formats].sort((a, b) => timedCount(b) - timedCount(a))[0];
  const format = (ref_ && ref_.formatById.get(formatChoice)) ?? auto;
  // One racer per race means nobody ever races anybody: no head to head.
  const solo = !!format && format.trackedSeats === 1 && !format.flexibleSeats;
  const views = solo ? VIEWS.filter(v => v.value !== "h2h") : VIEWS;
  const view: View = solo && viewChoice === "h2h" ? "characterGroup" : viewChoice;

  const result = useMemo(() => {
    if (!ref_ || !core.data || !format) return null;
    const rows = core.data.get(format.id) ?? [];
    const filter = {
      stageId: ["stages", "coverage", "h2h"].includes(view) ? undefined : stageId || undefined, includeLegendaries: legendaries, latestVersionOnly: latestOnly,
      gameVersion: gameVersion || undefined,
      ...scopeFilter(amiiboScope, ref_.profiles),
    };
    const obsFor = (riderKey: RiderKey) => buildObservations(rows, { ...filter, riderKey }, ref_);
    const byRider = obsFor("rider");
    const minSample = ref_.settings?.minSample ?? 5;
    const threshold = format.disasterThresholdPct;
    const typical = typicalCourseMs(byRider.obs);
    const run = format.runStructure.kind === "course_set" && !filter.stageId ? fullRunMs(byRider.obs, format.runStructure.stageIds) : null;
    const base = { skippedUntimed: byRider.skippedUntimed, typical, run, byRider: byRider.obs };
    if (view === "stages" || view === "coverage" || view === "h2h") return { ...base, main: [] as LeaderboardRow[], obs: byRider.obs, kind: "rider" as RowKind, details: new Map<string, SubjectDetails>(), byProfile: obsFor("profile").obs, sub: null };

    const keyOf = (o: PaceObservation) => (view === "machine" ? o.machine : view === "combo" ? `${o.rider}|${o.machine}` : o.rider);
    const obs = view === "characterGroup" ? obsFor("characterGroup").obs : view === "profile" ? obsFor("profile").obs : byRider.obs;
    const subject: LeaderboardSubject = view === "profile" ? "rider" : view;
    const main = buildLeaderboard(obs, subject, minSample, 200);
    const kind: RowKind = view === "profile" ? "profile" : view;
    // Characters: Kirby's colors, ranked on their own, for the open row.
    const sub = view === "characterGroup"
      ? { rows: buildLeaderboard(byRider.obs, "rider", minSample, 200), details: subjectDetails(byRider.obs, o => o.rider, threshold) }
      : null;
    return { ...base, main, obs, kind, details: subjectDetails(obs, keyOf, threshold), byProfile: [] as PaceObservation[], sub };
  }, [ref_, core.data, format, view, stageId, legendaries, latestOnly, gameVersion, amiiboScope]);

  const versions = format && core.data ? gameVersionsIn(core.data.get(format.id) ?? []) : [];
  const h2hRows = view === "h2h" && format && core.data && ref_
    ? (core.data.get(format.id) ?? []).filter(r => (!gameVersion || r.race.gameVersion === gameVersion)
      && inScope(amiiboScope, new Set(ref_.profiles.filter(p => p.isBaseline).map(p => p.id)), r))
    : [];

  if (error || core.error) return <Notice tone="bad" title="Couldn't load leaderboards">{(error ?? core.error)?.message}</Notice>;
  if (loading || core.loading || !ref_ || !core.data) return <Spinner />;

  const rows = result?.main ?? [];
  const subRows = result?.sub?.rows ?? [];
  const extent = Math.max(1, ...[...rows, ...subRows].map(r => Math.abs(r.pacePct))) * 1.05;
  const partnerHead = view === "machine" ? "Riders tried" : "Machines tried";
  const typical = result?.typical ?? null;
  const run = result?.run ?? null;
  const obsCount = result?.obs.length ?? 0;
  const stagesCount = new Set(result?.obs.map(o => o.stageId)).size;
  const showRun = details && !!run;

  const membersOf = (group: string) => ref_.riders.filter(r => r.characterGroup === group).map(r => r.id);
  const toggle = (key: string) => setOpen(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  const stageSelected = !!stageId;
  const timeOf = (o: PaceObservation | null | undefined) => o?.timeMs ?? null;
  const whoRode = (o: PaceObservation) => {
    const amiibo = o.profileId ? ref_.profileById.get(o.profileId)?.nickname : undefined;
    const machine = ref_.machineById.get(o.machine)?.name;
    return view === "machine" ? amiibo ?? "?" : view === "profile" ? machine ?? "?" : view === "combo" ? amiibo ?? "?" : `${amiibo ?? "?"} · ${machine ?? "?"}`;
  };
  const stageCell = (x: { stageId: ID; pct: number } | null | undefined, good: boolean) =>
    x ? <><span className="text-night-100">{ref_.stageById.get(x.stageId)?.name}</span> <span className={good ? "text-ok-400" : "text-bad-400"}>{fmtSigned(x.pct)}</span></> : "—";

  type Col = {
    id: string; head: ReactNode; title?: string; right?: boolean; className?: string;
    cell: (row: LeaderboardRow, det: SubjectDetails | undefined) => ReactNode;
    /** Sort value; lower first unless `bigFirst`. null sorts last. */
    sort?: (row: LeaderboardRow, det: SubjectDetails | undefined) => number | string | null;
    bigFirst?: boolean;
  };
  const cols: Col[] = [
    {
      id: "pace", right: true, head: "Pace", sort: r => r.pacePct,
      title: "How much faster (−) or slower (+) than average, with stage and partner held equal; underneath, what that is in seconds on a typical course",
      cell: r => <>
        <div className="font-semibold text-night-100">{fmtSigned(r.pacePct)}</div>
        {typical !== null && <div className="text-xs text-night-400">{fmtSecs(typical * r.pacePct / 100)}/course</div>}
      </>,
    },
    {
      id: "bar", className: "w-64 min-w-56 px-4",
      head: <span className="flex justify-between text-[11px] normal-case tracking-normal"><span>◀ slower</span><span>faster ▶</span></span>,
      title: "Bars grow from the average line in the middle: green to the right = faster, red to the left = slower.",
      cell: r => <PaceBar row={r} extent={extent} />,
    },
    ...(showRun ? [{
      id: "run", right: true, head: "Full run", sort: (r: LeaderboardRow) => r.pacePct,
      title: `The pace over a full ${format?.runStructure.kind === "course_set" ? format.runStructure.stageIds.length : ""}-course run`,
      cell: (r: LeaderboardRow) => fmtRunSecs(run!.ms * r.pacePct / 100),
    }] : []),
    ...(view === "combo" ? [{
      id: "synergy", right: true, head: "Synergy", sort: (r: LeaderboardRow) => r.synergyPct ?? null,
      title: "Better (−) or worse (+) than this rider and this machine would predict separately",
      cell: (r: LeaderboardRow) => (r.synergyPct === undefined ? "—" : fmtSigned(r.synergyPct)),
    }] : []),
    { id: "races", right: true, head: "Races", sort: r => r.sampleSize, bigFirst: true, cell: r => r.sampleSize },
    {
      id: "spread", right: true, head: "Spread", sort: (_r, d) => d?.spreadPct ?? null,
      title: "How much its times vary race to race on the same course with the same partner. Lower = more consistent.",
      cell: (_r, d) => (d?.spreadPct != null ? `±${d.spreadPct.toFixed(1)}%` : "—"),
    },
    ...(details ? [
      {
        id: "simple", right: true, head: "Simple pace", sort: (r: LeaderboardRow) => r.rawPacePct,
        title: "Its plain average against each course's typical time, without allowing for what it was paired with. If it's far from Pace, it mostly raced with unusually fast or slow partners.",
        cell: (r: LeaderboardRow) => <span className="text-night-300">{fmtSigned(r.rawPacePct)}</span>,
      },
      { id: "stages", right: true, head: "Stages", sort: (r: LeaderboardRow) => r.stagesCovered, bigFirst: true, cell: (r: LeaderboardRow) => r.stagesCovered },
      { id: "partners", right: true, head: partnerHead, sort: (r: LeaderboardRow) => r.partnersCovered, bigFirst: true, cell: (r: LeaderboardRow) => r.partnersCovered },
      {
        id: "disasters", right: true, head: "Disasters", sort: (_r: LeaderboardRow, d: SubjectDetails | undefined) => d?.disasterRate ?? null,
        title: `Races more than ${format?.disasterThresholdPct ?? 5}% slower than that combo's usual time on that course`,
        cell: (_r: LeaderboardRow, d: SubjectDetails | undefined) => (d?.disasterRate != null ? `${Math.round(d.disasterRate * 100)}%` : "—"),
      },
      ...(stageSelected ? [
        {
          id: "best", right: true, head: "Best", sort: (_r: LeaderboardRow, d: SubjectDetails | undefined) => timeOf(d?.best),
          title: "Fastest single race on this course, and who/what it was with",
          cell: (_r: LeaderboardRow, d: SubjectDetails | undefined) => (d?.best ? <><div className="font-mono text-star-400">{formatGameTime(d.best.timeMs)}</div><div className="text-xs text-night-400">{whoRode(d.best)}</div></> : "—"),
        },
        {
          id: "worst", right: true, head: "Worst", sort: (_r: LeaderboardRow, d: SubjectDetails | undefined) => timeOf(d?.worst),
          title: "Slowest finished race on this course",
          cell: (_r: LeaderboardRow, d: SubjectDetails | undefined) => (d?.worst ? <><div className="font-mono text-night-300">{formatGameTime(d.worst.timeMs)}</div><div className="text-xs text-night-400">{whoRode(d.worst)}</div></> : "—"),
        },
      ] : [
        { id: "strongest", head: "Strongest", title: "Course where it beats the course's typical time by the most (2+ races there)", cell: (_r: LeaderboardRow, d: SubjectDetails | undefined) => <span className="text-xs">{stageCell(d?.strongest, true)}</span> },
        { id: "weakest", head: "Weakest", title: "Course where it's furthest behind the course's typical time (2+ races there)", cell: (_r: LeaderboardRow, d: SubjectDetails | undefined) => <span className="text-xs">{stageCell(d?.weakest, false)}</span> },
      ]),
    ] : []),
  ];

  const rankCol: Col = { id: "rank", head: "Rank", title: "Rank by pace, and the range it could realistically be in. Click any heading to sort by it.", sort: r => r.rank, cell: () => null, className: "pr-3" };
  const nameCol: Col = { id: "name", head: view === "characterGroup" ? "Character" : VIEWS.find(v => v.value === view)?.label.replace(/s$/, ""), sort: r => ref_.riderById.get(r.key)?.name ?? labelFor(result?.kind ?? "rider", r.key, ref_).name, cell: () => null, className: "pr-3" };
  // Sorting: by rank unless a column header was clicked.
  const sortCol = [rankCol, nameCol, ...cols].find(c => c.id === sort.col && c.sort);
  const ordered = <T extends LeaderboardRow>(list: T[], detOf: (r: T) => SubjectDetails | undefined): T[] => {
    if (!sortCol) return list;
    const dir = sort.dir;
    return [...list].sort((a, b) => {
      const va = sortCol.sort!(a, detOf(a)), vb = sortCol.sort!(b, detOf(b));
      if (va === null && vb === null) return a.rank - b.rank;
      if (va === null) return 1;
      if (vb === null) return -1;
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return (c || a.rank - b.rank) * dir;
    });
  };
  const clickSort = (c: Col) => setSort(prev =>
    prev.col === c.id ? { col: c.id, dir: prev.dir === 1 ? -1 : 1 } : { col: c.id, dir: c.bigFirst ? -1 : 1 });
  const headCell = (c: Col) => {
    const active = sortCol?.id === c.id;
    const label = <>{c.head}{active && <span aria-hidden className="ml-1">{sort.dir === 1 ? "▲" : "▼"}</span>}</>;
    return (
      <th key={c.id} title={c.title} aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
        className={cx("py-2 font-medium", c.className ?? "px-2", c.right && "text-right")}>
        {c.sort ? <button type="button" onClick={() => clickSort(c)} className={cx("uppercase tracking-wider hover:text-night-100", active && "text-night-100")}>{label}</button> : label}
      </th>
    );
  };

  const renderRow = (row: LeaderboardRow, kind: RowKind, det: SubjectDetails | undefined, opts: { child?: boolean; expandable?: boolean; expanded?: boolean } = {}) => {
    const { name, sub } = labelFor(kind, row.key, ref_);
    const link = linkFor(kind, row.key, ref_, format?.id);
    const conf = CONFIDENCE[row.confidence];
    const nameEl = link
      ? <Link to={link.to} params={link.params} className="font-medium hover:text-air-400">{name}</Link>
      : <span className="font-medium">{name}</span>;
    return (
      <tr key={`${kind}:${row.key}`} className={cx(row.confidence === "low" && "text-night-300", opts.child && "bg-night-850/60")}>
        <td className="py-2.5 pr-3 tabular">
          {opts.child ? <span className="pl-3 text-night-600">└</span> : <>
            <span className="font-display text-base font-bold text-night-100">{row.rank}</span>
            {row.rankLow !== row.rankHigh && <span className="ml-1.5 text-xs text-night-400">({row.rankLow}–{row.rankHigh})</span>}
          </>}
        </td>
        <td className={cx("py-2.5 pr-3", opts.child && "pl-4")}>
          {opts.expandable ? (
            <button type="button" onClick={() => toggle(row.key)} aria-expanded={opts.expanded} aria-label={`${name}: ${opts.expanded ? "hide" : "show"} colors`} className="flex items-center gap-1.5 font-medium hover:text-air-400">
              <span aria-hidden className={cx("inline-block text-xs text-night-400 transition-transform", opts.expanded && "rotate-90")}>▶</span>{name}
              <span className="whitespace-nowrap text-xs font-normal text-night-400">{membersOf(row.key).length} colors</span>
            </button>
          ) : nameEl}
          {sub && <div className="text-xs text-night-400">{sub}</div>}
        </td>
        {cols.map(c => <td key={c.id} className={cx("py-2.5 tabular", c.className ?? "px-2", c.right && "text-right")}>{c.cell(row, det)}</td>)}
        <td className="py-2.5 pl-2 text-right"><span title={conf.title}><Badge tone={conf.tone}>{conf.label}</Badge></span></td>
      </tr>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{modeLabel(mode)} leaderboards</h1>
        <p className="mt-1 max-w-3xl text-night-300">
          Ranked by <strong className="text-night-100">adjusted pace</strong>: how much faster (−) or slower (+) than average,
          with the stage and the partner (machine or rider) held equal. So a rider who mostly raced a slow machine isn't penalised for it.
        </p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Format</span>
            <Select aria-label="Format" className="w-auto min-w-64" value={format?.id ?? ""} onChange={e => setFormatChoice(e.target.value)}>
              {formats.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === recordId ? " ★" : ""} ({timedCount(f)} timed)</option>)}
            </Select>
          </label>
          {(view !== "stages" && view !== "coverage" && view !== "h2h") && (
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Stage</span>
              <Select aria-label="Stage" className="w-auto min-w-52" value={stageId} onChange={e => setStageId(e.target.value)}>
                <option value="">All stages</option>
                {ref_.stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </label>
          )}
          {versions.length > 1 && (
            <label className="space-y-1.5">
              <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Game version</span>
              <Select aria-label="Game version" className="w-auto min-w-40" value={gameVersion} onChange={e => setGameVersion(e.target.value)}>
                <option value="">All versions</option>
                {versions.map(v => <option key={v} value={v}>Ver. {v}</option>)}
              </Select>
            </label>
          )}
          <AmiiboScopeSelect value={amiiboScope} onChange={setAmiiboScope} show={ref_.profiles.some(p => p.isBaseline)} />
          <div className="flex flex-wrap gap-x-6 gap-y-2 pb-2">
            <Checkbox checked={legendaries} onChange={setLegendaries} label="Include Dragoon & Hydra" />
            <Checkbox checked={latestOnly} onChange={setLatestOnly} label="Latest version of each amiibo only" />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented label="Rank" value={view} onChange={setView} options={views} />
          {!["stages", "coverage", "h2h"].includes(view) && <Checkbox checked={details} onChange={setDetails} label="Details" />}
        </div>
      </Card>

      {!format ? (
        <Notice title={`No ${modeLabel(mode)} formats`} />
      ) : view === "stages" ? (
        <StagesTable format={format} ref_={ref_} byProfile={result?.byProfile ?? []} byRider={result?.byRider ?? []} />
      ) : view === "coverage" ? (
        <CoverageMap format={format} ref_={ref_} obs={result?.byRider ?? []} />
      ) : view === "h2h" ? (
        <HeadToHead format={format} ref_={ref_} rows={h2hRows} />
      ) : rows.length === 0 ? (
        <Notice title="Nothing to rank yet">
          Leaderboards use finish times from counted races in "{format.name}"{stageId ? " on this stage" : ""}.
          {result && result.skippedUntimed > 0 ? ` ${result.skippedUntimed} results have a place but no time, so they can't be used here.` : ""}{" "}
          <Link to="log" className="font-semibold text-air-400 underline">Log races</Link> or run a trial to fill it.
        </Notice>
      ) : (
        <Card>
          <CardHeader
            title={`${VIEWS.find(v => v.value === view)?.label} · ${format.name}${stageId ? ` · ${ref_.stageById.get(stageId)?.name}` : ""}`}
            subtitle={`${VIEW_HELP[view]} From ${obsCount} timed results on ${stagesCount} stage${stagesCount === 1 ? "" : "s"}.${result && result.skippedUntimed ? ` ${result.skippedUntimed} untimed results not used.` : ""}`}
          />
          <div className="-mx-5 overflow-x-auto px-5">
            <table className={cx("w-full text-sm", details ? "min-w-[76rem]" : "min-w-[46rem]")}>
              <thead>
                <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
                  {headCell(rankCol)}
                  {headCell(nameCol)}
                  {cols.map(headCell)}
                  <th className="py-2 pl-2 text-right font-medium">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {ordered(rows, r => result!.details.get(r.key)).map(row => {
                  if (view !== "characterGroup") return renderRow(row, result!.kind, result!.details.get(row.key));
                  const members = membersOf(row.key);
                  const children = ordered(subRows.filter(r => members.includes(r.key)).sort((a, b) => a.pacePct - b.pacePct), r => result!.sub!.details.get(r.key));
                  const expandable = members.length > 1 && children.length > 0;
                  const expanded = expandable && open.has(row.key);
                  return (
                    <Fragment key={row.key}>
                      {renderRow(row, "characterGroup", result!.details.get(row.key), { expandable, expanded })}
                      {expanded && children.map(c => renderRow(c, "rider", result!.sub!.details.get(c.key), { child: true }))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-night-400">
            Bars grow from the average line in the middle: green to the right is faster, red to the left is slower, and longer means a bigger gap. How settled each rank is shows in Rank (the range in brackets) and Confidence. Click a column heading to sort by it.
            {typical !== null && ` Seconds are on a typical course here (${formatGameTime(typical)}).`}
            {showRun && ` Full run is over all ${format.runStructure.kind === "course_set" ? format.runStructure.stageIds.length : ""} courses (${formatGameTime(run!.ms)} at average pace${run!.estimatedStages ? `; ${run!.estimatedStages} courses not raced yet are estimated` : ""}).`}
            {view === "characterGroup" && " Kirby's colors are ranked on their own when opened, so their numbers can differ a little from the pooled Kirby row."}
          </p>
        </Card>
      )}
    </div>
  );
}
