// Two extra Rankings views:
//   - CoverageMap: how many counted races each course has per character or
//     machine, so you can see what the data can and can't answer yet.
//   - HeadToHead: when two racers were in the same race, who finished ahead.

import { useState } from "react";
import type { Format, ID, PaceObservation } from "../domain/schema";
import type { ResultRow } from "../domain/insights";
import type { Reference } from "../hooks/useReference";
import { Link } from "../lib/router";
import { Segmented } from "../components/form";
import { Card, CardHeader, Notice, cx } from "../components/ui";
import { stagesFor } from "./StagePage";

// Sequential shades of one hue: none, a few, workable, solid.
const LEVELS = [
  { min: 0, label: "none", cls: "bg-night-850 text-night-600" },
  { min: 1, label: "1–4", cls: "bg-air-500/20 text-night-100" },
  { min: 5, label: "5–9", cls: "bg-air-500/45 text-night-100" },
  { min: 10, label: "10+", cls: "bg-air-500/80 text-night-950 font-semibold" },
];
const levelOf = (n: number) => [...LEVELS].reverse().find(l => n >= l.min)!;

export function CoverageMap({ format, ref_, obs }: { format: Format; ref_: Reference; obs: PaceObservation[] }) {
  const [by, setBy] = useState<"rider" | "machine">("rider");
  const stages = stagesFor(format, ref_);
  const cols = by === "rider"
    ? ref_.riders.map(r => ({ id: r.id, name: r.name, short: r.amiiboFigure === "Kirby" ? `Kirby ${r.description?.split(" ")[0] ?? ""}`.trim() : r.name }))
    : ref_.machines.map(m => ({ id: m.id, name: m.name, short: m.name.replace(/ Star$/, "") }));
  const count = new Map<string, number>();
  for (const o of obs) {
    const k = `${o.stageId}|${by === "rider" ? o.rider : o.machine}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const n = (s: ID, c: ID) => count.get(`${s}|${c}`) ?? 0;
  const cells = stages.length * cols.length;
  const solid = stages.reduce((a, s) => a + cols.filter(c => n(s.id, c.id) >= 5).length, 0);
  const empty = stages.reduce((a, s) => a + cols.filter(c => n(s.id, c.id) === 0).length, 0);

  return (
    <Card>
      <CardHeader
        title={`Coverage · ${format.name}`}
        subtitle={`Counted, timed races for each course and ${by === "rider" ? "character" : "machine"}. ${solid} of ${cells} cells have 5+ races; ${empty} have none. Click a cell to open that course.`}
        action={<Segmented label="Coverage by" value={by} onChange={setBy} options={[{ value: "rider", label: "Characters" }, { value: "machine", label: "Machines" }]} />}
      />
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[44rem] border-separate border-spacing-0.5 text-xs" aria-label="Coverage map">
          <thead>
            <tr>
              <th className="py-1 pr-2 text-left font-medium uppercase tracking-wider text-night-400">Course</th>
              {cols.map(c => <th key={c.id} title={c.name} className="px-1 py-1 text-center font-medium text-night-300"><span className="block leading-tight">{c.short}</span></th>)}
              <th className="pl-2 text-right font-medium uppercase tracking-wider text-night-400">Total</th>
            </tr>
          </thead>
          <tbody>
            {stages.map(s => {
              const total = cols.reduce((a, c) => a + n(s.id, c.id), 0);
              return (
                <tr key={s.id}>
                  <td className="whitespace-nowrap py-0.5 pr-2 text-sm"><Link to="stage" params={{ id: s.id, format: format.id }} className="hover:text-air-400">{s.name}</Link></td>
                  {cols.map(c => {
                    const v = n(s.id, c.id);
                    return (
                      <td key={c.id} className="p-0">
                        <Link to="stage" params={{ id: s.id, format: format.id }} title={`${s.name} · ${c.name}: ${v} race${v === 1 ? "" : "s"}`}
                          className={cx("block rounded-md py-1.5 text-center tabular hover:ring-1 hover:ring-night-300", levelOf(v).cls)}>
                          {v || "·"}
                        </Link>
                      </td>
                    );
                  })}
                  <td className="pl-2 text-right tabular text-night-300">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-night-400" aria-label="Legend">
        {LEVELS.map(l => <span key={l.label} className="flex items-center gap-1.5"><span className={cx("inline-block h-3 w-5 rounded", l.cls)} />{l.label}</span>)}
        <span>· 5+ races per cell is where a course's numbers start to mean something.</span>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------
// Head to head
// -------------------------------------------------------------

/** Did entry a finish ahead of entry b? null = can't tell. */
function ahead(a: ResultRow["entry"], b: ResultRow["entry"]): boolean | null {
  if (a.placement !== undefined && b.placement !== undefined) return a.placement < b.placement;
  const fa = a.status === "finished", fb = b.status === "finished";
  if (fa !== fb) return fa;
  if (fa && fb && a.finishTimeMs !== null && b.finishTimeMs !== null && a.finishTimeMs !== b.finishTimeMs) return a.finishTimeMs < b.finishTimeMs;
  return null;
}

export function HeadToHead({ format, ref_, rows }: { format: Format; ref_: Reference; rows: ResultRow[] }) {
  const [by, setBy] = useState<"rider" | "profile">("rider");
  const keyOf = (r: ResultRow) => (by === "rider" ? r.entry.riderId : r.entry.racer.kind === "amiibo" ? r.entry.racer.profileId : "");
  const nameOf = (k: string) => (by === "rider" ? ref_.riderById.get(k)?.name : ref_.profileById.get(k)?.nickname) ?? "?";

  const byRace = new Map<ID, ResultRow[]>();
  for (const r of rows) byRace.set(r.race.id, [...(byRace.get(r.race.id) ?? []), r]);
  const wins = new Map<string, number>(); // "a|b" → times a finished ahead of b
  const keys = new Set<string>();
  let shared = 0;
  for (const list of byRace.values()) {
    if (list.length < 2) continue;
    let counted = false;
    for (const x of list) for (const y of list) {
      const a = keyOf(x), b = keyOf(y);
      if (!a || !b || a === b) continue;
      const res = ahead(x.entry, y.entry);
      if (res) { wins.set(`${a}|${b}`, (wins.get(`${a}|${b}`) ?? 0) + 1); keys.add(a); keys.add(b); counted = true; }
    }
    if (counted) shared++;
  }

  const order = by === "rider" ? ref_.riders.map(r => r.id) : ref_.profiles.map(p => p.id);
  const list = order.filter(k => keys.has(k));
  const w = (a: string, b: string) => wins.get(`${a}|${b}`) ?? 0;
  const record = (k: string) => list.reduce((acc, o) => ({ w: acc.w + w(k, o), l: acc.l + w(o, k) }), { w: 0, l: 0 });
  const ranked = [...list].sort((a, b) => {
    const ra = record(a), rb = record(b);
    return rb.w / Math.max(1, rb.w + rb.l) - ra.w / Math.max(1, ra.w + ra.l);
  });

  return (
    <Card>
      <CardHeader
        title={`Head to head · ${format.name}`}
        subtitle="When two racers were in the same race, how often each finished ahead of the other. Read across a row: wins–losses against that column."
        action={<Segmented label="Head to head by" value={by} onChange={setBy} options={[{ value: "rider", label: "Characters" }, { value: "profile", label: "Your amiibo" }]} />}
      />
      {ranked.length < 2 ? (
        <Notice title="No shared races yet">
          Head to head needs races where two or more of your amiibo raced together, e.g. Default rules with several amiibo in the lineup. Solo time-attack races don't count.
        </Notice>
      ) : (
        <>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[36rem] border-separate border-spacing-0.5 text-sm" aria-label="Head to head">
              <thead>
                <tr className="text-xs text-night-400">
                  <th className="py-1 pr-2 text-left font-medium uppercase tracking-wider">vs →</th>
                  {ranked.map(k => <th key={k} className="px-1 py-1 text-center font-medium text-night-300">{nameOf(k)}</th>)}
                  <th className="pl-2 text-right font-medium uppercase tracking-wider">Overall</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(a => {
                  const rec = record(a);
                  return (
                    <tr key={a}>
                      <td className="whitespace-nowrap py-1 pr-2 font-medium">{nameOf(a)}</td>
                      {ranked.map(b => {
                        if (a === b) return <td key={b} className="rounded-md bg-night-900" />;
                        const won = w(a, b), lost = w(b, a), total = won + lost;
                        const share = total ? won / total : null;
                        return (
                          <td key={b} title={total ? `${nameOf(a)} finished ahead of ${nameOf(b)} in ${won} of ${total} shared races` : "Never raced together"}
                            className={cx("rounded-md px-1 py-1.5 text-center tabular",
                              share === null ? "bg-night-850 text-night-600" : share > 0.5 ? "bg-ok-400/25 text-night-100" : share < 0.5 ? "bg-bad-400/20 text-night-100" : "bg-night-800 text-night-100")}>
                            {total ? `${won}–${lost}` : "·"}
                          </td>
                        );
                      })}
                      <td className="pl-2 text-right tabular">{rec.w}–{rec.l} <span className="text-xs text-night-400">({Math.round((rec.w / Math.max(1, rec.w + rec.l)) * 100)}%)</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-night-400">From {shared} race{shared === 1 ? "" : "s"} with two or more of your racers. Places decide who was ahead; without places, finishing beats retiring, then the faster time wins. A few races can swing these a lot.</p>
        </>
      )}
    </Card>
  );
}
