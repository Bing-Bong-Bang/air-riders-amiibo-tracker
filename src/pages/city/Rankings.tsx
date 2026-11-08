// City Trial rankings: amiibo ranked by Finish score (how much of the
// field they usually finish ahead of), with how sure the order is, the
// shape of their results, and what the stats say about winning.

import { useState } from "react";
import { collectorFindings, ctRankings, stadiumName, typeExtremes } from "../../domain/cityTrial";
import type { CtRankRow } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import type { Reference } from "../../hooks/useReference";
import { Checkbox, Field, Select } from "../../components/form";
import { Badge, Card, CardHeader, Notice, cx } from "../../components/ui";
import { pct, rulesLine } from "./bits";
import type { CtData } from "./data";
import { busiestFormat } from "./data";

const CONF: Record<CtRankRow["confidence"], { label: string; tone: "ok" | "star" | "neutral"; title: string }> = {
  solid: { label: "Solid", tone: "ok", title: "This rank held in almost every reshuffled history" },
  could_move: { label: "Could move", tone: "star", title: "Neighbouring amiibo swap places in some reshuffled histories" },
  few: { label: "Few matches", tone: "neutral", title: "Below the minimum match count; treat as a hint" },
};

/** A small bar for a 0–1 share, with the likely range drawn behind it. */
function ShareBar({ value, low, high }: { value: number; low: number; high: number }) {
  return (
    <div className="relative h-2.5 w-28 rounded-full bg-night-800" aria-hidden>
      <div className="absolute inset-y-0 rounded-full bg-star-400/25" style={{ left: `${low * 100}%`, width: `${Math.max(0, high - low) * 100}%` }} />
      <div className="absolute inset-y-0 left-0 rounded-full bg-star-400" style={{ width: `${value * 100}%`, opacity: 0.85 }} />
    </div>
  );
}

