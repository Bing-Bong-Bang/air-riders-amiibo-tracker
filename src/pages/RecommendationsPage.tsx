// Recommendations: the best combo for every stage of the world-record
// format, a run plan for full-run formats, and which races to run next.

import { useMemo, useState } from "react";
import { buildObservations, gameVersionsIn, loadCoreRows, scopeFilter } from "../domain/coreData";
import type { AmiiboScope } from "../domain/coreData";
import { AmiiboScopeSelect } from "../components/AmiiboScopeSelect";
import { buildRunPlans, buildStageRecommendations, formatGameTime, formatGap } from "../domain/schema";
import type { CandidateOption, Format, ID, RecommendationStatus, RunPlan, StageRecommendation } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link, navigate } from "../lib/router";
import { Checkbox, Segmented, Select } from "../components/form";
import { Badge, Button, Card, CardHeader, Notice, Spinner, StarMark, cx } from "../components/ui";

type Scope = "profiles" | "riders";

const STATUS: Record<RecommendationStatus, { label: string; tone: "ok" | "star" | "neutral"; help: string }> = {
  settled: { label: "Settled", tone: "ok", help: "Measured, and clearly ahead of every alternative" },
  likely: { label: "Likely", tone: "star", help: "Measured best, but a rival is still within the noise" },
  needs_data: { label: "Needs data", tone: "neutral", help: "Not measured yet, or an untested combo looks like it could win" },
};

function who(scope: Scope, key: string, ref_: Reference): { name: string; sub?: string } {
  if (scope === "profiles") {
    const p = ref_.profileById.get(key);
    return { name: p?.nickname ?? "?", sub: p ? ref_.riderById.get(p.riderId)?.name : undefined };
  }
  return { name: ref_.riderById.get(key)?.name ?? "?" };
}

function OptionLabel({ c, scope, ref_, showTime = true }: { c: CandidateOption; scope: Scope; ref_: Reference; showTime?: boolean }) {
  const w = who(scope, c.rider, ref_);
  const machine = ref_.machineById.get(c.machineId)?.name ?? "?";
  return (
    <span>
      <span className="font-medium text-night-100">{w.name}</span>
      <span className="text-night-300"> + {machine}</span>
      {showTime && (
        <span className="ml-2 font-mono tabular text-night-300">
          {c.source === "predicted" ? "~" : ""}{formatGameTime(c.expectedMs)}
          {c.source === "measured" && c.ciHighMs !== null && <span className="text-night-400"> ±{formatGap(c.ciHighMs - c.expectedMs).slice(1)}</span>}
        </span>
      )}
      <span className="ml-1.5 text-xs text-night-400">{c.source === "measured" ? `${c.n} race${c.n === 1 ? "" : "s"}` : c.n ? `predicted · ${c.n} race${c.n === 1 ? "" : "s"} so far` : "predicted"}</span>
    </span>
  );
}

// -------------------------------------------------------------

