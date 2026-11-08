// Plain-text summaries for sharing ("Copy summary"): a course, a
// character, a machine or an amiibo, within one format.

import { formatGameTime } from "./schema";
import type { Format, ID, Millis } from "./schema";
import { groupRows, stageMedians, summarize } from "./insights";
import type { ResultRow } from "./insights";

export type SummaryKind = "stage" | "rider" | "machine" | "profile";

interface Names {
  stage: (id: ID) => string;
  rider: (id: ID) => string;
  machine: (id: ID) => string;
  amiibo: (id: ID) => string;
  stageOrder: (id: ID) => number;
}

const finished = (r: ResultRow) => r.entry.status === "finished" && r.entry.finishTimeMs !== null;
const t = (r: ResultRow) => r.entry.finishTimeMs as Millis;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(1)}%`);
const amiiboOf = (r: ResultRow) => (r.entry.racer.kind === "amiibo" ? r.entry.racer.profileId : "");

/**
 * `rows`: the subject's counted rows in `format`; `allRows`: everyone's
 * (for pace vs the field).
 */
export function buildSummary(opts: {
  kind: SummaryKind; title: string; subtitle?: string; format: Format;
  rows: ResultRow[]; allRows: ResultRow[]; names: Names; notes?: string;
}): string {
  const { kind, title, subtitle, format, rows, allRows, names, notes } = opts;
  const timed = rows.filter(finished);
  const versions = [...new Set(rows.map(r => r.race.gameVersion).filter(Boolean))].sort();
  const lines: string[] = [];
  lines.push(`${title} · ${format.name}`);
  if (subtitle) lines.push(subtitle);
  lines.push(`${timed.length} timed race${timed.length === 1 ? "" : "s"}${versions.length ? ` · game Ver. ${versions.join(", ")}` : ""}`);
  lines.push("");

  const medians = stageMedians(allRows);
  const fmtGroup = (keyOf: (r: ResultRow) => string, label: (k: string) => string, useTimes: boolean) =>
    [...groupRows(timed, keyOf)]
      .map(([k, list]) => ({ k, n: list.length, med: median(list.map(t)), pace: summarize(k, list, medians).pacePct }))
      .sort((a, b) => (useTimes ? a.med - b.med : (a.pace ?? 99) - (b.pace ?? 99)))
      .map((g, i) => `  ${i + 1}. ${label(g.k)}: ${useTimes ? `median ${formatGameTime(g.med)}` : `${pct(g.pace)} vs field`} (${g.n})`);

  if (kind === "stage") {
    const best = [...timed].sort((a, b) => t(a) - t(b))[0];
    if (best) {
      lines.push(`Best ever: ${formatGameTime(t(best))} by ${names.amiibo(amiiboOf(best))} on ${names.machine(best.entry.machineId)} (${new Date(best.race.racedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })})`);
      lines.push(`Median: ${formatGameTime(median(timed.map(t)))}`);
      lines.push("");
      lines.push("Machines (fastest median first):", ...fmtGroup(r => r.entry.machineId, names.machine, true));
      lines.push("Characters (fastest median first):", ...fmtGroup(r => r.entry.riderId, names.rider, true));
    }
  } else {
    const overall = summarize("all", rows, medians);
    lines.push(`Pace vs field: ${pct(overall.pacePct)} (average gap to each course's median time; − = faster)`);
    lines.push("");
    if (kind === "machine") lines.push("By character:", ...fmtGroup(r => r.entry.riderId, names.rider, false));
    else lines.push("By machine:", ...fmtGroup(r => r.entry.machineId, names.machine, false));
    // Best time on each course.
    const bests = [...groupRows(timed, r => r.race.stageId)]
      .map(([stageId, list]) => ({ stageId, best: [...list].sort((a, b) => t(a) - t(b))[0] }))
      .sort((a, b) => names.stageOrder(a.stageId) - names.stageOrder(b.stageId));
    if (bests.length) {
      lines.push("Best time per course:");
      for (const { stageId, best } of bests) {
        const with_ = kind === "machine" ? names.amiibo(amiiboOf(best)) : kind === "rider" ? `${names.amiibo(amiiboOf(best))}, ${names.machine(best.entry.machineId)}` : names.machine(best.entry.machineId);
        lines.push(`  ${names.stage(stageId)}: ${formatGameTime(t(best))} (${with_})`);
      }
    }
  }
  if (notes?.trim()) { lines.push("", "Notes:", notes.trim()); }
  lines.push("", `From my Kirby Air Riders amiibo tracker, ${new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`);
  return lines.join("\n");
}
