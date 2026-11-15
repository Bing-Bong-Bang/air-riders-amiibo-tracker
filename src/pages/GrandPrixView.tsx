// Rankings → Grand Prix: each amiibo + machine ranked by the points it can
// expect over a Grand Prix, with Legendary machines (Dragoon, Hydra) and
// regular machines in separate tables, like tournament pools.

import { FINAL_MIN_RACES, grandPrixTable } from "../domain/grandPrix";
import type { GpRow } from "../domain/grandPrix";
import type { Format } from "../domain/schema";
import type { ResultRow } from "../domain/insights";
import type { Reference } from "../hooks/useReference";
import { Link } from "../lib/router";
import { Badge, Card, CardHeader, Notice, cx } from "../components/ui";

const CONF: Record<GpRow["confidence"], { label: string; tone: "ok" | "star" | "neutral"; title: string }> = {
  high: { label: "Solid", tone: "ok", title: "Held this rank in almost every reshuffle" },
  medium: { label: "Could move", tone: "star", title: "Swaps places with its neighbours in some reshuffles" },
  low: { label: "Few races", tone: "neutral", title: "Below the minimum race count; treat as a hint" },
};

const pctText = (x: number) => `${Math.round(x * 100)}%`;
const ordinal = (n: number) => `${n}${["st", "nd", "rd"][n - 1] ?? "th"}`;