function StageTable({ recs, scope, ref_ }: { recs: StageRecommendation[]; scope: Scope; ref_: Reference }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
            <th className="py-2 pr-3 font-medium">Stage</th>
            <th className="py-2 pr-3 font-medium">Recommended</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Runner-up</th>
            <th className="py-2 text-right font-medium">Stage record</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-night-800">
          {recs.map(r => {
            const runnerUp = r.alternatives.find(a => a.source === "measured") ?? r.alternatives[0];
            const st = STATUS[r.status];
            return (
              <tr key={r.stageId} className="align-top">
                <td className="py-3 pr-3 font-semibold">{ref_.stageById.get(r.stageId)?.name}</td>
                <td className="py-3 pr-3">
                  {r.best ? <OptionLabel c={r.best} scope={scope} ref_={ref_} /> : <span className="text-night-400">No measured combo yet</span>}
                </td>
                <td className="py-3 pr-3"><span title={st.help}><Badge tone={st.tone}>{st.label}</Badge></span></td>
                <td className="py-3 pr-3 text-xs">{runnerUp ? <OptionLabel c={runnerUp} scope={scope} ref_={ref_} /> : <span className="text-night-400">—</span>}</td>
                <td className="py-3 text-right">
                  {r.stageRecord ? (
                    <>
                      <div className="font-mono tabular text-star-400">{formatGameTime(r.stageRecord.timeMs)}</div>
                      <div className="text-xs text-night-400">{who(scope, r.stageRecord.rider, ref_).name} + {ref_.machineById.get(r.stageRecord.machineId)?.name}</div>
                    </>
                  ) : <span className="text-night-400">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Untested or under-tested combos that could beat each stage's current best, biggest potential gain first. */
function TestNext({ recs, scope, ref_, minSample }: { recs: StageRecommendation[]; scope: Scope; ref_: Reference; minSample: number }) {
  const items = recs.flatMap(r => r.testNext.map(c => ({
    stageId: r.stageId,
    c,
    gain: r.best ? r.best.expectedMs - c.expectedMs : null,
  })))
    .sort((a, b) => (b.gain ?? -Infinity) - (a.gain ?? -Infinity))
    .slice(0, 10);
  if (items.length === 0) return <p className="text-sm text-night-400">Nothing to test: every stage with data is settled.</p>;
  return (
    <ol className="space-y-2">
      {items.map(({ stageId, c, gain }, i) => {
        const need = Math.max(1, minSample - c.n);
        return (
          <li key={`${stageId}-${c.rider}-${c.machineId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-night-850 px-4 py-3 text-sm">
            <span>
              <span className="mr-2 font-display font-bold text-night-400">{i + 1}.</span>
              <span className="font-semibold">{ref_.stageById.get(stageId)?.name}:</span>{" "}
              <OptionLabel c={c} scope={scope} ref_={ref_} showTime={false} />
            </span>
            <span className="flex items-center gap-3 text-night-300">
              {gain !== null && gain > 0 && <span>could be <span className="font-mono text-ok-400">{formatGap(-gain)}</span> faster</span>}
              {gain !== null && gain <= 0 && <span>close to the current best</span>}
              <Badge>{need} more race{need === 1 ? "" : "s"}</Badge>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function RunPlans({ plans, scope, ref_, format }: { plans: RunPlan[]; scope: Scope; ref_: Reference; format: Format }) {
  const [open, setOpen] = useState<string | null>(plans[0]?.rider ?? null);
  const courses = format.runStructure.kind === "course_set" ? format.runStructure.stageIds.length : 0;
  const best = plans.find(p => p.coursesMissing.length === 0 && p.coursesPredicted === 0);
  if (plans.length === 0) return <p className="text-sm text-night-400">No amiibo has results in this format yet.</p>;
  return (
    <div className="space-y-2">
      {plans.map(plan => {
        const w = who(scope, plan.rider, ref_);
        const complete = plan.coursesMissing.length === 0;
        const isOpen = open === plan.rider;
        return (
          <div key={plan.rider} className={cx("rounded-xl border", plan === best ? "border-star-400/50" : "border-night-700")}>
            <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : plan.rider)}
              className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-night-850">
              <span className="flex items-center gap-2">
                {plan === best && <StarMark className="text-star-400" />}
                <span className="font-semibold">{w.name}</span>
                {w.sub && <span className="text-sm text-night-400">{w.sub}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-night-400">
                  {plan.coursesMeasured}/{courses} measured{plan.coursesPredicted ? `, ${plan.coursesPredicted} predicted` : ""}{plan.coursesMissing.length ? `, ${plan.coursesMissing.length} missing` : ""}
                </span>
                <span className="font-mono text-base tabular">
                  {complete ? <>{plan.coursesPredicted ? "~" : ""}{formatGameTime(plan.totalMs)}</> : "—"}
                  {plan.totalCiHalfWidthMs !== null && <span className="text-sm text-night-400"> ±{formatGap(plan.totalCiHalfWidthMs).slice(1)}</span>}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="border-t border-night-800 px-4 py-3">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-night-800">
                    {plan.courses.map(c => (
                      <tr key={c.stageId}>
                        <td className="py-1.5 pr-3">{ref_.stageById.get(c.stageId)?.name}</td>
                        <td className="py-1.5 pr-3 font-medium">{ref_.machineById.get(c.machineId)?.name}</td>
                        <td className="py-1.5 pr-3 text-xs text-night-400">{c.source === "measured" ? `${c.n} race${c.n === 1 ? "" : "s"}` : "predicted, test it"}</td>
                        <td className="py-1.5 text-right font-mono tabular">{c.source === "predicted" ? "~" : ""}{formatGameTime(c.expectedMs)}</td>
                      </tr>
                    ))}
                    {plan.coursesMissing.map(id => (
                      <tr key={id} className="text-night-400">
                        <td className="py-1.5 pr-3">{ref_.stageById.get(id)?.name}</td>
                        <td className="py-1.5 pr-3" colSpan={3}>No data yet</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// -------------------------------------------------------------

export function RecommendationsPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const core = useLiveQuery(() => loadCoreRows(mode), [mode], ["races", "testSets", "runs"]);
  const [formatChoice, setFormatChoice] = useState<ID>("");
  const [scope, setScope] = useState<Scope>("profiles");
  const [legendaries, setLegendaries] = useState(true);
  const [gameVersion, setGameVersion] = useState<string>("");
  const [amiiboScope, setAmiiboScope] = useState<AmiiboScope>("trained");
  const [latestOnly, setLatestOnly] = useState(true);

  const recordId = ref_?.settings?.recordFormatIds[mode];
  const formats = ref_?.formats.filter(f => !f.isArchived) ?? [];
  const format = (ref_ && ref_.formatById.get(formatChoice)) ?? (recordId ? ref_?.formatById.get(recordId) : undefined) ?? formats[0];
  const minSample = ref_?.settings?.minSample ?? 5;

  const result = useMemo(() => {
    if (!ref_ || !core.data || !format) return null;
    const rows = core.data.get(format.id) ?? [];
    const filter = { includeLegendaries: legendaries, latestVersionOnly: latestOnly, gameVersion: gameVersion || undefined, ...scopeFilter(amiiboScope, ref_.profiles) };
    const { obs, skippedUntimed } = buildObservations(rows, { ...filter, riderKey: scope === "profiles" ? "profile" : "rider" }, ref_);
    // A run is one amiibo, so run plans are always per amiibo.
    const profileObs = scope === "profiles" ? obs : buildObservations(rows, { ...filter, riderKey: "profile" }, ref_).obs;
    const stageIds = format.runStructure.kind === "course_set"
      ? format.runStructure.stageIds
      : ref_.stages.filter(s => !s.isArchived).map(s => s.id);
    const withData = new Set(obs.map(o => o.rider));
    const riders = scope === "profiles"
      ? ref_.profiles.filter(p => p.status === "active" || withData.has(p.id)).map(p => p.id)
      : ref_.riders.map(r => r.id);
    const machines = ref_.machines.filter(m => legendaries || !m.isLegendary).map(m => m.id);
    const recs = buildStageRecommendations(obs, stageIds, riders, machines, minSample);
    const profilesWithData = new Set(profileObs.map(o => o.rider));
    const plans = format.runStructure.kind === "course_set"
      ? buildRunPlans(profileObs, stageIds, [...profilesWithData], machines, minSample, format.runStructure.machineMayChange)
      : null;
    return { recs, plans, obsCount: obs.length, skippedUntimed };
  }, [ref_, core.data, format, scope, legendaries, latestOnly, minSample, gameVersion, amiiboScope]);

  const versions = format && core.data ? gameVersionsIn(core.data.get(format.id) ?? []) : [];

  if (error || core.error) return <Notice tone="bad" title="Couldn't load recommendations">{(error ?? core.error)?.message}</Notice>;
  if (loading || core.loading || !ref_ || !core.data) return <Spinner />;

  const counts = result ? {
    settled: result.recs.filter(r => r.status === "settled").length,
    likely: result.recs.filter(r => r.status === "likely").length,
    needs: result.recs.filter(r => r.status === "needs_data").length,
  } : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{modeLabel(mode)} recommendations</h1>
        <p className="mt-1 max-w-3xl text-night-300">
          The best rider + machine for every stage, based on what you've measured. Untested combos are predicted from everything else
          you've logged, and listed under "Test next" when they might beat the current pick. Predictions are never shown as the answer.
        </p>
      </div>

      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Format</span>
            <Select aria-label="Format" className="w-auto min-w-64" value={format?.id ?? ""} onChange={e => setFormatChoice(e.target.value)}>
              {formats.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === recordId ? " ★ (record format)" : ""}</option>)}
            </Select>
          </label>
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
        <Segmented label="Recommend" value={scope} onChange={setScope}
          options={[{ value: "profiles", label: "Your amiibo" }, { value: "riders", label: "Characters" }]} />
      </Card>

      {!recordId && <Notice title={`No ${modeLabel(mode)} record format set`}>Mark one on the <Link to="formats" className="font-semibold text-air-400 underline">Formats</Link> page to make it the default here.</Notice>}

      {!format ? (
        <Notice title={`No ${modeLabel(mode)} formats`} />
      ) : !result || result.obsCount === 0 ? (
        <Notice title="No timed results yet">
          Recommendations come from finish times logged in "{format.name}".
          <div className="mt-3"><Button variant="primary" onClick={() => navigate(format.runStructure.kind === "course_set" ? "runs" : "log")}>{format.runStructure.kind === "course_set" ? "Start a run" : "Log races"}</Button></div>
        </Notice>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="ok">{counts?.settled} settled</Badge>
            <Badge tone="star">{counts?.likely} likely</Badge>
            <Badge>{counts?.needs} need data</Badge>
            <span className="text-night-400">from {result.obsCount} timed results{result.skippedUntimed ? ` (${result.skippedUntimed} untimed not used)` : ""}. A combo counts as measured after {minSample} races.</span>
          </div>

          {result.plans && (
            <Card>
              <CardHeader
                title="Run planner"
                subtitle={format.runStructure.kind === "course_set" && format.runStructure.machineMayChange
                  ? "For each amiibo: the best machine on every course, and the total you can expect. ★ = the best fully measured plan."
                  : "For each amiibo: the best single machine for the whole run, and the total you can expect."}
              />
              <RunPlans plans={result.plans} scope="profiles" ref_={ref_} format={format} />
            </Card>
          )}

          <Card>
            <CardHeader title="Best combo per stage" subtitle={`Expected time is the average of your measured races (± is its 95% range). ${scope === "profiles" ? "Your amiibo" : "Characters"} only.`} />
            <StageTable recs={result.recs} scope={scope} ref_={ref_} />
          </Card>

          <Card>
            <CardHeader title="Test next" subtitle="The races most likely to change a recommendation, biggest possible gain first." />
            <TestNext recs={result.recs} scope={scope} ref_={ref_} minSample={minSample} />
          </Card>
        </>
      )}
    </div>
  );
}
