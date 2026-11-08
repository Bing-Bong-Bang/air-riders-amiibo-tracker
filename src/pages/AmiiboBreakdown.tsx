// One amiibo's breakdown within a format: headline tiles, course by course
// (with records and best machine), recent form, and gaps in its data.
// Shown at the top of an amiibo's stat page.

import { formatGameTime } from "../domain/schema";
import type { Format, ID, Millis } from "../domain/schema";
import type { ResultRow } from "../domain/insights";
import type { Reference } from "../hooks/useReference";
import { Link } from "../lib/router";
import { Card, CardHeader, StatTile, cx } from "../components/ui";
import { useState } from "react";

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const sd = (xs: number[]) => {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const secs = (ms: number) => `${(Math.round(Math.abs(ms) / 10) / 100).toFixed(2)}s`;
const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}%`;
const finished = (r: ResultRow) => r.entry.status === "finished" && r.entry.finishTimeMs !== null;

interface CourseRow {
  stageId: ID;
  races: number;
  bestMs: Millis | null;
  bestMachine: ID | null;
  medianMs: Millis | null;
  spreadMs: number | null;
  /** Fastest median machine here (2+ races), if more than one machine was tried. */
  topMachine: { machineId: ID; medianMs: Millis } | null;
  recordMs: Millis | null;      // course record in this format, anyone
  isRecord: boolean;
  disasters: number;
}

/**
 * `rows`: this amiibo's counted rows in `format`; `allRows`: everyone's
 * counted rows in `format` (for records and the field).
 */
export function AmiiboBreakdown({ profileId, format, rows, allRows, ref_ }: {
  profileId: ID; format: Format; rows: ResultRow[]; allRows: ResultRow[]; ref_: Reference;
}) {
  const [sortBy, setSortBy] = useState<"course" | "gap">("course");
  const nick = ref_.profileById.get(profileId)?.nickname ?? "?";
  const runStages = format.runStructure.kind === "course_set" ? format.runStructure.stageIds : null;
  const stages = ref_.stages.filter(s => s.mode === format.mode && (runStages ? runStages.includes(s.id) : rows.some(r => r.race.stageId === s.id)));
  const threshold = format.disasterThresholdPct / 100;

  // Course records (anyone) and field medians, for comparison.
  const record = new Map<ID, Millis>();
  const field = new Map<ID, number[]>();
  for (const r of allRows) {
    if (!finished(r)) continue;
    const t = r.entry.finishTimeMs as Millis;
    if (!record.has(r.race.stageId) || t < record.get(r.race.stageId)!) record.set(r.race.stageId, t);
    field.set(r.race.stageId, [...(field.get(r.race.stageId) ?? []), t]);
  }

  const courses: CourseRow[] = stages.map(stage => {
    const here = rows.filter(r => r.race.stageId === stage.id && finished(r));
    const times = here.map(r => r.entry.finishTimeMs as Millis);
    const best = here.reduce<ResultRow | null>((b, r) => (!b || Number(r.entry.finishTimeMs) < Number(b.entry.finishTimeMs) ? r : b), null);
    const byMachine = new Map<ID, number[]>();
    for (const r of here) byMachine.set(r.entry.machineId, [...(byMachine.get(r.entry.machineId) ?? []), r.entry.finishTimeMs as Millis]);
    const machines = [...byMachine].filter(([, t]) => t.length >= 2).map(([machineId, t]) => ({ machineId, medianMs: median(t) })).sort((a, b) => a.medianMs - b.medianMs);
    // Disasters vs the usual time on the same machine.
    let disasters = 0;
    for (const [, t] of byMachine) if (t.length >= 2) { const m = median(t); disasters += t.filter(x => x > m * (1 + threshold)).length; }
    const rec = record.get(stage.id) ?? null;
    return {
      stageId: stage.id,
      races: here.length,
      bestMs: best ? (best.entry.finishTimeMs as Millis) : null,
      bestMachine: best?.entry.machineId ?? null,
      medianMs: times.length ? median(times) : null,
      spreadMs: sd(times),
      topMachine: byMachine.size > 1 && machines.length ? machines[0] : null,
      recordMs: rec,
      isRecord: !!best && rec !== null && Number(best.entry.finishTimeMs) <= rec,
      disasters,
    };
  });

  const raced = courses.filter(c => c.races > 0);
  const timedRows = rows.filter(finished).sort((a, b) => a.race.racedAt.localeCompare(b.race.racedAt));
  const records = raced.filter(c => c.isRecord).length;
  const sumOfBest = runStages && raced.length === runStages.length ? raced.reduce((a, c) => a + (c.bestMs as number), 0) : null;
  const disasterTotal = raced.reduce((a, c) => a + c.disasters, 0);

  // Pace vs the field: each race against that course's median (everyone).
  const paceOf = (r: ResultRow) => {
    const f = field.get(r.race.stageId);
    return f && f.length ? ((r.entry.finishTimeMs as Millis) / median(f) - 1) * 100 : null;
  };
  const paces = timedRows.map(paceOf).filter((v): v is number => v !== null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const recent = paces.slice(-10), before = paces.slice(0, -10);
  const recentAvg = avg(recent), beforeAvg = avg(before);

  // Consistency: spread on the same course and machine, as % of the time.
  let ss = 0, df = 0;
  const cells = new Map<string, number[]>();
  for (const r of timedRows) {
    const k = `${r.race.stageId}|${r.entry.machineId}`;
    cells.set(k, [...(cells.get(k) ?? []), r.entry.finishTimeMs as Millis]);
  }
  for (const [, t] of cells) {
    if (t.length < 2) continue;
    const m = median(t);
    const rel = t.map(x => x / m);
    const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
    ss += rel.reduce((a, x) => a + (x - mean) ** 2, 0);
    df += rel.length - 1;
  }
  const spreadPct = df >= 2 ? Math.sqrt(ss / df) * 100 : null;

  const machinesTried = new Set(rows.map(r => r.entry.machineId));
  const untriedCourses = courses.filter(c => c.races === 0);
  const untriedMachines = ref_.machines.filter(m => !machinesTried.has(m.id));
  const name = (id: ID) => ref_.stageById.get(id)?.name ?? "?";
  const machine = (id: ID | null) => (id ? ref_.machineById.get(id)?.name ?? "?" : "—");
  const gapToRecord = (c: CourseRow) => (c.medianMs !== null && c.recordMs !== null ? c.medianMs - c.recordMs : null);
  const shown = sortBy === "gap"
    ? [...courses].sort((a, b) => (gapToRecord(b) ?? -Infinity) - (gapToRecord(a) ?? -Infinity))
    : courses;

  const strongest = [...raced].filter(c => c.medianMs !== null && field.get(c.stageId)?.length)
    .map(c => ({ c, pct: (c.medianMs! / median(field.get(c.stageId)!) - 1) * 100 }))
    .sort((a, b) => a.pct - b.pct);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Races" value={timedRows.length} hint={`${raced.length} course${raced.length === 1 ? "" : "s"}, ${machinesTried.size} machine${machinesTried.size === 1 ? "" : "s"}`} />
        <StatTile label="Course records" value={<span className={records ? "text-star-400" : undefined}>{records}</span>} hint={`of ${raced.length} raced`} />
        <StatTile label="Pace vs field" value={avg(paces) === null ? "—" : signedPct(avg(paces)!)} hint="vs each course's median" />
        <StatTile label="Consistency" value={spreadPct === null ? "—" : `±${spreadPct.toFixed(1)}%`} hint="same course and machine" />
        <StatTile label="Disasters" value={disasterTotal} hint={`>${format.disasterThresholdPct}% slower than usual`} />
        {runStages
          ? <StatTile label="Sum of Best" value={sumOfBest !== null ? formatGameTime(sumOfBest) : `${raced.length}/${runStages.length}`} hint={sumOfBest !== null ? "its own best on every course" : "courses with a time"} />
          : <StatTile label="Best course" value={strongest[0] ? name(strongest[0].c.stageId) : "—"} hint={strongest[0] ? `${signedPct(strongest[0].pct)} vs the field` : undefined} />}
      </div>

      <Card>
        <CardHeader
          title="Course by course"
          subtitle={`${nick}'s best, typical time and best machine on each course, against the course record (anyone, this format).`}
          action={
            <div className="flex gap-1 text-xs" role="group" aria-label="Sort courses">
              {(["course", "gap"] as const).map(k => (
                <button key={k} type="button" onClick={() => setSortBy(k)} aria-pressed={sortBy === k}
                  className={cx("rounded-lg px-2.5 py-1", sortBy === k ? "bg-night-700 text-night-100" : "text-night-400 hover:text-night-100")}>
                  {k === "course" ? "Course order" : "Most to gain"}
                </button>
              ))}
            </div>
          }
        />
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[48rem] text-sm">
            <thead>
              <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
                <th className="py-2 pr-3 font-medium">Course</th>
                <th className="px-2 py-2 text-right font-medium">Races</th>
                <th className="px-2 py-2 text-right font-medium" title="Its fastest race here, and the machine">Best</th>
                <th className="px-2 py-2 text-right font-medium">Median</th>
                <th className="px-2 py-2 text-right font-medium" title="How much its times vary here">Spread</th>
                <th className="px-2 py-2 font-medium" title="Machine with its fastest median here (2+ races), when it has tried more than one">Best machine</th>
                <th className="px-2 py-2 text-right font-medium" title="Fastest time anyone has logged here in this format">Course record</th>
                <th className="py-2 pl-2 text-right font-medium" title="Its median time minus the course record: how much a typical race gives away">To record</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {shown.map(c => (
                <tr key={c.stageId} className={cx(c.races === 0 && "text-night-600")}>
                  <td className="py-2 pr-3"><Link to="stage" params={{ id: c.stageId, format: format.id }} className="font-medium hover:text-air-400">{name(c.stageId)}</Link></td>
                  <td className="px-2 py-2 text-right tabular">{c.races || "—"}</td>
                  <td className="px-2 py-2 text-right tabular">
                    {c.bestMs !== null ? <><span className={cx("font-mono", c.isRecord && "font-semibold text-star-400")}>{c.isRecord && "★ "}{formatGameTime(c.bestMs)}</span><div className="text-xs text-night-400">{machine(c.bestMachine)}</div></> : "not raced"}
                  </td>
                  <td className="px-2 py-2 text-right font-mono tabular">{c.medianMs !== null ? formatGameTime(c.medianMs) : "—"}</td>
                  <td className="px-2 py-2 text-right tabular">{c.spreadMs !== null ? `±${(c.spreadMs / 1000).toFixed(2)}s` : "—"}</td>
                  <td className="px-2 py-2">{c.topMachine ? <>{machine(c.topMachine.machineId)} <span className="text-xs text-night-400">({formatGameTime(c.topMachine.medianMs)})</span></> : <span className="text-night-600">—</span>}</td>
                  <td className="px-2 py-2 text-right font-mono tabular text-night-300">{c.recordMs !== null ? formatGameTime(c.recordMs) : "—"}</td>
                  <td className="py-2 pl-2 text-right tabular">{gapToRecord(c) !== null ? (gapToRecord(c)! <= 0 ? <span className="text-ok-400">holds it</span> : `+${secs(gapToRecord(c)!)}`) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-night-400">★ = it holds the course record. "Most to gain" puts the courses where its typical race is furthest from the record first.</p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Form" subtitle="Pace vs each course's median, recent races against earlier ones." />
          {recentAvg === null ? <p className="text-sm text-night-400">No timed races yet.</p> : (
            <ul className="space-y-2 text-sm">
              <li>Last {recent.length} race{recent.length === 1 ? "" : "s"}: <span className="font-semibold">{signedPct(recentAvg)}</span></li>
              {beforeAvg !== null && <li>Earlier {before.length}: <span className="font-semibold">{signedPct(beforeAvg)}</span>{" "}
                <span className={cx("text-xs", recentAvg < beforeAvg - 0.3 ? "text-ok-400" : recentAvg > beforeAvg + 0.3 ? "text-bad-400" : "text-night-400")}>
                  ({recentAvg < beforeAvg - 0.3 ? "faster lately" : recentAvg > beforeAvg + 0.3 ? "slower lately" : "about the same"})
                </span>
              </li>}
              {strongest.length > 1 && <li>Strongest course: <span className="font-semibold">{name(strongest[0].c.stageId)}</span> ({signedPct(strongest[0].pct)} vs the field)</li>}
              {strongest.length > 1 && <li>Weakest course: <span className="font-semibold">{name(strongest[strongest.length - 1].c.stageId)}</span> ({signedPct(strongest[strongest.length - 1].pct)})</li>}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Not raced yet" subtitle={`Gaps in ${nick}'s data in this format.`} />
          <div className="space-y-2 text-sm">
            <p><span className="text-night-400">Courses: </span>{untriedCourses.length ? untriedCourses.map(c => name(c.stageId)).join(", ") : "all raced"}</p>
            <p><span className="text-night-400">Machines: </span>{untriedMachines.length ? untriedMachines.map(m => m.name).join(", ") : "all tried"}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