function PoolTable({ title, subtitle, rows, ref_, format }: { title: string; subtitle: string; rows: GpRow[]; ref_: Reference; format: Format }) {
  const gp = format.grandPrix;
  const unit = gp ? "GP points" : "Points per race";
  const digits = gp ? 0 : 1;
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      {rows.length === 0 ? (
        <p className="text-sm text-night-400">No placed races in this pool yet.</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
                <th className="py-2 pr-3 font-medium" title="Rank by expected points, and the range it lands in across reshuffles of your races">Rank</th>
                <th className="py-2 pr-3 font-medium">Amiibo</th>
                <th className="px-2 py-2 text-right font-medium" title={gp ? `Expected total over a ${gp.races}-race Grand Prix, with the likely range underneath` : "Average points per race, with the likely range underneath"}>{unit}</th>
                {gp && <th className="px-2 py-2 text-right font-medium" title="Average points per race on any course">Per race</th>}
                {gp?.finalStageIds?.length ? <th className="px-2 py-2 text-right font-medium" title={`Average points per race on the final courses (before the ×${gp.finalMultiplier}). Used for the final once there are ${FINAL_MIN_RACES}+ races there.`}>On finals</th> : null}
                <th className="px-2 py-2 text-right font-medium">Wins</th>
                <th className="px-2 py-2 text-right font-medium" title="Average finishing place (lower is better)">Avg place</th>
                <th className="px-2 py-2 text-right font-medium">Retired</th>
                <th className="px-2 py-2 text-right font-medium">Races</th>
                <th className="py-2 pl-2 text-right font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night-800">
              {rows.map(r => {
                const p = ref_.profileById.get(r.profileId);
                const rider = p ? ref_.riderById.get(p.riderId) : undefined;
                const machine = ref_.machineById.get(r.machineId);
                const conf = CONF[r.confidence];
                const finalUsed = r.finalAvg !== null && r.finalRaces >= FINAL_MIN_RACES;
                return (
                  <tr key={r.key} className={cx(r.confidence === "low" && "text-night-300")}>
                    <td className="py-2.5 pr-3 tabular">
                      <span className="font-display text-base font-bold text-night-100">{r.rank}</span>
                      {r.rankLow !== r.rankHigh && <span className="ml-1.5 text-xs text-night-400">({r.rankLow}–{r.rankHigh})</span>}
                    </td>
                    <td className="py-2.5 pr-3">
                      {p ? <Link to="stats" params={{ profile: p.id }} className="font-medium hover:text-air-400">{p.nickname}</Link> : <span className="font-medium">?</span>}
                      <div className="text-xs text-night-400">{rider?.name ?? "?"} · {machine?.name ?? "?"}</div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular">
                      <div className="font-semibold text-night-100">{r.score.toFixed(digits)}</div>
                      {r.races >= 3 && r.scoreLow.toFixed(digits) !== r.scoreHigh.toFixed(digits) && <div className="text-xs text-night-400">{r.scoreLow.toFixed(digits)}–{r.scoreHigh.toFixed(digits)}</div>}
                    </td>
                    {gp && <td className="px-2 py-2.5 text-right tabular">{r.avgPoints.toFixed(1)}</td>}
                    {gp?.finalStageIds?.length ? (
                      <td className="px-2 py-2.5 text-right tabular" title={finalUsed ? "Used for the final race" : `Only ${r.finalRaces} race${r.finalRaces === 1 ? "" : "s"} there; the final uses its overall average until ${FINAL_MIN_RACES}`}>
                        {r.finalAvg === null ? "—" : <span className={finalUsed ? "" : "text-night-400"}>{r.finalAvg.toFixed(1)}</span>}
                        <div className="text-xs text-night-400">{r.finalRaces} race{r.finalRaces === 1 ? "" : "s"}</div>
                      </td>
                    ) : null}
                    <td className="px-2 py-2.5 text-right tabular">{pctText(r.winRate)}</td>
                    <td className="px-2 py-2.5 text-right tabular">{r.avgPlace.toFixed(2)}</td>
                    <td className="px-2 py-2.5 text-right tabular">{pctText(r.retireRate)}</td>
                    <td className="px-2 py-2.5 text-right tabular">{r.races}</td>
                    <td className="py-2.5 pl-2 text-right"><span title={conf.title}><Badge tone={conf.tone}>{conf.label}</Badge></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function GrandPrixView({ format, ref_, rows, minSample }: { format: Format; ref_: Reference; rows: ResultRow[]; minSample: number }) {
  const table = format.pointsTable;
  if (!table?.length) {
    return (
      <Notice title="Add points to this format first">
        Grand Prix rankings use the points each place earns. Open <Link to="formats" className="font-semibold text-air-400 underline">Formats</Link>,
        edit "{format.name}" and fill in <em>Points per place</em> (and the Grand Prix settings). You can do that even after it has races.
      </Notice>
    );
  }
  const gp = format.grandPrix;
  const legendary = (r: ResultRow) => !!ref_.machineById.get(r.entry.machineId)?.isLegendary;
  const legRows = grandPrixTable(rows.filter(legendary), format, minSample);
  const regRows = grandPrixTable(rows.filter(r => !legendary(r)), format, minSample);
  const finals = (gp?.finalStageIds ?? []).map(id => ref_.stageById.get(id)?.name).filter(Boolean);
  const pointsText = table.map((p, i) => `${ordinal(i + 1)} ${p}`).join(" · ");
  const best = gp ? (gp.races - 1 + gp.finalMultiplier) * table[0] : table[0];

  const how = gp
    ? `A ${gp.races}-race Grand Prix: ${gp.races - 1} races plus a final worth ×${gp.finalMultiplier}${finals.length ? ` on ${finals.join(" or ")}` : ""}. Winning every race scores ${best}.`
    : "Average points per race. Add Grand Prix settings to the format to see expected Grand Prix totals.";

  return (
    <div className="space-y-6">
      <Card className="p-4 text-sm text-night-300">
        <p><strong className="text-night-100">Points:</strong> {pointsText}. A retire with no place counts as last. {how}</p>
        <p className="mt-2 text-xs text-night-400">
          Places depend on who else was in the race, so this is fairest when every setup races every other one about equally often.
          Legendary machines (Dragoon, Hydra) and regular machines are ranked separately, like tournament pools.
        </p>
      </Card>
      <PoolTable title={`Legendary machines · ${format.name}`} subtitle="Dragoon and Hydra, ranked against each other." rows={legRows} ref_={ref_} format={format} />
      <PoolTable title={`Regular machines · ${format.name}`} subtitle="Every other machine, ranked against each other." rows={regRows} ref_={ref_} format={format} />
    </div>
  );
}
