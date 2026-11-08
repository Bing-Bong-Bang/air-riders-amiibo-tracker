// Full runs (#/runs and #/run?id=…): one amiibo, every course once, IGT summed.

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { getAll, getAllByIndex, getById } from "../db/database";
import { createRun, deleteRun, saveRace, updateRun } from "../db/repo";
import { formatGameTime, formatGap, cpuSetupText } from "../domain/schema";
import type { Format, ID, Millis, Race, Run } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { loadCoreRows } from "../domain/coreData";
import type { ResultRow } from "../domain/insights";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { newId } from "../lib/ids";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate, useLocation } from "../lib/router";
import { Checkbox, Field, SaveErrorNotice, Select, TextInput, TimeInput } from "../components/form";
import { Badge, Button, Card, CardHeader, Notice, Spinner, StatTile, cx } from "../components/ui";

const STATUS: Record<Run["status"], { label: string; tone: "neutral" | "ok" | "bad" | "star" }> = {
  in_progress: { label: "In progress", tone: "star" },
  complete: { label: "Complete", tone: "ok" },
  forfeit: { label: "Forfeit", tone: "bad" },
  abandoned: { label: "Abandoned", tone: "neutral" },
};

const courseIds = (f: Format | undefined) => (f?.runStructure.kind === "course_set" ? f.runStructure.stageIds : []);
const runTime = (r: Race) => r.entries[0]?.finishTimeMs ?? null;

interface RunInfo {
  run: Run;
  races: Race[];
  byStage: Map<ID, Race>;
  totalMs: Millis | null;       // sum of finished courses
  done: number;
}

function runInfo(run: Run, races: Race[]): RunInfo {
  const mine = races.filter(r => r.runId === run.id);
  const times = mine.map(runTime);
  return {
    run,
    races: mine,
    byStage: new Map(mine.map(r => [r.stageId, r])),
    totalMs: times.length && times.every(t => t !== null) ? (times as Millis[]).reduce((a, b) => a + b, 0) : null,
    done: mine.length,
  };
}

/** PB = fastest complete run of the format; sum of best = best counted time per course in complete or in-progress runs. */
function benchmarks(format: Format | undefined, infos: RunInfo[], exceptRunId?: ID) {
  const complete = infos.filter(i => i.run.status === "complete" && i.run.includeInStats && i.totalMs !== null && i.run.id !== exceptRunId);
  const pb = complete.sort((a, b) => (a.totalMs as number) - (b.totalMs as number))[0] ?? null;
  const best = new Map<ID, Millis>();
  for (const i of infos) {
    if (i.run.status === "forfeit" || i.run.status === "abandoned" || !i.run.includeInStats) continue;
    for (const r of i.races) {
      const t = runTime(r);
      if (t !== null && r.includeInStats && (!best.has(r.stageId) || t < (best.get(r.stageId) as number))) best.set(r.stageId, t);
    }
  }
  const ids = courseIds(format);
  const sumOfBest = ids.length && ids.every(id => best.has(id)) ? ids.reduce((a, id) => a + (best.get(id) as number), 0) : null;
  return { pb, best, sumOfBest };
}

function useRunData(mode: "air_ride" | "top_ride") {
  return useLiveQuery(async () => {
    const [runs, races, formats] = await Promise.all([getAll("runs"), getAllByIndex("races", "mode", mode), getAll("formats")]);
    const modeFormats = new Set(formats.filter(f => f.mode === mode).map(f => f.id));
    const modeRuns = runs.filter(r => modeFormats.has(r.formatId));
    const runRaces = races.filter(r => r.runId);
    return modeRuns.map(run => runInfo(run, runRaces));
  }, [mode], ["runs", "races", "formats"]);
}

// -------------------------------------------------------------
// Runs list
// -------------------------------------------------------------

