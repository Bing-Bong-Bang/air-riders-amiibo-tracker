// Personal stat page for a character (#/stats?rider=ID) or one amiibo (#/stats?profile=ID).
// Uses core records only: counted races, from trials that count, in the chosen format.

import { useState } from "react";
import { loadCoreRows } from "../domain/coreData";
import { allowsRetirement, formatGameTime, formatGap } from "../domain/schema";
import type { FigurePlayerProfile, Format, ID } from "../domain/schema";
import { compareWithBaseline } from "../domain/baseline";
import { AmiiboBreakdown } from "./AmiiboBreakdown";
import { CopySummaryButton, NotesCard } from "../components/LibraryBits";
import { buildSummary } from "../domain/summaries";
import { groupRows, rankSummaries, stageMedians, summarize } from "../domain/insights";
import type { ResultRow } from "../domain/insights";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { snapshotLabel, useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate, useLocation } from "../lib/router";
import { Select } from "../components/form";
import { OVERALL_COLUMNS, STAGE_COLUMNS, StatsTable, fmtPace, fmtPct, fmtPlace, fmtRetired, retiredColumnIf } from "../components/StatsTable";
import type { StatsTableRow } from "../components/StatsTable";
import { Badge, Button, Card, CardHeader, Notice, Spinner, StatTile, cx } from "../components/ui";

function SubjectStats({ format, allRows, rows, ref_, isProfile }: {
  format: Format; allRows: ResultRow[]; rows: ResultRow[]; ref_: Reference; isProfile: boolean;
}) {
  const medians = stageMedians(allRows); // vs everyone in this format, not just this subject
  const formatOf = () => format;
  const overall = summarize("all", rows, medians, formatOf);

  const table = (keyOf: (r: ResultRow) => string, label: (k: string) => { label: string; sub?: string }): StatsTableRow[] =>
    rankSummaries([...groupRows(rows, keyOf)].map(([k, rs]) => summarize(k, rs, medians, formatOf)))
      .map(s => ({ id: s.key, ...label(s.key), summary: s }));

  const byMachine = table(r => r.entry.machineId, k => ({ label: ref_.machineById.get(k)?.name ?? "?" }));
  const stageRows = [...groupRows(rows, r => r.race.stageId)]
    .map(([k, rs]) => summarize(k, rs, medians, formatOf))
    .sort((a, b) => (ref_.stageById.get(a.key)?.sortOrder ?? 0) - (ref_.stageById.get(b.key)?.sortOrder ?? 0))
    .map(s => ({ id: s.key, label: ref_.stageById.get(s.key)?.name ?? "?", summary: s }));
  const byAmiibo = table(
    r => (r.entry.racer.kind === "amiibo" ? r.entry.racer.profileId : "?"),
    k => ({ label: ref_.profileById.get(k)?.nickname ?? "?", sub: ref_.profileById.get(k)?.personality }),
  );
  const byVersion = [...groupRows(rows, r => (r.entry.racer.kind === "amiibo" ? r.entry.racer.snapshotId : "?"))]
    .map(([k, rs]) => summarize(k, rs, medians, formatOf))
    .sort((a, b) => (ref_.snapshotById.get(b.key)?.version ?? 0) - (ref_.snapshotById.get(a.key)?.version ?? 0))
    .map(s => {
      const snap = ref_.snapshotById.get(s.key);
      return { id: s.key, label: snap ? snapshotLabel(snap) : "?", sub: snap?.trainingSinceLast, summary: s };
    });
  const hasPlaces = overall.placed > 0;
  const showRetired = allowsRetirement(format);
  // Solo time formats have no places: show pace instead of empty win columns.
  const overallCols = retiredColumnIf(hasPlaces ? OVERALL_COLUMNS : ["races", "pace", "dnf"], showRetired);

  return (
    <div className="space-y-6">
      {(!isProfile || hasPlaces) && <div className={cx("grid grid-cols-2 gap-3", showRetired ? "md:grid-cols-6" : "md:grid-cols-5")}>
        <StatTile label="Races" value={overall.races} />
        <StatTile label="Wins" value={overall.wins} />
        <StatTile label="Win rate" value={hasPlaces ? fmtPct(overall.winRate) : "—"} />
        <StatTile label="Avg place" value={hasPlaces ? fmtPlace(overall.avgPlace) : "—"} hint={overall.avgFieldSize ? `of ~${overall.avgFieldSize.toFixed(1)} riders` : undefined} />
        <StatTile label="Pace vs field" value={fmtPace(overall.pacePct)} hint="vs each stage's median" />
        {showRetired && <StatTile label="Retired" value={fmtRetired(overall)} />}
      </div>}
      <Card>
        <CardHeader title="By machine" subtitle={`Across all stages: ${hasPlaces ? "placements and " : ""}pace vs each course's median.`} />
        <StatsTable rows={byMachine} columns={overallCols} labelHead="Machine" />
      </Card>
      {!isProfile && <Card>
        <CardHeader title="By stage" subtitle="Times are comparable within a stage." />
        <StatsTable rows={stageRows} columns={hasPlaces ? STAGE_COLUMNS : ["races", "best", "median", "spread"]} labelHead="Stage" />
      </Card>}
      {!isProfile && byAmiibo.length > 0 && (
        <Card>
          <CardHeader title="By amiibo" subtitle="Each of your trained profiles of this character." />
          <StatsTable rows={byAmiibo} columns={overallCols} labelHead="Amiibo" />
        </Card>
      )}
      {isProfile && byVersion.length > 0 && (
        <Card>
          <CardHeader title="By version" subtitle="Compare it with its earlier self." />
          <StatsTable rows={byVersion} columns={overallCols} labelHead="Version" />
        </Card>
      )}
    </div>
  );
}

