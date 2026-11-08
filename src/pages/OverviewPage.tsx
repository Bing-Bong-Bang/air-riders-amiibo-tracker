// Overview: the front page. What this is, who's fastest, records, what the
// data says so far, recent sessions, how complete the data is, and the rules.
// Built for someone seeing the tracker for the first time.

import { useMemo } from "react";
import type { ReactNode } from "react";
import { getAll, getAllByIndex } from "../db/database";
import { buildObservations, loadCoreRows, scopeFilter } from "../domain/coreData";
import { compareWithBaseline } from "../domain/baseline";
import { buildLeaderboard, cpuSetupText, formatGameTime, settingRows } from "../domain/schema";
import type { Format, ID, LeaderboardRow, Machine, Race, Rider, Session, Stage } from "../domain/schema";
import { stageOverview, subjectDetails, typicalCourseMs } from "../domain/rankDetails";
import type { ResultRow } from "../domain/insights";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate } from "../lib/router";
import { Badge, Button, Card, Notice, Spinner, StarMark, cx } from "../components/ui";
import { PaceBar } from "./LeaderboardsPage";

const OBJECTIVE_LABEL: Record<Format["objective"], string> = {
  mean_time: "Lowest average time",
  pb_chance: "Best chance at a PB",
  placement: "Best expected placement",
};
const secs = (ms: number) => `${(Math.round(Math.abs(ms) / 10) / 100).toFixed(2)}s`;
const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}%`;
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const finished = (r: ResultRow) => r.entry.status === "finished" && r.entry.finishTimeMs !== null;

// -------------------------------------------------------------
// Rules (collapsed at the bottom)
// -------------------------------------------------------------

function RulesCard({ format, riders, machines, stages, others }: { format: Format; riders: Rider[]; machines: Machine[]; stages: Stage[]; others: Format[] }) {
  const rows = settingRows(format);
  const cpu = format.fillerCpu;
  const run = format.runStructure;
  return (
    <details className="group rounded-2xl border border-night-700 bg-night-900/60 px-5 py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-display text-lg font-bold">
          <span aria-hidden className="text-xs text-night-400 transition-transform group-open:rotate-90">▶</span>
          World-record rules
        </span>
        <span className="text-sm text-night-400">{format.name}</span>
      </summary>
      <div className="mt-4 space-y-4">
        <p className="text-sm text-night-300">The solo category this tracker is built around: one amiibo racing every course, times added up. <Badge tone="star">{OBJECTIVE_LABEL[format.objective]}</Badge></p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          {rows.map(([k, v]) => (
            <div key={k}><dt className="text-night-400">{k}</dt><dd className={cx("font-medium", v === "Any" ? "text-night-400" : "text-night-100")}>{v}</dd></div>
          ))}
        </dl>
        {cpu && <p className="text-sm text-night-300"><span className="font-medium text-night-100">Required CPU:</span> {cpuSetupText(cpu, riders.find(r => r.id === cpu.riderId), machines.find(m => m.id === cpu.machineId))}. Not logged.</p>}
        <div className="flex flex-wrap gap-2">
          <Badge>{format.timing === "igt" ? "In-game time" : "Real time"}</Badge>
          {run.kind === "course_set" && <>
            <Badge>{run.stageIds.length} of {stages.length} courses per run</Badge>
            {run.anyOrder && <Badge>Any order</Badge>}
            {run.eachStageOnce && <Badge>Each course once</Badge>}
            {run.sameRacerThroughout && <Badge>Same amiibo all run</Badge>}
            {run.machineMayChange && <Badge tone="ok">Machine may change</Badge>}
          </>}
          {format.forbidsGlitches && <Badge tone="bad">Glitch = forfeit</Badge>}
          {format.requiresVideo && <Badge>Video required</Badge>}
        </div>
        {format.description && (
          <details className="text-sm">
            <summary className="cursor-pointer text-night-300 hover:text-night-100">Full category rules</summary>
            <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-night-850 p-4 font-sans text-night-300">{format.description}</pre>
          </details>
        )}
        {others.length > 0 && (
          <p className="text-sm text-night-400">Other formats: {others.map(f => f.name).join(", ")}. Each keeps its own records. <Link to="formats" className="underline hover:text-night-100">See formats</Link></p>
        )}
      </div>
    </details>
  );
}

// -------------------------------------------------------------
// Pieces
// -------------------------------------------------------------

function Section({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-xl font-bold">{title}</h2>
          {subtitle && <p className="text-sm text-night-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Locked({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-night-700 px-4 py-3 text-sm text-night-400">{children}</p>;
}

function LeaderCard({ title, caption, rows, label, view, typical, extent }: {
  title: string; caption: string; rows: LeaderboardRow[]; label: (key: string) => { name: string; sub?: string }; view: string; typical: number | null; extent: number;
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-night-400">{title}</h3>
        <Link to="leaderboards" params={{ view }} className="text-xs font-semibold text-air-400 hover:underline">All →</Link>
      </div>
      <p className="mt-0.5 text-xs text-night-400">{caption}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-night-400">Race more to unlock.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.slice(0, 3).map((r, i) => {
            const { name, sub } = label(r.key);
            return (
              <li key={r.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cx("min-w-0 truncate", i === 0 ? "font-display text-lg font-bold" : "font-medium")}>
                    <span className="mr-1.5 text-night-400">{i + 1}.</span>{name}
                  </span>
                  <span className={cx("shrink-0 tabular", r.pacePct < 0 ? "text-ok-400" : r.pacePct > 0 ? "text-bad-400" : "text-night-300")}>
                    {signedPct(r.pacePct)}
                  </span>
                </div>
                {sub && <div className="text-xs text-night-400">{sub}</div>}
                <div className="mt-1 flex items-center gap-2">
                  <div className="flex-1"><PaceBar row={r} extent={extent} /></div>
                  {typical !== null && <span className="shrink-0 whitespace-nowrap text-right text-xs text-night-400 tabular">{r.pacePct < 0 ? "−" : "+"}{secs(typical * r.pacePct / 100)}/course</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Progress({ label, done, total, missing }: { label: string; done: number; total: number; missing?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular text-night-300">{done} / {total}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-night-800" role="img" aria-label={`${label}: ${done} of ${total}`}>
        <div className="h-full rounded-full bg-air-400" style={{ width: `${pct}%` }} />
      </div>
      {missing && <p className="mt-1 text-xs text-night-400">{missing}</p>}
    </div>
  );
}

// -------------------------------------------------------------
// Page
// -------------------------------------------------------------

export function OverviewPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const extra = useLiveQuery(async () => {
    const [races, sessions, runs] = await Promise.all([getAllByIndex("races", "mode", mode), getAll("sessions"), getAll("runs")]);
    return { races, sessions, runs };
  }, [mode], ["races", "sessions", "runs"]);

  const view = useMemo(() => {
    if (!ref_ || !core.data || !extra.data) return null;
    const recordId = ref_.settings?.recordFormatIds[mode];
    const formats = ref_.formats.filter(f => f.mode === mode);
    const timed = (f: Format) => (core.data!.get(f.id) ?? []).filter(finished).length;
    const record = formats.find(f => f.id === recordId);
    // Lead with the world-record format once it has times, else whichever has the most.
    const format = (record && timed(record) > 0 ? record : [...formats].sort((a, b) => timed(b) - timed(a))[0]) ?? record;
    const baselineIds = new Set(ref_.profiles.filter(p => p.isBaseline).map(p => p.id));
    const rows = format ? (core.data.get(format.id) ?? []).filter(r => !(r.entry.racer.kind === "amiibo" && baselineIds.has(r.entry.racer.profileId))) : [];
    const minSample = ref_.settings?.minSample ?? 5;
    const filter = { includeLegendaries: true, latestVersionOnly: false, ...scopeFilter("trained", ref_.profiles) };
    const allRows = format ? core.data.get(format.id) ?? [] : [];
    const byRider = buildObservations(allRows, { ...filter, riderKey: "rider" }, ref_).obs;
    const byGroup = buildObservations(allRows, { ...filter, riderKey: "characterGroup" }, ref_).obs;
    const byProfile = buildObservations(allRows, { ...filter, riderKey: "profile" }, ref_).obs;
    const leaders = {
      characters: buildLeaderboard(byGroup, "characterGroup", minSample, 120),
      machines: buildLeaderboard(byRider, "machine", minSample, 120),
      combos: buildLeaderboard(byRider, "combo", minSample, 120),
      amiibo: buildLeaderboard(byProfile, "rider", minSample, 120),
    };
    const typical = typicalCourseMs(byRider);

    // Records: best counted time per course (trained amiibo).
    const bestByStage = new Map<ID, ResultRow>();
    for (const r of rows.filter(finished)) {
      const b = bestByStage.get(r.race.stageId);
      if (!b || Number(r.entry.finishTimeMs) < Number(b.entry.finishTimeMs)) bestByStage.set(r.race.stageId, r);
    }
    const records = [...bestByStage.entries()]
      .map(([stageId, r]) => ({ stageId, r }))
      .sort((a, b) => (ref_.stageById.get(a.stageId)?.sortOrder ?? 0) - (ref_.stageById.get(b.stageId)?.sortOrder ?? 0));
    const newest = [...records].sort((a, b) => b.r.race.racedAt.localeCompare(a.r.race.racedAt))[0];
    const runIds = format?.runStructure.kind === "course_set" ? format.runStructure.stageIds : null;
    const sumOfBest = runIds && runIds.every(id => bestByStage.has(id)) ? runIds.reduce((a, id) => a + (bestByStage.get(id)!.entry.finishTimeMs as number), 0) : null;
    const runTotals = new Map<ID, number>();
    for (const r of extra.data.races) if (r.runId) runTotals.set(r.runId, (runTotals.get(r.runId) ?? 0) + r.entries.reduce((a, e) => a + (e.finishTimeMs ?? 0), 0));
    const pb = extra.data.runs.filter(run => run.formatId === format?.id && run.status === "complete" && runTotals.has(run.id))
      .reduce<number | null>((m, run) => (m === null || runTotals.get(run.id)! < m ? runTotals.get(run.id)! : m), null);

    // Findings, in plain English, strongest first.
    const findings: { text: ReactNode; key: string }[] = [];
    const name = (k: string, kind: "group" | "machine" | "profile" | "combo") => {
      if (kind === "machine") return ref_.machineById.get(k)?.name ?? "?";
      if (kind === "profile") return ref_.profileById.get(k)?.nickname ?? "?";
      if (kind === "combo") { const [r, m] = k.split("|"); return `${ref_.riderById.get(r)?.name ?? "?"} + ${ref_.machineById.get(m)?.name ?? "?"}`; }
      return k;
    };
    const b = (t: ReactNode) => <strong className="text-night-100">{t}</strong>;
    const lead = (list: LeaderboardRow[], kind: "group" | "machine", what: string) => {
      if (list.length < 2 || typical === null) return;
      const gap = typical * (list[1].pacePct - list[0].pacePct) / 100;
      const sure = list[0].confidence === "high" && list[0].rankHigh === 1;
      findings.push({
        key: `lead-${kind}`,
        text: <>{b(name(list[0].key, kind))} is the fastest {what} so far, about {b(secs(gap))} per course ahead of {name(list[1].key, kind)}{sure ? "." : ". Early days: that order could still change."}</>,
      });
    };
    lead(leaders.characters, "group", "character");
    lead(leaders.machines, "machine", "machine");

    // Same amiibo, two machines, one course: single-race odds.
    const cells = new Map<string, number[]>();
    for (const o of byProfile) cells.set(`${o.stageId}|${o.rider}|${o.machine}`, [...(cells.get(`${o.stageId}|${o.rider}|${o.machine}`) ?? []), o.timeMs]);
    let bestDuel: { text: ReactNode; strength: number } | null = null;
    const keys = [...cells.keys()];
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const [s1, p1, m1] = keys[i].split("|"), [s2, p2, m2] = keys[j].split("|");
      if (s1 !== s2 || p1 !== p2 || m1 === m2) continue;
      const A = cells.get(keys[i])!, B = cells.get(keys[j])!;
      if (A.length < 3 || B.length < 3) continue;
      let w = 0;
      for (const x of A) for (const y of B) w += x < y ? 1 : x === y ? 0.5 : 0;
      const p = w / (A.length * B.length);
      const [win, lose, pct] = p >= 0.5 ? [m1, m2, p] : [m2, m1, 1 - p];
      const strength = Math.abs(pct - 0.5) * Math.min(A.length, B.length);
      if (pct >= 0.6 && (!bestDuel || strength > bestDuel.strength)) {
        bestDuel = { strength, text: <>On {ref_.stageById.get(s1)?.name}, {name(p1, "profile")} on {b(name(win, "machine"))} beats {name(p1, "profile")} on {name(lose, "machine")} {pct >= 0.99 ? <>{b("every time")} so far ({A.length + B.length} races)</> : <>in about {b(`${Math.round(pct * 100)}%`)} of races</>}.</> };
      }
    }
    if (bestDuel) findings.push({ key: "duel", text: bestDuel.text });

    // Training vs baseline.
    const baselines = ref_.profiles.filter(p => p.isBaseline);
    let bestGain: { text: ReactNode; size: number } | null = null;
    for (const p of ref_.profiles.filter(x => !x.isBaseline)) {
      const base = baselines.filter(x => x.riderId === p.riderId);
      if (!base.length) continue;
      const ids = new Set(base.map(x => x.id));
      const mine = allRows.filter(r => r.entry.racer.kind === "amiibo" && r.entry.racer.profileId === p.id);
      const theirs = allRows.filter(r => r.entry.racer.kind === "amiibo" && ids.has(r.entry.racer.profileId));
      const c = compareWithBaseline(mine, theirs);
      if (c.deltaMs === null || c.confidence === "none") continue;
      if (!bestGain || Math.abs(c.deltaMs) > bestGain.size) {
        bestGain = {
          size: Math.abs(c.deltaMs),
          text: <>Training made {b(p.nickname)} about {b(secs(c.deltaMs))} {c.deltaMs < 0 ? "faster" : "slower"} per course than a Balanced {ref_.riderById.get(p.riderId)?.name}{c.confidence === "low" ? " (only a few races so far)" : ""}.</>,
        };
      }
    }
    if (bestGain) findings.push({ key: "gain", text: bestGain.text });

    // Course character and consistency.
    const stageIds = (format?.runStructure.kind === "course_set" ? format.runStructure.stageIds : ref_.stages.filter(s => s.mode === mode).map(s => s.id));
    const overview = stageOverview(byProfile, stageIds, format?.disasterThresholdPct ?? 5).filter(o => o.races > 0);
    const noisy = overview.filter(o => o.noisePct !== null).sort((x, y) => (y.noisePct ?? 0) - (x.noisePct ?? 0));
    if (noisy.length > 1) findings.push({ key: "noise", text: <>{b(ref_.stageById.get(noisy[0].stageId)?.name)} is the most unpredictable course: times swing about ±{noisy[0].noisePct!.toFixed(1)}% race to race.</> });
    else if (noisy.length === 1) findings.push({ key: "noise", text: <>On {b(ref_.stageById.get(noisy[0].stageId)?.name)}, the same amiibo and machine swing about ±{noisy[0].noisePct!.toFixed(1)}% race to race, so small differences need lots of races to prove.</> });
    const det = subjectDetails(byProfile, o => o.rider, format?.disasterThresholdPct ?? 5);
    const steady = [...det].filter(([, d]) => d.spreadPct !== null && d.repeatRaces >= 6).sort((x, y) => x[1].spreadPct! - y[1].spreadPct!);
    if (steady.length > 1) findings.push({ key: "steady", text: <>{b(name(steady[0][0], "profile"))} is your most consistent amiibo (±{steady[0][1].spreadPct!.toFixed(1)}% vs ±{steady[steady.length - 1][1].spreadPct!.toFixed(1)}% for {name(steady[steady.length - 1][0], "profile")}).</> });

    // Recent sessions with a one-line result.
    const modeOf = (s: Session) => s.mode ?? ref_.formatById.get(s.formatId)?.mode;
    const sessionRaces = new Map<ID, Race[]>();
    for (const r of extra.data.races) if (r.sessionId) sessionRaces.set(r.sessionId, [...(sessionRaces.get(r.sessionId) ?? []), r]);
    const recent = extra.data.sessions.filter(s => modeOf(s) === mode && sessionRaces.has(s.id))
      .map(s => {
        const list = sessionRaces.get(s.id)!;
        const last = list.reduce((m, r) => (r.racedAt > m ? r.racedAt : m), "");
        const groups = new Map<string, number[]>();
        for (const r of list) for (const e of r.entries) {
          if (e.finishTimeMs === null || e.racer.kind !== "amiibo") continue;
          const k = `${r.stageId}|${e.racer.profileId}|${e.machineId}`;
          groups.set(k, [...(groups.get(k) ?? []), e.finishTimeMs]);
        }
        const top = [...groups].map(([k, t]) => ({ k, med: median(t), n: t.length })).sort((a, b2) => b2.n - a.n || a.med - b2.med)[0];
        const [st, pid, mid] = top ? top.k.split("|") : [];
        return { s, count: list.length, last, line: top ? `${name(pid, "profile")} · ${name(mid, "machine")} on ${ref_.stageById.get(st)?.name}: median ${formatGameTime(top.med)} over ${top.n}` : null };
      })
      .sort((a, b2) => b2.last.localeCompare(a.last)).slice(0, 3);

    // Coverage across the mode (all counted results).
    const modeRows = [...core.data.values()].flat().filter(finished);
    const coursesRaced = new Set(modeRows.map(r => r.race.stageId));
    const ridersRaced = new Set(modeRows.map(r => r.entry.riderId));
    const machinesRaced = new Set(modeRows.map(r => r.entry.machineId));
    const allStages = ref_.stages.filter(s => s.mode === mode && !s.isArchived);
    const nextCourse = allStages.find(s => !coursesRaced.has(s.id));
    const nextMachine = ref_.machines.find(m => !machinesRaced.has(m.id) && !m.isLegendary) ?? ref_.machines.find(m => !machinesRaced.has(m.id));
    const lastRaced = extra.data.races.reduce((m, r) => (r.racedAt > m ? r.racedAt : m), "");

    return {
      format, record, formats, leaders, typical, records, newest, sumOfBest, pb, findings: findings.slice(0, 5), recent,
      coverage: { courses: coursesRaced.size, coursesTotal: allStages.length, riders: ridersRaced.size, machines: machinesRaced.size, nextCourse, nextMachine },
      lastRaced, raceCount: extra.data.races.length,
    };
  }, [ref_, core.data, extra.data, mode]);

  if (error || core.error || extra.error) return <Notice tone="bad" title="Couldn't load the overview">{(error ?? core.error ?? extra.error)?.message}</Notice>;
  if (loading || core.loading || extra.loading || !ref_ || !view) return <Spinner />;

  const accent = mode === "air_ride" ? "text-air-400" : "text-top-400";
  const trained = ref_.profiles.filter(p => p.status === "active" && !p.isBaseline);
  const extent = Math.max(1, ...Object.values(view.leaders).flatMap(l => l.slice(0, 3).map(r => Math.abs(r.pacePct)))) * 1.05;
  const nick = (id: string) => ref_.profileById.get(id)?.nickname ?? "?";
  const groupLabel = (k: string) => ({ name: k });
  const machineLabel = (k: string) => ({ name: ref_.machineById.get(k)?.name ?? "?" });
  const comboLabel = (k: string) => { const [r, m] = k.split("|"); return { name: `${ref_.riderById.get(r)?.name ?? "?"}`, sub: `on ${ref_.machineById.get(m)?.name ?? "?"}` }; };
  const amiiboLabel = (k: string) => ({ name: nick(k), sub: ref_.riderById.get(ref_.profileById.get(k)?.riderId ?? "")?.name });
  const totalTimed = Object.values(view.leaders)[0].length;

  return (
    <div className="space-y-10">
      {/* ---- intro ---- */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <p className={cx("text-sm font-semibold uppercase tracking-wider", accent)}>{modeLabel(mode)}</p>
          <h1 className="mt-1 flex items-center gap-3 text-4xl font-bold"><StarMark className="h-8 w-8 text-star-400" />Kirby Air Riders amiibo lab</h1>
          <p className="mt-2 text-lg text-night-300">
            Racing amiibo over and over to find out which characters, machines and trained amiibo are really the fastest, course by course.
          </p>
          <p className="mt-2 text-sm text-night-400">
            {view.raceCount} race{view.raceCount === 1 ? "" : "s"} · {trained.length} amiibo · {view.coverage.courses} of {view.coverage.coursesTotal} courses
            {ref_.settings?.gameVersion && <> · game Ver. {ref_.settings.gameVersion}</>}
            {view.lastRaced && <> · last raced {shortDate(view.lastRaced)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {trained.length === 0 && <Button onClick={() => navigate("amiibo")}>Add an amiibo</Button>}
          <Button onClick={() => navigate("sessions")}>Start a session</Button>
          <Button variant="primary" onClick={() => navigate("log")}>Log a race</Button>
        </div>
      </header>

      {/* ---- leaders ---- */}
      <Section title="Current leaders" subtitle={view.format ? `Pace vs average with the course and partner held equal · ${view.format.name}` : undefined}>
        {totalTimed === 0 && view.leaders.machines.length === 0 ? (
          <Locked>Log a few timed races and the fastest characters, machines and amiibo show up here.</Locked>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <LeaderCard title="Fastest character" caption="If every character rode the same machine" rows={view.leaders.characters} label={groupLabel} view="characterGroup" typical={view.typical} extent={extent} />
            <LeaderCard title="Fastest machine" caption="If every machine had the same rider" rows={view.leaders.machines} label={machineLabel} view="machine" typical={view.typical} extent={extent} />
            <LeaderCard title="Best combo" caption="Character + machine pairs you've actually raced" rows={view.leaders.combos} label={comboLabel} view="combo" typical={view.typical} extent={extent} />
            <LeaderCard title="Top amiibo" caption="Your trained amiibo, if all rode the same machine" rows={view.leaders.amiibo} label={amiiboLabel} view="profile" typical={view.typical} extent={extent} />
          </div>
        )}
      </Section>

      {/* ---- records ---- */}
      <Section title="Records" subtitle="Best counted time on each course" action={view.format && <Link to="leaderboards" params={{ view: "stages" }} className="text-sm font-semibold text-air-400 hover:underline">All courses →</Link>}>
        {view.records.length === 0 ? (
          <Locked>No course records yet. Your first timed race sets one.</Locked>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2" aria-label="Course records">
                {view.records.slice(0, 8).map(({ stageId, r }) => {
                  const isNew = view.newest?.stageId === stageId;
                  return (
                    <li key={stageId} className={cx("flex items-baseline justify-between gap-3 rounded-lg px-2 py-1.5", isNew && "bg-star-400/10 ring-1 ring-star-400/40")}>
                      <span className="min-w-0">
                        <Link to="stage" params={{ id: stageId, format: view.format!.id }} className="font-medium hover:text-air-400">{ref_.stageById.get(stageId)?.name}</Link>
                        <span className="block text-xs text-night-400">{r.entry.racer.kind === "amiibo" ? nick(r.entry.racer.profileId) : "?"} · {ref_.machineById.get(r.entry.machineId)?.name} · {shortDate(r.race.racedAt)}{isNew && <span className="ml-1 font-semibold text-star-400">newest!</span>}</span>
                      </span>
                      <span className="font-mono text-lg font-semibold text-star-400 tabular">{formatGameTime(r.entry.finishTimeMs)}</span>
                    </li>
                  );
                })}
              </ul>
              {view.records.length > 8 && <p className="mt-2 text-xs text-night-400">…and {view.records.length - 8} more on the Stages view.</p>}
            </Card>
            <Card className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-night-400">Sum of Best</div>
                <div className="font-mono text-2xl font-semibold tabular">{view.sumOfBest !== null ? formatGameTime(view.sumOfBest) : "—"}</div>
                <div className="text-xs text-night-400">{view.sumOfBest !== null ? "every course at its best, added up" : `fills in once all ${view.format?.runStructure.kind === "course_set" ? view.format.runStructure.stageIds.length : ""} courses have a time`}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-night-400">Personal best run</div>
                <div className="font-mono text-2xl font-semibold tabular">{view.pb !== null ? formatGameTime(view.pb) : "—"}</div>
                <div className="text-xs text-night-400">{view.pb !== null ? "fastest complete run" : <>no complete run yet · <Link to="runs" className="underline">Runs</Link></>}</div>
              </div>
            </Card>
          </div>
        )}
      </Section>

      {/* ---- findings ---- */}
      <Section title="What we've learned" subtitle="Pulled from the data so far; it sharpens as more races come in.">
        {view.findings.length === 0 ? (
          <Locked>Findings appear once there are a few races to compare, e.g. one amiibo on two machines on the same course.</Locked>
        ) : (
          <Card>
            <ul className="space-y-3" aria-label="Findings">
              {view.findings.map(f => (
                <li key={f.key} className="flex gap-3 text-night-300">
                  <span aria-hidden className="mt-0.5 text-star-400">★</span><span>{f.text}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        {/* ---- recent sessions ---- */}
        <Section title="Recent sessions" action={<Link to="sessions" className="text-sm font-semibold text-air-400 hover:underline">All →</Link>}>
          {view.recent.length === 0 ? (
            <Locked>No sessions yet. A session groups a batch of races so you can see how that batch went.</Locked>
          ) : (
            <div className="space-y-3">
              {view.recent.map(({ s, count, last, line }) => (
                <Card key={s.id} className="p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <Link to="session" params={{ id: s.id }} className="font-semibold hover:text-air-400">{s.name}</Link>
                    <span className="text-xs text-night-400">{count} race{count === 1 ? "" : "s"} · {shortDate(last)}</span>
                  </div>
                  {line && <p className="mt-1 text-sm text-night-300">{line}</p>}
                </Card>
              ))}
            </div>
          )}
        </Section>

        {/* ---- completeness ---- */}
        <Section title="How complete the data is" action={<Link to="leaderboards" params={{ view: "coverage" }} className="text-sm font-semibold text-air-400 hover:underline">Coverage map →</Link>}>
          <Card className="space-y-4">
            <Progress label="Courses raced" done={view.coverage.courses} total={view.coverage.coursesTotal} />
            <Progress label="Characters raced" done={view.coverage.riders} total={ref_.riders.length} />
            <Progress label="Machines raced" done={view.coverage.machines} total={ref_.machines.length} />
            {(view.coverage.nextCourse || view.coverage.nextMachine) && (
              <p className="text-sm text-night-300">
                <span className="font-semibold text-night-100">Race next: </span>
                {[view.coverage.nextCourse && `${view.coverage.nextCourse.name} (never raced)`, view.coverage.nextMachine && `${view.coverage.nextMachine.name} (never tried)`].filter(Boolean).join(" · ")}
                {" "}· <Link to="recommendations" className="underline hover:text-night-100">more in Best picks</Link>
              </p>
            )}
          </Card>
        </Section>
      </div>

      {/* ---- rules ---- */}
      {view.record ? (
        <RulesCard format={view.record} riders={ref_.riders} machines={ref_.machines} stages={ref_.stages.filter(s => s.mode === mode)} others={view.formats.filter(f => f.id !== view.record!.id && !f.isArchived)} />
      ) : (
        <Notice title={`No ${modeLabel(mode)} record format yet`}>Mark a format as the world-record format on the Formats page.</Notice>
      )}
      <p className="text-center text-xs text-night-400">Everything here is {modeLabel(mode)} only; {mode === "air_ride" ? "Top Ride" : "Air Ride"} keeps its own data. Switch at the top right.</p>
    </div>
  );
}
