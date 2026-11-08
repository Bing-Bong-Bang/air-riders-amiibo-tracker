// City Trial overview: who collects the most, who places best, and how
// they do by stadium type. Built to be honest about how random City
// Trial is: every number shows how many matches are behind it.

import { useState } from "react";
import { STADIUM_BY_ID, STADIUM_TYPES, ctAmiiboRows, ctHeadToHead } from "../../domain/cityTrial";
import type { CtAmiiboRow, CtFormat, CtMatch } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import type { Reference } from "../../hooks/useReference";
import { navigate } from "../../lib/router";
import { Checkbox, Field, Segmented, Select } from "../../components/form";
import { Badge, Button, Card, CardHeader, Notice, StatTile, cx } from "../../components/ui";
import { machineName, pct, rulesLine } from "./bits";
import type { CtData } from "./data";
import { busiestFormat } from "./data";

type SortKey = "beat" | "stats" | "avgPlace" | "wins" | "matches" | "points" | "kos";

/** The main per-amiibo table. Used by the overview and by session pages. */
export function AmiiboTable({ ref_, matches, format, minSample }: { ref_: Reference; matches: CtMatch[]; format: CtFormat | undefined; minSample: number }) {
  const [sort, setSort] = useState<SortKey>("beat");
  const rows = ctAmiiboRows(matches, format);
  const hasPoints = !!format?.pointsTable && rows.some(r => r.points);
  const hasKos = rows.some(r => r.kos);
  const val = (r: CtAmiiboRow): number => {
    switch (sort) {
      case "beat": return r.beat?.mean ?? -1;
      case "stats": return r.stats?.mean ?? -999;
      case "avgPlace": return -(r.avgPlace ?? 99);
      case "wins": return r.wins;
      case "matches": return r.matches;
      case "points": return r.points?.mean ?? -1;
      case "kos": return r.kos?.mean ?? -1;
    }
  };
  rows.sort((a, b) => val(b) - val(a));
  if (!rows.length) return <Notice title="No matches yet">Log a match and the table fills in.</Notice>;

  const head = (key: SortKey, label: string, title?: string) => (
    <th scope="col" className="px-2 py-2 text-right font-semibold" title={title}>
      <button type="button" onClick={() => setSort(key)} className={cx("hover:text-night-100", sort === key ? "text-air-400" : "text-night-300")}>
        {label}{sort === key ? " ↓" : ""}
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead className="border-b border-night-700 text-xs uppercase tracking-wider">
          <tr>
            <th scope="col" className="px-2 py-2 text-left font-semibold text-night-300">Amiibo</th>
            {head("matches", "Matches")}
            {head("wins", "Wins")}
            {head("avgPlace", "Avg place", "Average finishing place (lower is better). Depends on how many rode.")}
            {head("beat", "Finish score", "Share of the other riders in its stadium it finished ahead of. Ties count half. Fair across any number of riders.")}
            {head("stats", "Stat total", "Average stat total at the end of the trial, ± how far the true average could be off.")}
            {hasPoints && head("points", "Points", "Average points per round under this format's points table")}
            {hasKos && head("kos", "KOs")}
            <th scope="col" className="px-2 py-2 text-left font-semibold text-night-300">Usual machine</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const p = ref_.profileById.get(r.profileId);
            const few = r.matches < minSample;
            return (
              <tr key={r.profileId} className="border-b border-night-800 last:border-0">
                <td className="px-2 py-2">
                  <span className="font-semibold">{p?.nickname ?? "?"}</span>
                  {p?.isBaseline && <span className="ml-1.5"><Badge tone="star">Baseline</Badge></span>}
                  {few && <span className="ml-1.5 text-xs text-night-400">few matches</span>}
                </td>
                <td className="px-2 py-2 text-right tabular">{r.matches}</td>
                <td className="px-2 py-2 text-right tabular">{r.wins}{r.placed ? <span className="text-xs text-night-400"> ({pct(r.wins / r.placed)})</span> : null}</td>
                <td className="px-2 py-2 text-right tabular">{r.avgPlace === null ? "—" : r.avgPlace.toFixed(1)}</td>
                <td className="px-2 py-2 text-right tabular">
                  {pct(r.beat?.mean)}
                  {r.beat?.half != null && r.beat.n >= 3 && <span className="ml-1 text-xs text-night-400">±{Math.min(100, Math.round(r.beat.half * 100))}</span>}
                </td>
                <td className="px-2 py-2 text-right tabular">
                  {r.stats ? r.stats.mean.toFixed(1) : "—"}
                  {r.stats?.half != null && r.stats.n >= 3 && <span className="ml-1 text-xs text-night-400">±{r.stats.half.toFixed(1)}</span>}
                  {r.stats && <div className="text-xs text-night-400">best {r.stats.best} · {r.stats.n} logged</div>}
                </td>
                {hasPoints && <td className="px-2 py-2 text-right tabular">{r.points ? r.points.mean.toFixed(1) : "—"}</td>}
                {hasKos && <td className="px-2 py-2 text-right tabular">{r.kos ? r.kos.mean.toFixed(1) : "—"}</td>}
                <td className="px-2 py-2 text-night-300">
                  {r.machines.length ? <>{machineName(r.machines[0][0])} <span className="text-xs text-night-400">{r.machines[0][1]}×</span></> : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Finish score by stadium type: who's good at races, at fights, at gliding. */
export function ByTypeTable({ ref_, matches, format }: { ref_: Reference; matches: CtMatch[]; format: CtFormat | undefined }) {
  const rows = ctAmiiboRows(matches, format).filter(r => r.byType.size);
  const types = STADIUM_TYPES.filter(t => rows.some(r => r.byType.has(t)));
  if (!types.length) return <p className="text-sm text-night-400">Log the stadium on a few matches to see this.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="text-sm">
        <thead className="border-b border-night-700 text-xs uppercase tracking-wider text-night-300">
          <tr>
            <th scope="col" className="px-2 py-2 text-left font-semibold">Amiibo</th>
            {types.map(t => <th key={t} scope="col" className="px-2 py-2 text-right font-semibold">{t}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.profileId} className="border-b border-night-800 last:border-0">
              <td className="px-2 py-2 font-semibold">{ref_.profileById.get(r.profileId)?.nickname ?? "?"}</td>
              {types.map(t => {
                const c = r.byType.get(t);
                return (
                  <td key={t} className="px-2 py-2 text-right tabular">
                    {c ? <>{pct(c.beat)} <span className="text-xs text-night-400">({c.n})</span></> : <span className="text-night-600">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Placed-ahead record for every pair of amiibo that shared a stadium. */
export function CtHeadToHead({ ref_, matches }: { ref_: Reference; matches: CtMatch[] }) {
  const h2h = ctHeadToHead(matches);
  const ids = [...new Set(matches.flatMap(m => m.entries.map(e => e.profileId)))]
    .sort((a, b) => (ref_.profileById.get(a)?.nickname ?? "").localeCompare(ref_.profileById.get(b)?.nickname ?? ""));
  if (h2h.size === 0) return <p className="text-sm text-night-400">Needs matches with two or more of your amiibo placed.</p>;
  const name = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";
  return (
    <div className="overflow-x-auto">
      <table className="text-sm" aria-label="City Trial head to head">
        <thead className="text-xs text-night-300">
          <tr>
            <th scope="col" className="px-2 py-2 text-left font-semibold">Ahead–behind vs →</th>
            {ids.map(id => <th key={id} scope="col" className="px-2 py-2 text-center font-semibold">{name(id)}</th>)}
          </tr>
        </thead>
        <tbody>
          {ids.map(a => (
            <tr key={a} className="border-t border-night-800">
              <th scope="row" className="px-2 py-2 text-left font-semibold">{name(a)}</th>
              {ids.map(b => {
                if (a === b) return <td key={b} className="px-2 py-2 text-center text-night-700">·</td>;
                const r = h2h.get(`${a}|${b}`);
                if (!r) return <td key={b} className="px-2 py-2 text-center text-night-600">—</td>;
                const tone = r.ahead > r.behind ? "text-ok-400" : r.ahead < r.behind ? "text-bad-400" : "text-night-300";
                return (
                  <td key={b} className={cx("px-2 py-2 text-center tabular", tone)} title={r.level ? `${r.level} tied` : undefined}>
                    {r.ahead}–{r.behind}{r.level ? <span className="text-xs text-night-400"> ({r.level}=)</span> : null}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview({ ref_, data }: { ref_: Reference; data: CtData }) {
  const [formatId, setFormatId] = useState<ID>(() => busiestFormat(data)?.id ?? "");
  const [countedOnly, setCountedOnly] = useState(true);
  const [view, setView] = useState<"table" | "types" | "h2h">("table");
  const format = data.formatById.get(formatId);
  const matches = data.matches.filter(m => m.formatId === formatId && (!countedOnly || m.includeInStats));
  const minSample = ref_.settings?.minSample ?? 5;
  const withStats = matches.filter(m => m.entries.some(e => typeof e.statTotal === "number")).length;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Format" htmlFor="ct-ov-format" className="min-w-64">
            <Select id="ct-ov-format" value={formatId} onChange={e => setFormatId(e.target.value)}>
              {data.formats.map(f => (
                <option key={f.id} value={f.id}>{f.name} ({data.matches.filter(m => m.formatId === f.id).length} matches)</option>
              ))}
            </Select>
          </Field>
          <Checkbox checked={countedOnly} onChange={setCountedOnly} label="Only matches that count in records" />
          <div className="ml-auto"><Button variant="primary" onClick={() => navigate("city", { tab: "log" })}>Log a match</Button></div>
        </div>
        {format && <p className="mt-3 text-sm text-night-400">{rulesLine(format)}</p>}
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Matches" value={matches.length} hint={`${new Set(matches.flatMap(m => m.entries.map(e => e.profileId))).size} amiibo`} />
        <StatTile label="With stat totals" value={withStats} hint="The steadiest measure here" />
        <StatTile
          label="Stadium types seen"
          value={`${new Set(matches.map(m => STADIUM_BY_ID.get(m.stadiumId ?? "")?.type).filter(Boolean)).size} of ${STADIUM_TYPES.length}`}
          hint={`${new Set(matches.map(m => m.stadiumId).filter(Boolean)).size} different stadiums`}
        />
      </div>

      <Card>
        <CardHeader
          title="Your amiibo in City Trial"
          subtitle="Finish score = share of the other riders in its stadium it finished ahead of, so 4-rider and 8-rider matches compare fairly. Stat totals are settled before the stadium, so they're the steadiest measure of collecting skill. The Rankings tab ranks them and shows how sure the order is."
          action={<Segmented label="View" value={view} onChange={setView} options={[{ value: "table", label: "Summary" }, { value: "types", label: "By stadium type" }, { value: "h2h", label: "Head to head" }]} />}
        />
        {view === "table" && <AmiiboTable ref_={ref_} matches={matches} format={format} minSample={minSample} />}
        {view === "types" && <ByTypeTable ref_={ref_} matches={matches} format={format} />}
        {view === "h2h" && <CtHeadToHead ref_={ref_} matches={matches} />}
      </Card>

      <Notice title="How much to trust this">
        City Trial is very random: the stadium, your machine when it starts, and field events can decide a match. Placements need many more
        matches than race times to settle, so treat them as tendencies. Stat totals firm up faster. Results from the Stadium menu
        (Records tab) are the most measurable of all, like a time trial.
      </Notice>
    </div>
  );
}