const CONFIDENCE: Record<"low" | "medium" | "high", { label: string; tone: "neutral" | "star" | "ok" }> = {
  low: { label: "Low confidence", tone: "neutral" },
  medium: { label: "Medium confidence", tone: "star" },
  high: { label: "High confidence", tone: "ok" },
};

/** A trained amiibo against the baseline amiibo of the same rider, matched stage by stage and machine by machine. */
function BaselineCard({ profile, allRows, ref_ }: { profile: FigurePlayerProfile; allRows: ResultRow[]; ref_: Reference }) {
  const rider = ref_.riderById.get(profile.riderId);
  const baselines = ref_.profiles.filter(p => p.isBaseline && p.riderId === profile.riderId && p.id !== profile.id);
  if (!baselines.length) {
    return (
      <Card>
        <CardHeader title="Vs baseline" />
        <p className="text-sm text-night-400">
          No baseline {rider?.name ?? ""} yet. Add a Balanced {rider?.name ?? ""} on the <Link to="amiibo" className="underline hover:text-night-100">Amiibo</Link> page
          with "Baseline amiibo" ticked, then race it on the same stages and machines to see what training gained.
        </p>
      </Card>
    );
  }
  const versions = ref_.snapshotsByProfile.get(profile.id) ?? [];
  const latest = versions[0];
  const baseIds = new Set(baselines.map(p => p.id));
  const mine = allRows.filter(r => r.entry.racer.kind === "amiibo" && r.entry.racer.profileId === profile.id
    && (versions.length < 2 || r.entry.racer.snapshotId === latest?.id));
  const base = allRows.filter(r => r.entry.racer.kind === "amiibo" && baseIds.has(r.entry.racer.profileId));
  const c = compareWithBaseline(mine, base);
  const pairs = [...c.pairs].sort((a, b) =>
    (ref_.stageById.get(a.stageId)?.sortOrder ?? 0) - (ref_.stageById.get(b.stageId)?.sortOrder ?? 0)
    || (ref_.machineById.get(a.machineId)?.sortOrder ?? 0) - (ref_.machineById.get(b.machineId)?.sortOrder ?? 0));
  const names = baselines.map(p => p.nickname).join(", ");
  const subtitle = `Against ${names}, only where both raced the same stage on the same machine in this format.`
    + (versions.length > 1 && latest ? ` ${profile.nickname}'s latest version (v${latest.version}) only.` : "");

  if (c.deltaMs === null) {
    return (
      <Card>
        <CardHeader title="Vs baseline" subtitle={subtitle} />
        <p className="text-sm text-night-400">
          No matches yet. {base.length ? `${names} hasn't raced the same stage and machine as ${profile.nickname} in this format.` : `${names} has no counted races in this format.`}
        </p>
      </Card>
    );
  }
  const faster = c.deltaMs < 0;
  const conf = CONFIDENCE[c.confidence as "low" | "medium" | "high"];
  return (
    <Card>
      <CardHeader title="Vs baseline" subtitle={subtitle} action={<Badge tone={conf.tone}>{conf.label}</Badge>} />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={cx("font-mono text-3xl font-bold", faster ? "text-ok-400" : "text-bad-400")} data-testid="baseline-gap">{formatGap(c.deltaMs)}</span>
        <span className="text-night-300">
          per course ({(Math.abs(c.deltaPct ?? 0) * 100).toFixed(1)}% {faster ? "faster" : "slower"} than baseline)
          {c.marginMs !== null && <> · likely between {formatGap(c.deltaMs - c.marginMs)} and {formatGap(c.deltaMs + c.marginMs)}</>}
        </span>
      </div>
      <p className="mt-1 text-xs text-night-400">
        From {c.matchedMine} of {profile.nickname}'s races and {c.matchedBase} baseline races.
        {c.unmatchedMine > 0 && ` ${c.unmatchedMine} of ${profile.nickname}'s races had no baseline on that stage + machine and aren't compared.`}
        {c.confidence === "low" && " Aim for at least 5 races on each side of a match."}
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-night-400">
            <tr><th className="py-2 pr-4">Stage</th><th className="py-2 pr-4">Machine</th><th className="py-2 pr-4 text-right">{profile.nickname}</th><th className="py-2 pr-4 text-right">Baseline</th><th className="py-2 text-right">Gap</th></tr>
          </thead>
          <tbody className="divide-y divide-night-800">
            {pairs.map(p => (
              <tr key={`${p.stageId}|${p.machineId}`}>
                <td className="py-2 pr-4">{ref_.stageById.get(p.stageId)?.name ?? "?"}</td>
                <td className="py-2 pr-4 text-night-300">{ref_.machineById.get(p.machineId)?.name ?? "?"}</td>
                <td className="py-2 pr-4 text-right font-mono">{formatGameTime(p.mine.medianMs)} <span className="text-xs text-night-400">({p.mine.races})</span></td>
                <td className="py-2 pr-4 text-right font-mono">{formatGameTime(p.base.medianMs)} <span className="text-xs text-night-400">({p.base.races})</span></td>
                <td className={cx("py-2 text-right font-mono", p.deltaMs < 0 ? "text-ok-400" : "text-bad-400")}>{formatGap(p.deltaMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-night-400">Median times; race counts in brackets.</p>
      </div>
    </Card>
  );
}

export function StatsPage() {
  const { mode } = useMode();
  const { params } = useLocation();
  const profileId = params.get("profile");
  const { data: ref_, error, loading } = useReference(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const [formatChoice, setFormatChoice] = useState<ID>("");

  if (error || core.error) return <Notice tone="bad" title="Couldn't load stats">{(error ?? core.error)?.message}</Notice>;
  if (loading || core.loading || !ref_ || !core.data) return <Spinner />;

  const profile = profileId ? ref_.profileById.get(profileId) : undefined;
  const riderId = profile?.riderId ?? params.get("rider") ?? "";
  const rider = ref_.riderById.get(riderId);
  if (!rider || (profileId && !profile)) {
    return <Notice tone="bad" title="Not found">That character or amiibo doesn't exist. <Link to="roster" className="underline">Back to the roster</Link></Notice>;
  }

  // A character page leaves out baseline amiibo, as Rankings do; each has its own page.
  const baselineIds = new Set(ref_.profiles.filter(p => p.isBaseline).map(p => p.id));
  const matches = (r: ResultRow) => (profile
    ? r.entry.racer.kind === "amiibo" && r.entry.racer.profileId === profile.id
    : r.entry.riderId === rider.id && !(r.entry.racer.kind === "amiibo" && baselineIds.has(r.entry.racer.profileId)));
  const formats = ref_.formats.filter(f => !f.isArchived || (core.data!.get(f.id) ?? []).some(matches));
  const countFor = (f: Format) => (core.data!.get(f.id) ?? []).filter(matches).length;
  // Default: the format with the most results for this subject, else the default rules.
  const auto = [...formats].sort((a, b) => countFor(b) - countFor(a))[0];
  const format = ref_.formatById.get(formatChoice) ?? (auto && countFor(auto) > 0 ? auto : formats.find(f => f.isDefaultRules) ?? auto);
  const allRows = format ? core.data.get(format.id) ?? [] : [];
  const rows = allRows.filter(matches);
  const amiibo = ref_.profiles.filter(p => p.riderId === rider.id);

  return (
    <div className="space-y-6">
      <div>
        <Link to="roster" className="text-sm text-night-400 hover:text-night-100">← Roster</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{profile ? profile.nickname : rider.name}{profile?.isBaseline && <span className="ml-3 align-middle"><Badge tone="star">Baseline</Badge></span>}</h1>
            <p className="mt-1 text-night-300">
              {profile
                ? <>{rider.name}{profile.personality ? ` · ${profile.personality}` : ""} · <Link to="stats" params={{ rider: rider.id }} className="underline hover:text-night-100">all {rider.name} stats</Link></>
                : `${modeLabel(mode)} core records for every ${rider.name} amiibo.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {format && rows.length > 0 && <CopySummaryButton build={() => buildSummary({
              kind: profile ? "profile" : "rider",
              title: profile ? `${profile.nickname} (${rider.name})` : rider.name,
              subtitle: profile?.personality ? `Personality: ${profile.personality}` : undefined,
              format, rows, allRows, notes: profile ? profile.notes : rider.notes,
              names: {
                stage: id => ref_.stageById.get(id)?.name ?? "?", rider: id => ref_.riderById.get(id)?.name ?? "?",
                machine: id => ref_.machineById.get(id)?.name ?? "?", amiibo: id => ref_.profileById.get(id)?.nickname ?? "?",
                stageOrder: id => ref_.stageById.get(id)?.sortOrder ?? 0,
              },
            })} />}
            {profile && profile.status === "active" && <Button variant="primary" onClick={() => navigate("log", { amiibo: profile.id })}>New data entry</Button>}
          </div>
        </div>
      </div>

      {!profile && amiibo.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {amiibo.map(p => (
            <Link key={p.id} to="stats" params={{ profile: p.id }} className="rounded-full border border-night-600 px-3 py-1 text-sm hover:border-air-400 hover:text-air-400">
              {p.nickname}{p.isBaseline ? " · baseline" : ""}{p.status === "retired" ? " (retired)" : ""}
            </Link>
          ))}
        </div>
      )}

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="sp-format" className="text-sm font-semibold text-night-300">Format</label>
          <Select id="sp-format" className="w-auto min-w-64" value={format?.id ?? ""} onChange={e => setFormatChoice(e.target.value)}>
            {formats.map(f => <option key={f.id} value={f.id}>{f.name} ({countFor(f)})</option>)}
          </Select>
          <span className="text-xs text-night-400">Each format is its own dataset. Only races counted in core records are included.</span>
        </div>
      </Card>

      {!format ? (
        <Notice title={`No ${modeLabel(mode)} formats`} />
      ) : rows.length === 0 ? (
        <Notice title={`No counted ${format.name} races yet`}>
          {profile ? `Log races for ${profile.nickname}` : `Log races for a ${rider.name} amiibo`} in this format, or switch on "count in core records" for a trial.
          {format.isDefaultRules && <span className="ml-2"><Badge>Default rules</Badge></span>}
        </Notice>
      ) : (
        <div className="space-y-6">
          {!profile && baselineIds.size > 0 && ref_.profiles.some(p => p.isBaseline && p.riderId === rider.id) && (
            <p className="text-sm text-night-400">Baseline amiibo are left out of these totals; open one for its own stats.</p>
          )}
          {profile && <AmiiboBreakdown profileId={profile.id} format={format} rows={rows} allRows={allRows} ref_={ref_} />}
          {profile && !profile.isBaseline && <BaselineCard profile={profile} allRows={allRows} ref_={ref_} />}
          <SubjectStats format={format} allRows={allRows} rows={rows} ref_={ref_} isProfile={!!profile} />
        </div>
      )}
      {!profile && <NotesCard store="riders" id={rider.id} notes={rider.notes} what={rider.name} />}
    </div>
  );
}