export function Rankings({ ref_, data }: { ref_: Reference; data: CtData }) {
  const [formatId, setFormatId] = useState<ID>(() => busiestFormat(data)?.id ?? "");
  const [countedOnly, setCountedOnly] = useState(true);
  const [withBaseline, setWithBaseline] = useState(false);
  const format = data.formatById.get(formatId);
  const matches = data.matches.filter(m => m.formatId === formatId && (!countedOnly || m.includeInStats));
  const keep = (id: ID) => withBaseline || !ref_.profileById.get(id)?.isBaseline;
  const minSample = ref_.settings?.minSample ?? 5;
  const rows = ctRankings(matches, keep, minSample);
  const found = collectorFindings(matches, keep);
  const extremes = typeExtremes(matches, keep);
  const name = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";
  const hasBaseline = data.matches.some(m => m.entries.some(e => ref_.profileById.get(e.profileId)?.isBaseline));

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Format" htmlFor="ct-rk-format" className="min-w-64">
            <Select id="ct-rk-format" value={formatId} onChange={e => setFormatId(e.target.value)}>
              {data.formats.map(f => <option key={f.id} value={f.id}>{f.name} ({data.matches.filter(m => m.formatId === f.id).length} matches)</option>)}
            </Select>
          </Field>
          <Checkbox checked={countedOnly} onChange={setCountedOnly} label="Only matches that count in records" />
          {hasBaseline && <Checkbox checked={withBaseline} onChange={setWithBaseline} label="Include Balanced amiibo" />}
        </div>
        {format && <p className="mt-3 text-sm text-night-400">{rulesLine(format)}</p>}
      </Card>

      <Card>
        <CardHeader
          title="Rankings"
          subtitle="Ranked by Finish score: the share of the other riders in its stadium an amiibo finished ahead of, averaged over its matches. 1st of 4 beats 100%, 2nd of 4 beats 67%, ties count half. It rewards being near the top every time, not just winning."
        />
        {rows.length === 0 ? <Notice title="No placed matches yet">Log matches with places and the ranking appears.</Notice> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="border-b border-night-700 text-xs uppercase tracking-wider text-night-300">
                <tr>
                  <th className="px-2 py-2 text-left" title="Rank, and the range it could realistically be in">Rank</th>
                  <th className="px-2 py-2 text-left">Amiibo</th>
                  <th className="px-2 py-2 text-left" title="Share of the field beaten; the faint band is the likely range">Finish score</th>
                  <th className="px-2 py-2 text-right" title="Matches with a place (Finish score needs one)">Placed</th>
                  <th className="px-2 py-2 text-right">Win</th>
                  <th className="px-2 py-2 text-right" title="Finished 1st, 2nd or 3rd">Top 3</th>
                  <th className="px-2 py-2 text-right" title="Finished in the bottom half of its stadium (e.g. 3rd or 4th of 4): the bad-match rate">Bottom half</th>
                  <th className="px-2 py-2 text-right" title="Average stat total, when logged">Stats</th>
                  <th className="px-2 py-2 text-left">Confidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const p = ref_.profileById.get(r.profileId);
                  const c = CONF[r.confidence];
                  return (
                    <tr key={r.profileId} className="border-b border-night-800 last:border-0">
                      <td className="px-2 py-2 tabular">
                        <span className="font-semibold">{r.rank}</span>
                        {r.rankLow !== r.rankHigh && <span className="ml-1 text-xs text-night-400">({r.rankLow}–{r.rankHigh})</span>}
                      </td>
                      <td className="px-2 py-2">
                        <span className="font-semibold">{p?.nickname ?? "?"}</span>
                        <span className="ml-1.5 text-xs text-night-400">{ref_.riderById.get(p?.riderId ?? "")?.name}</span>
                        {p?.isBaseline && <span className="ml-1.5"><Badge tone="star">Baseline</Badge></span>}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <ShareBar value={r.finish} low={r.finishLow} high={r.finishHigh} />
                          <span className="tabular font-semibold">{pct(r.finish)}</span>
                          {r.finishHigh > r.finishLow && <span className="text-xs text-night-400 tabular">{pct(r.finishLow)}–{pct(r.finishHigh)}</span>}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right tabular" title={r.entered > r.matches ? `${r.entered - r.matches} logged without a place, so they can't count here` : undefined}>
                        {r.matches}{r.entered > r.matches && <span className="text-xs text-star-400"> of {r.entered}</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular">{pct(r.winRate)}</td>
                      <td className="px-2 py-2 text-right tabular">{pct(r.top3Rate)}</td>
                      <td className={cx("px-2 py-2 text-right tabular", r.bottomHalfRate >= 0.5 && "text-bad-400")}>{pct(r.bottomHalfRate)}</td>
                      <td className="px-2 py-2 text-right tabular">{r.stats === null ? "—" : r.stats.toFixed(1)}</td>
                      <td className="px-2 py-2"><span title={c.title}><Badge tone={c.tone}>{c.label}</Badge></span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.some(r => r.entered > r.matches) && (
          <p className="mt-3 text-sm text-star-400">
            Some matches have amiibo logged without a place, so they can't count here ("1 of 2"). If their scores were logged, open the match, press "Fill places from scores" and save.
          </p>
        )}
        <p className="mt-3 text-xs text-night-400">
          Rank (1–3) means: when the matches were reshuffled a few hundred times, this amiibo landed between 1st and 3rd in most of them.
          Placements are noisy in City Trial, so expect wide ranges until there are plenty of matches.
        </p>
      </Card>

      <Card>
        <CardHeader title="Do stats win matches?" subtitle="From matches where at least two of your amiibo had their stat total logged and one collected the most." />
        {found.decided === 0 ? (
          <p className="text-sm text-night-400">Log stat totals for two or more amiibo in the same match to see this.</p>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2 text-sm">
              <li>
                The top collector <strong>won {found.topWon} of {found.decided}</strong> matches ({pct(found.topWon / found.decided)}),
                finished top 3 in {pct(found.topTop3 / found.decided)}, and ended up in the bottom half {found.topBottom} time{found.topBottom === 1 ? "" : "s"}.
              </li>
              <li>
                {found.topWon / found.decided >= 0.6
                  ? "So far, collecting the most usually wins: the trial matters more than the stadium."
                  : found.topWon / found.decided <= 0.35
                    ? "So far, collecting the most rarely decides it: the stadium and machine matter more than the trial."
                    : "So far, collecting the most helps, but the stadium decides plenty of matches."}
                {found.decided < 10 && <span className="text-night-400"> (only {found.decided} matches: an early read)</span>}
              </li>
              <li>The lowest collector still won {found.lowWon} time{found.lowWon === 1 ? "" : "s"}; the top collector finished last {found.topLast} time{found.topLast === 1 ? "" : "s"}.</li>
              {found.upsetExample && (
                <li className="text-night-300">
                  Latest upset: {name(found.upsetExample.winner)} won {stadiumName(found.upsetExample.match.stadiumId)} while {name(found.upsetExample.topCollector)} had the most stats.
                </li>
              )}
            </ul>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead className="text-xs uppercase tracking-wider text-night-300">
                  <tr><th className="py-1.5 pr-6 text-left">Amiibo</th><th className="py-1.5 pr-6 text-right">Top collector</th><th className="py-1.5 text-right">Turned it into a win</th></tr>
                </thead>
                <tbody>
                  {[...found.perAmiibo.entries()].sort((a, b) => b[1].topCollector - a[1].topCollector).map(([id, v]) => (
                    <tr key={id} className="border-t border-night-800">
                      <td className="py-1.5 pr-6 font-semibold">{name(id)}</td>
                      <td className="py-1.5 pr-6 text-right tabular">{v.topCollector}×</td>
                      <td className="py-1.5 text-right tabular">{v.converted} of {v.topCollector} ({pct(v.converted / v.topCollector)})</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Best and worst stadium types" subtitle="Each amiibo's highest and lowest Finish score by stadium type, counting types with 2 or more matches." />
        {extremes.size === 0 ? <p className="text-sm text-night-400">Needs at least two stadium types with 2+ matches each for an amiibo.</p> : (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {[...extremes.entries()].map(([id, x]) => (
              <li key={id} className="rounded-xl bg-night-850 px-3 py-2">
                <span className="font-semibold">{name(id)}</span>
                <div className="text-night-300">
                  Best: <span className="text-ok-400">{x.best!.type}</span> {pct(x.best!.finish)} <span className="text-xs text-night-400">({x.best!.n})</span>
                  {" · "}Worst: <span className="text-bad-400">{x.worst!.type}</span> {pct(x.worst!.finish)} <span className="text-xs text-night-400">({x.worst!.n})</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

