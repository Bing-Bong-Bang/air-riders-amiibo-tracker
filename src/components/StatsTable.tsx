// Tables of GroupSummary rows, shared by trials and personal stat pages.

import { useState } from "react";
import type { ReactNode } from "react";
import { formatGameTime, formatGap } from "../domain/schema";
import type { GroupSummary } from "../domain/insights";
import { cx } from "./ui";

export const fmtPlace = (v: number | null) => (v === null ? "—" : v.toFixed(2));
export const fmtPct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
export const fmtPace = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}%`);

/** "2 (13%)": how many races it retired in, and the share. */
export const fmtRetired = (s: GroupSummary) => (s.races === 0 ? "—" : `${s.races - s.finished} (${fmtPct(s.dnfRate)})`);

/** Drop the Retired column when the format has no retirement. */
export const retiredColumnIf = (cols: ColumnKey[], show: boolean): ColumnKey[] => (show ? cols : cols.filter(c => c !== "dnf"));

export interface StatsTableRow {
  id: string;
  label: ReactNode;
  sub?: ReactNode;
  summary: GroupSummary;
}

type Column = {
  head: string;
  title?: string;
  cell: (s: GroupSummary) => ReactNode;
  best?: (s: GroupSummary) => number | null; // lower = better; highlights the best row
  /** Sort value when the heading is clicked (defaults to `best`); `bigFirst` sorts high to low first. */
  sort?: (s: GroupSummary) => number | null;
  bigFirst?: boolean;
};

const COLUMNS = {
  races: { head: "Races", cell: s => s.races, sort: s => s.races, bigFirst: true },
  wins: { head: "Wins", cell: s => s.wins, sort: s => s.wins, bigFirst: true },
  winRate: { head: "Win %", cell: s => fmtPct(s.winRate), best: s => (s.winRate === null ? null : -s.winRate) },
  avgPlace: { head: "Avg place", title: "Average finishing position (lower is better)", cell: s => fmtPlace(s.avgPlace), best: s => s.avgPlace },
  field: { head: "Field", title: "Average riders per race, CPUs included", cell: s => (s.avgFieldSize === null ? "—" : s.avgFieldSize.toFixed(1)), sort: s => s.avgFieldSize },
  pace: { head: "Pace vs field", title: "Average % vs the stage's median time. Negative = faster.", cell: s => fmtPace(s.pacePct), best: s => s.pacePct },
  best: { head: "Best", cell: s => formatGameTime(s.times?.bestMs), best: s => s.times?.bestMs ?? null },
  median: { head: "Median", cell: s => formatGameTime(s.times?.medianMs), best: s => s.times?.medianMs ?? null },
  mean: { head: "Average", cell: s => formatGameTime(s.times?.meanMs), best: s => s.times?.meanMs ?? null },
  worst: { head: "Worst", cell: s => formatGameTime(s.times?.worstMs), sort: s => s.times?.worstMs ?? null },
  spread: { head: "Spread", title: "How much times vary race to race (standard deviation). Lower = more consistent.", cell: s => (s.times?.stdDevMs == null ? "—" : `±${(s.times.stdDevMs / 1000).toFixed(2)}s`), sort: s => s.times?.stdDevMs ?? null },
  gap: { head: "Gap to 1st", cell: s => (s.avgGapMs === null ? "—" : formatGap(s.avgGapMs)), sort: s => s.avgGapMs },
  dnf: { head: "Retired", title: "Races where it retired", cell: s => fmtRetired(s), sort: s => s.dnfRate },
  meanCi: {
    head: "Average", title: "Average time, and the range the true average likely sits in (95%). Fewer races or more spread = wider range.",
    cell: s => (s.times ? <>{formatGameTime(s.times.meanMs)}{s.times.meanCiHighMs !== null && <span className="ml-1 text-xs text-night-400">±{((s.times.meanCiHighMs - s.times.meanMs) / 1000).toFixed(2)}</span>}</> : "—"),
    best: s => s.times?.meanMs ?? null,
  },
  disasters: {
    head: "Disasters", title: "Races more than 5% slower than the median (a crash, a fall, getting knocked off course)",
    cell: s => (s.times ? `${Math.round(s.times.disasterRate * s.times.n)} (${fmtPct(s.times.disasterRate)})` : "—"),
    best: s => s.times?.disasterRate ?? null,
  },
  hits: {
    head: "Hit target", title: "Races at or under your target time",
    cell: s => (s.hits && s.times ? `${s.hits.count} (${fmtPct(s.hits.count / s.times.n)})` : "—"),
    best: s => (s.hits && s.times ? -s.hits.count / s.times.n : null),
  },
} satisfies Record<string, Column>;

export type ColumnKey = keyof typeof COLUMNS;

/** Column sets: placements + pace across stages; raw times only within one stage. */
export const OVERALL_COLUMNS: ColumnKey[] = ["races", "wins", "winRate", "avgPlace", "pace", "dnf"];
export const STAGE_COLUMNS: ColumnKey[] = ["races", "wins", "avgPlace", "best", "median", "spread", "gap"];
/** Time-only series (e.g. one amiibo racing solo): no places, just times. */
export const TIME_COLUMNS: ColumnKey[] = ["races", "best", "median", "meanCi", "spread", "disasters", "hits", "dnf"];

export function StatsTable({ rows, columns, labelHead, empty = "No counted races yet.", heads = {} }: {
  rows: StatsTableRow[]; columns: ColumnKey[]; labelHead: string; empty?: string;
  /** Override a column's heading, e.g. the hit-target column naming the target. */
  heads?: Partial<Record<ColumnKey, string>>;
}) {
  const [sort, setSort] = useState<{ key: ColumnKey | "label"; dir: 1 | -1 } | null>(null);
  if (rows.length === 0) return <p className="text-sm text-night-400">{empty}</p>;
  const cols = columns.map(k => ({ ...(COLUMNS[k] as Column), key: k, head: heads[k] ?? (COLUMNS[k] as Column).head }));
  const sortOf = (c: Column) => c.sort ?? c.best;
  if (sort) {
    const c = cols.find(x => x.key === sort.key);
    const val = (r: StatsTableRow) => (sort.key === "label" ? r.label : c ? sortOf(c)?.(r.summary) ?? null : null);
    rows = [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number)) * sort.dir;
    });
  }
  const click = (key: ColumnKey | "label", bigFirst?: boolean) =>
    setSort(prev => (prev?.key === key ? (prev.dir === (bigFirst ? -1 : 1) ? { key, dir: bigFirst ? 1 : -1 } : null) : { key, dir: bigFirst ? -1 : 1 }));
  const arrow = (key: ColumnKey | "label") => (sort?.key === key ? <span aria-hidden className="ml-1">{sort.dir === 1 ? "▲" : "▼"}</span> : null);
  const bestIds = cols.map(c => {
    if (!c.best || rows.length < 2) return null;
    let bestId: string | null = null;
    let bestVal = Infinity;
    for (const r of rows) {
      const v = c.best(r.summary);
      if (v !== null && v < bestVal) { bestVal = v; bestId = r.id; }
    }
    return bestId;
  });

  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full text-sm" style={{ minWidth: `${Math.min(34, 12 + cols.length * 5.5)}rem` }}>
        <thead>
          <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
            <th className="py-2 pr-4 font-medium" aria-sort={sort?.key === "label" ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
              <button type="button" onClick={() => click("label")} className="uppercase tracking-wider hover:text-night-100">{labelHead}{arrow("label")}</button>
            </th>
            {cols.map(c => (
              <th key={c.key} title={c.title} className="px-2 py-2 text-right font-medium" aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {sortOf(c)
                  ? <button type="button" onClick={() => click(c.key, c.bigFirst)} className={cx("uppercase tracking-wider hover:text-night-100", sort?.key === c.key && "text-night-100")}>{c.head}{arrow(c.key)}</button>
                  : c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-night-800">
          {rows.map(r => (
            <tr key={r.id}>
              <td className="py-2.5 pr-4">
                <div className="font-medium">{r.label}</div>
                {r.sub && <div className="text-xs text-night-400">{r.sub}</div>}
              </td>
              {cols.map((c, i) => (
                <td key={c.head} className={cx("px-2 py-2.5 text-right tabular", bestIds[i] === r.id ? "font-semibold text-star-400" : "text-night-100")}>
                  {c.cell(r.summary)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