function StartRunForm({ ref_, onCancel }: { ref_: Reference; onCancel: () => void }) {
  const { mode } = useMode();
  const runFormats = ref_.formats.filter(f => !f.isArchived && f.runStructure.kind === "course_set");
  const [formatId, setFormatId] = useState((runFormats.find(f => f.id === ref_.settings?.recordFormatIds[mode]) ?? runFormats[0])?.id ?? "");
  const [profileId, setProfileId] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const active = ref_.profiles.filter(p => p.status === "active");
  const groups = ref_.riders.map(r => ({ rider: r, profiles: active.filter(p => p.riderId === r.id) })).filter(g => g.profiles.length);
  const format = ref_.formatById.get(formatId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!profileId) return setError(new Error("Pick the amiibo for this run."));
    setBusy(true);
    try { const run = await createRun({ formatId, profileId }); navigate("run", { id: run.id }); } catch (err) { setError(err); setBusy(false); }
  };

  return (
    <Card className="border-air-500/40">
      <form onSubmit={submit} className="space-y-4">
        <CardHeader title="Start a run" subtitle={format ? `${courseIds(format).length} courses, any order, each once.${format.runStructure.kind === "course_set" && format.runStructure.machineMayChange ? " Machine can change between courses." : ""}` : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Format" htmlFor="sr-format">
            <Select id="sr-format" value={formatId} onChange={e => setFormatId(e.target.value)}>
              {runFormats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Amiibo" htmlFor="sr-amiibo">
            <Select id="sr-amiibo" value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="">Choose…</option>
              {groups.map(g => (
                <optgroup key={g.rider.id} label={g.rider.name}>
                  {g.profiles.map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
        </div>
        {format?.fillerCpu && (
          <p className="text-sm text-night-400">Setup: {cpuSetupText(format.fillerCpu, ref_.riderById.get(format.fillerCpu.riderId), ref_.machineById.get(format.fillerCpu.machineId))}.</p>
        )}
        <SaveErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy || !formatId}>{busy ? "Starting…" : "Start run"}</Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Sum of Best: the fastest possible run from the best counted time on each
 * course. "Any amiibo" mixes amiibo, which the rules don't allow, so each
 * amiibo's own Sum of Best (same amiibo throughout, any machine) is the
 * legal version.
 */
function SumOfBestCard({ format, rows, ref_, pbMs }: { format: Format; rows: ResultRow[]; ref_: Reference; pbMs: Millis | null }) {
  const [open, setOpen] = useState(false);
  const stageIds = courseIds(format);
  const baseline = new Set(ref_.profiles.filter(p => p.isBaseline).map(p => p.id));
  type Best = { ms: Millis; profileId: ID; machineId: ID; racedAt: string };
  const overall = new Map<ID, Best>();
  const perAmiibo = new Map<ID, Map<ID, Best>>();
  for (const { race, entry } of rows) {
    if (entry.status !== "finished" || entry.finishTimeMs === null || entry.racer.kind !== "amiibo" || baseline.has(entry.racer.profileId)) continue;
    if (!stageIds.includes(race.stageId)) continue;
    const b: Best = { ms: entry.finishTimeMs, profileId: entry.racer.profileId, machineId: entry.machineId, racedAt: race.racedAt };
    if (!overall.has(race.stageId) || b.ms < overall.get(race.stageId)!.ms) overall.set(race.stageId, b);
    const mine = perAmiibo.get(b.profileId) ?? new Map<ID, Best>();
    if (!mine.has(race.stageId) || b.ms < mine.get(race.stageId)!.ms) mine.set(race.stageId, b);
    perAmiibo.set(b.profileId, mine);
  }
  if (!overall.size) return null;
  const sum = (m: Map<ID, Best>) => [...m.values()].reduce((a, b) => a + b.ms, 0);
  const complete = overall.size === stageIds.length;
  const amiibo = [...perAmiibo].map(([id, m]) => ({ id, done: m.size, total: sum(m), map: m }))
    .sort((a, b) => b.done - a.done || a.total - b.total);
  const nick = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";
  const machine = (id: ID) => ref_.machineById.get(id)?.name ?? "?";

  return (
    <Card>
      <CardHeader
        title={`Sum of Best · ${format.name}`}
        subtitle="The fastest possible run if every course went as well as your best time there. Counted races only (runs, trials you kept, logged races)."
      />
      <div className="grid gap-3 md:grid-cols-3">
        <StatTile
          label="Sum of Best (any amiibo)"
          value={complete ? <span className="text-star-400" data-testid="sob-any">{formatGameTime(sum(overall))}</span> : `${overall.size}/${stageIds.length} courses`}
          hint={complete ? "Mixes amiibo, so not a legal run, just the dream" : `${stageIds.length - overall.size} course${stageIds.length - overall.size === 1 ? "" : "s"} still without a time`}
        />
        <StatTile
          label="Best legal Sum of Best"
          value={amiibo[0] && amiibo[0].done === stageIds.length ? formatGameTime(amiibo[0].total) : "—"}
          hint={amiibo[0] && amiibo[0].done === stageIds.length ? `${nick(amiibo[0].id)}, any machine per course` : "No amiibo has a time on every course yet"}
        />
        <StatTile
          label="Your PB"
          value={pbMs !== null ? formatGameTime(pbMs) : "—"}
          hint={pbMs !== null && amiibo[0]?.done === stageIds.length ? `${formatGap(pbMs - amiibo[0].total).replace(/^\+/, "")} possible time save` : pbMs === null ? "No complete run yet" : undefined}
        />
      </div>
      {amiibo.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-night-400">Per amiibo (same amiibo all run, as the rules require)</h3>
          <ul className="mt-2 divide-y divide-night-800 text-sm">
            {amiibo.map(a => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span><span className="font-medium">{nick(a.id)}</span> <span className="text-xs text-night-400">{ref_.riderById.get(ref_.profileById.get(a.id)?.riderId ?? "")?.name}</span></span>
                <span className="tabular">{a.done === stageIds.length ? <span className="font-mono">{formatGameTime(a.total)}</span> : <span className="text-night-400">{a.done}/{stageIds.length} courses</span>}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-4 text-sm font-semibold text-air-400 hover:underline">
        {open ? "Hide" : "Show"} best time per course
      </button>
      {open && (
        <table className="mt-2 w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-night-400">
            <tr><th className="py-1.5 pr-3">Course</th><th className="py-1.5 pr-3">Best</th><th className="py-1.5 pr-3">By</th><th className="py-1.5 text-right">Date</th></tr>
          </thead>
          <tbody className="divide-y divide-night-800">
            {stageIds.map(id => {
              const b = overall.get(id);
              return (
                <tr key={id}>
                  <td className="py-1.5 pr-3">{ref_.stageById.get(id)?.name ?? "?"}</td>
                  <td className="py-1.5 pr-3 font-mono tabular">{b ? formatGameTime(b.ms) : <span className="text-night-600">—</span>}</td>
                  <td className="py-1.5 pr-3 text-night-300">{b ? `${nick(b.profileId)} · ${machine(b.machineId)}` : ""}</td>
                  <td className="py-1.5 text-right text-night-400">{b ? new Date(b.racedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function RunsPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const data = useRunData(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const [starting, setStarting] = useState(false);

  if (error || data.error) return <Notice tone="bad" title="Couldn't load runs">{(error ?? data.error)?.message}</Notice>;
  if (loading || data.loading || !ref_ || !data.data) return <Spinner />;

  const runFormats = ref_.formats.filter(f => !f.isArchived && f.runStructure.kind === "course_set");
  const infos = data.data;
  const name = (run: Run) => (run.racer.kind === "amiibo" ? ref_.profileById.get(run.racer.profileId)?.nickname : "?") ?? "?";
  const sections: [string, RunInfo[]][] = [
    ["In progress", infos.filter(i => i.run.status === "in_progress").sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt))],
    ["Complete (fastest first)", infos.filter(i => i.run.status === "complete").sort((a, b) => (a.totalMs ?? Infinity) - (b.totalMs ?? Infinity))],
    ["Forfeit or abandoned", infos.filter(i => i.run.status === "forfeit" || i.run.status === "abandoned").sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt))],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{modeLabel(mode)} runs</h1>
          <p className="mt-1 text-night-300">Full attempts at an all-courses category: one amiibo, every course once, times summed.</p>
        </div>
        {!starting && runFormats.length > 0 && <Button variant="primary" onClick={() => setStarting(true)}>Start a run</Button>}
      </div>
      {runFormats.length === 0 && (
        <Notice title={`No ${modeLabel(mode)} full-run formats`}>Create a format and choose "Full run" under How races group. <Link to="formats" className="font-semibold text-air-400 underline">Formats</Link></Notice>
      )}
      {starting && <StartRunForm ref_={ref_} onCancel={() => setStarting(false)} />}
      {runFormats.map(f => {
        const pb = infos.filter(i => i.run.formatId === f.id && i.run.status === "complete" && i.totalMs !== null)
          .reduce<Millis | null>((m, i) => (m === null || Number(i.totalMs) < m ? i.totalMs : m), null);
        return core.data ? <SumOfBestCard key={f.id} format={f} rows={core.data.get(f.id) ?? []} ref_={ref_} pbMs={pb} /> : null;
      })}
      {infos.length === 0 && !starting && runFormats.length > 0 && <Notice title="No runs yet">Start one to track a full attempt course by course.</Notice>}
      {sections.filter(([, list]) => list.length).map(([title, list]) => (
        <div key={title} className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-night-400">{title}</h2>
          <Card className="p-0">
            <ul className="divide-y divide-night-800">
              {list.map((i, k) => {
                const total = courseIds(ref_.formatById.get(i.run.formatId)).length;
                const isPb = title.startsWith("Complete") && k === 0;
                return (
                  <li key={i.run.id}>
                    <Link to="run" params={{ id: i.run.id }} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-night-850">
                      <span>
                        <span className="font-semibold">{name(i.run)}</span>
                        <span className="ml-2 text-sm text-night-400">{new Date(i.run.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {ref_.formatById.get(i.run.formatId)?.name}</span>
                      </span>
                      <span className="flex items-center gap-3">
                        {isPb && <Badge tone="star">PB</Badge>}
                        <span className="text-sm text-night-400">{i.done}/{total}</span>
                        <span className="font-mono tabular">{i.totalMs !== null ? formatGameTime(i.totalMs) : "—"}</span>
                        <Badge tone={STATUS[i.run.status].tone}>{STATUS[i.run.status].label}</Badge>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------
// One run
// -------------------------------------------------------------

function CourseEntry({ info, format, ref_, remaining }: { info: RunInfo; format: Format; ref_: Reference; remaining: ID[] }) {
  const run = info.run;
  const lastRace = [...info.races].sort((a, b) => b.racedAt.localeCompare(a.racedAt))[0];
  const [stageId, setStageId] = useState<ID>(remaining[0] ?? "");
  const [machineId, setMachineId] = useState<ID>(lastRace?.entries[0]?.machineId ?? "");
  const [timeMs, setTimeMs] = useState<Millis | null>(null);
  const [glitch, setGlitch] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const timeRef = useRef<HTMLInputElement>(null);
  const machineMayChange = format.runStructure.kind === "course_set" && format.runStructure.machineMayChange;
  const lockedMachine = !machineMayChange && lastRace ? lastRace.entries[0]?.machineId : undefined;

  // When a course is saved, move to the next remaining one.
  useEffect(() => { if (!remaining.includes(stageId)) setStageId(remaining[0] ?? ""); }, [remaining, stageId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!stageId) return setError(new Error("Pick the course."));
    if (!(lockedMachine ?? machineId)) return setError(new Error("Pick the machine."));
    if (timeMs === null) return setError(new Error("Enter the course time, like 01:25.72."));
    if (glitch && format.forbidsGlitches && !window.confirm("A glitch forfeits this run. Its races will be left out of stats. Continue?")) return;
    if (run.racer.kind !== "amiibo") return;
    const profile = ref_.profileById.get(run.racer.profileId);
    setBusy(true);
    try {
      await saveRace({
        mode: format.mode,
        formatId: format.id,
        stageId,
        racedAt: new Date().toISOString(),
        runId: run.id,
        includeInStats: true,
        glitchOccurred: glitch || undefined,
        notes,
        entries: [{
          id: newId(),
          racer: run.racer,
          riderId: profile?.riderId ?? "",
          machineId: lockedMachine ?? machineId,
          status: "finished",
          finishTimeMs: timeMs,
          includeInStats: true,
        }],
      });
      setTimeMs(null);
      setGlitch(false);
      setNotes("");
      requestAnimationFrame(() => timeRef.current?.focus());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <form onSubmit={submit} noValidate className="space-y-4">
        <CardHeader title="Log a course" subtitle={`${remaining.length} course${remaining.length === 1 ? "" : "s"} to go`} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Course" htmlFor="rc-course">
            <Select id="rc-course" value={stageId} onChange={e => setStageId(e.target.value)}>
              {remaining.map(id => <option key={id} value={id}>{ref_.stageById.get(id)?.name}</option>)}
            </Select>
          </Field>
          <Field label="Machine" htmlFor="rc-machine" hint={lockedMachine ? "Same machine all run" : undefined}>
            <Select id="rc-machine" value={lockedMachine ?? machineId} onChange={e => setMachineId(e.target.value)} disabled={!!lockedMachine}>
              <option value="">Choose…</option>
              {ref_.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Course time (IGT)" htmlFor="rc-time">
            <TimeInput id="rc-time" inputRef={timeRef} value={timeMs} onChange={setTimeMs} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <Checkbox checked={glitch} onChange={setGlitch} label="A glitch or clip happened" hint={format.forbidsGlitches ? "This forfeits the run" : undefined} />
          <Field label="Notes (optional)" htmlFor="rc-notes" className="min-w-64 flex-1"><TextInput id="rc-notes" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        </div>
        <SaveErrorNotice error={error} />
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" disabled={busy} className="px-6 py-2.5 text-base">{busy ? "Saving…" : "Save course"}</Button>
          <span className="text-xs text-night-400">Enter in the time box saves</span>
        </div>
      </form>
    </Card>
  );
}

function RunControls({ run }: { run: Run }) {
  const [panel, setPanel] = useState<"none" | "forfeit" | "delete">("none");
  const [reason, setReason] = useState("");
  const [video, setVideo] = useState(run.videoUrl ?? "");
  // Shown immediately; follows the saved value whenever it changes.
  const [submitted, setSubmitted] = useState(!!run.submitted);
  useEffect(() => { setSubmitted(!!run.submitted); }, [run.submitted]);
  const [error, setError] = useState<unknown>(null);
  const act = async (fn: () => Promise<void>) => { setError(null); try { await fn(); setPanel("none"); } catch (e) { setError(e); } };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        {run.status === "in_progress" && (
          <>
            <Button variant="ghost" className="hover:text-bad-400" onClick={() => setPanel(panel === "forfeit" ? "none" : "forfeit")}>Forfeit…</Button>
            <Button variant="ghost" onClick={() => { if (window.confirm("Abandon this run? Its course times stay in stats.")) void act(() => updateRun(run.id, { status: "abandoned" })); }}>Abandon</Button>
          </>
        )}
        {(run.status === "forfeit" || run.status === "abandoned") && (
          <Button variant="ghost" onClick={() => void act(() => updateRun(run.id, { status: "in_progress" }))}>Resume run</Button>
        )}
        {run.status === "complete" && (
          <>
            <Field label="Video link" htmlFor="rn-video" className="min-w-72 flex-1">
              <TextInput id="rn-video" placeholder="https://…" value={video} onChange={e => setVideo(e.target.value)} onBlur={() => video !== (run.videoUrl ?? "") && void act(() => updateRun(run.id, { videoUrl: video }))} />
            </Field>
            <div className="pb-2"><Checkbox checked={submitted} onChange={v => { setSubmitted(v); void act(() => updateRun(run.id, { submitted: v })).catch(() => setSubmitted(!v)); }} label="Submitted to the leaderboard" /></div>
          </>
        )}
        <Button variant="ghost" className="ml-auto hover:text-bad-400" onClick={() => setPanel(panel === "delete" ? "none" : "delete")}>Delete…</Button>
      </div>
      <SaveErrorNotice error={error} />
      {panel === "forfeit" && (
        <div className="mt-4 space-y-3 rounded-xl border border-bad-400/40 bg-bad-400/5 p-4" role="alertdialog" aria-label="Forfeit run">
          <h3 className="font-semibold text-bad-400">Forfeit this run?</h3>
          <p className="text-sm text-night-300">All of its course times are dropped from stats.</p>
          <Field label="Reason (optional)" htmlFor="rn-reason" className="max-w-md"><TextInput id="rn-reason" value={reason} onChange={e => setReason(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void act(() => updateRun(run.id, { status: "forfeit", forfeitReason: reason.trim() || "Forfeited" }))}>Forfeit run</Button>
            <Button variant="ghost" onClick={() => setPanel("none")}>Keep going</Button>
          </div>
        </div>
      )}
      {panel === "delete" && (
        <div className="mt-4 space-y-3 rounded-xl border border-bad-400/40 bg-bad-400/5 p-4" role="alertdialog" aria-label="Delete run">
          <h3 className="font-semibold text-bad-400">Delete this run and all its course times?</h3>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void act(async () => { await deleteRun(run.id); navigate("runs"); })}>Delete run</Button>
            <Button variant="ghost" onClick={() => setPanel("none")}>Keep it</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function RunPage() {
  const { mode, setMode } = useMode();
  const { params } = useLocation();
  const id = params.get("id") ?? "";
  const runQ = useLiveQuery(async () => (id ? (await getById("runs", id)) ?? null : null), [id], ["runs"]);
  const run = runQ.data ?? null;
  const formatQ = useLiveQuery(async () => (run ? (await getById("formats", run.formatId)) ?? null : null), [run?.formatId], ["formats"]);
  const runMode = formatQ.data?.mode ?? mode;
  useEffect(() => { if (formatQ.data && formatQ.data.mode !== mode) setMode(formatQ.data.mode); }, [formatQ.data, mode, setMode]);
  const { data: ref_, error, loading } = useReference(runMode);
  const all = useRunData(runMode);

  const info = useMemo(() => all.data?.find(i => i.run.id === id) ?? null, [all.data, id]);
  if (runQ.loading || formatQ.loading || loading || all.loading) return <Spinner />;
  if (!run) return <Notice tone="bad" title="That run wasn't found">It may have been deleted. <Link to="runs" className="underline">Back to runs</Link></Notice>;
  if (error || !ref_ || !info) return <Spinner />;

  const format = ref_.formatById.get(run.formatId);
  const courses = courseIds(format);
  const remaining = courses.filter(c => !info.byStage.has(c));
  const name = run.racer.kind === "amiibo" ? ref_.profileById.get(run.racer.profileId)?.nickname : "?";
  const { pb, best, sumOfBest } = benchmarks(format, (all.data ?? []).filter(i => i.run.formatId === run.formatId), run.id);
  const pbTimes = pb ? new Map([...pb.byStage].map(([k, r]) => [k, runTime(r)])) : null;

  // PB comparison: delta over the courses done so far (same courses in the PB run).
  const doneIds = courses.filter(c => info.byStage.has(c));
  const pbSoFar = pbTimes && doneIds.every(c => pbTimes.get(c) != null) ? doneIds.reduce((a, c) => a + (pbTimes.get(c) as number), 0) : null;
  const deltaToPb = info.totalMs !== null && pbSoFar !== null ? info.totalMs - pbSoFar : null;

  return (
    <div className="space-y-6">
      <div>
        <Link to="runs" className="text-sm text-night-400 hover:text-night-100">← Runs</Link>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-bold">{name ? (name.endsWith("s") ? `${name}' run` : `${name}'s run`) : "Run"}</h1>
            <p className="mt-1 text-night-300">{format?.name} · started {new Date(run.startedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
          </div>
          <Badge tone={STATUS[run.status].tone}>{STATUS[run.status].label}{run.forfeitReason ? `: ${run.forfeitReason}` : ""}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={run.status === "complete" ? "Final IGT" : "IGT so far"} value={<span className="font-mono">{formatGameTime(info.totalMs ?? 0)}</span>} />
        <StatTile label="Courses" value={`${info.done} / ${courses.length}`} />
        <StatTile label="vs PB (same courses)" value={deltaToPb === null ? "—" : <span className={deltaToPb < 0 ? "text-ok-400" : deltaToPb > 0 ? "text-bad-400" : ""}>{formatGap(deltaToPb)}</span>}
          hint={pb?.totalMs ? `PB ${formatGameTime(pb.totalMs)}` : "No complete run yet"} />
        <StatTile label="Sum of best" value={<span className="font-mono">{sumOfBest !== null ? formatGameTime(sumOfBest) : "—"}</span>} hint="Best time on every course added up" />
      </div>

      {run.status === "forfeit" && <Notice tone="bad" title="Forfeited">This run's course times are left out of stats.</Notice>}
      {format && run.status === "in_progress" && remaining.length > 0 && <CourseEntry key={run.id} info={info} format={format} ref_={ref_} remaining={remaining} />}
      {run.status === "complete" && <Notice tone="ok" title={`Run complete: ${formatGameTime(info.totalMs)}`}>{pb?.totalMs && info.totalMs !== null && info.totalMs < pb.totalMs ? "New personal best!" : "Every course done."}</Notice>}

      <RunControls run={run} />

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
                <th className="px-5 py-3 font-medium">Course</th>
                <th className="px-3 py-3 font-medium">Machine</th>
                <th className="px-3 py-3 text-right font-medium">Time</th>
                <th className="px-3 py-3 text-right font-medium">PB split</th>
                <th className="px-3 py-3 text-right font-medium">vs PB</th>
                <th className="px-5 py-3 text-right font-medium">Best ever</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {courses.map(cid => {
                const race = info.byStage.get(cid);
                const t = race ? runTime(race) : null;
                const pbT = pbTimes?.get(cid) ?? null;
                const delta = t !== null && pbT !== null ? t - pbT : null;
                const bestT = best.get(cid) ?? null;
                return (
                  <tr key={cid} className={cx(!race && "text-night-400")}>
                    <td className="px-5 py-2.5 font-medium">
                      {ref_.stageById.get(cid)?.name}
                      {race?.glitchOccurred && <span className="ml-2"><Badge tone="bad">glitch</Badge></span>}
                    </td>
                    <td className="px-3 py-2.5">{race ? ref_.machineById.get(race.entries[0]?.machineId)?.name : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular">{t !== null ? formatGameTime(t) : "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular text-night-300">{pbT !== null ? formatGameTime(pbT) : "—"}</td>
                    <td className={cx("px-3 py-2.5 text-right font-mono tabular", delta !== null && (delta < 0 ? "text-ok-400" : delta > 0 ? "text-bad-400" : ""))}>{delta !== null ? formatGap(delta) : "—"}</td>
                    <td className={cx("px-5 py-2.5 text-right font-mono tabular", t !== null && bestT !== null && t <= bestT && "text-star-400")}>{bestT !== null ? formatGameTime(bestT) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
