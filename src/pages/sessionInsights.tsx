// Session analysis pieces. A session's results are grouped by "who raced
// with what": amiibo + machine. Lineups can change race to race, so groups
// come from the races themselves rather than a fixed lineup.
//   - StageInsights: under each stage's table (how sure, drift, vs records, course best).
//   - MultiCompare: any number of amiibo + machine pairs from sessions in one format, side by side.

import { useState } from "react";
import type { ReactNode } from "react";
import { getAll, getAllByIndex } from "../db/database";
import { compareSamples, detectableDifferenceMs, formatGameTime, formatGap, racesNeededPerSet } from "../domain/schema";
import type { ID, Millis, Race, Session } from "../domain/schema";
import { rowsOf } from "../domain/insights";
import type { ResultRow } from "../domain/insights";
import { useLiveQuery } from "../hooks/useLiveQuery";
import type { Reference } from "../hooks/useReference";
import { Select } from "../components/form";
import { Card, CardHeader, cx } from "../components/ui";

// -------------------------------------------------------------
// Groups
// -------------------------------------------------------------

export interface Group { id: string; profileId: ID; machineId: ID }

/**
 * A session's rows: every race in it, counted in records or not (that box
 * only decides Rankings and the rest). A racer excluded on an older race
 * (the old per-racer "count in stats" box) is still left out.
 */
export const sessionRows = (races: Race[]): ResultRow[] => rowsOf(races, (_r, e) => e.includeInStats);

export const groupKey = (r: ResultRow) => `${r.entry.racer.kind === "amiibo" ? r.entry.racer.profileId : "?"}|${r.entry.machineId}`;

export function groupsOf(rows: ResultRow[]): Group[] {
  const seen = new Map<string, Group>();
  for (const r of rows) {
    const id = groupKey(r);
    if (!seen.has(id)) {
      const [profileId, machineId] = id.split("|");
      seen.set(id, { id, profileId, machineId });
    }
  }
  return [...seen.values()];
}

export const groupName = (g: Group, ref_: Reference) => ref_.profileById.get(g.profileId)?.nickname ?? "?";
export const groupSub = (g: Group, ref_: Reference) => {
  const p = ref_.profileById.get(g.profileId);
  return `${ref_.riderById.get(p?.riderId ?? "")?.name ?? "?"} · ${ref_.machineById.get(g.machineId)?.name ?? "?"}`;
};
/** "Squeakers · Hop Star": unique within a session even when an amiibo used two machines. */
export const groupLabel = (g: Group, ref_: Reference) => `${groupName(g, ref_)} · ${ref_.machineById.get(g.machineId)?.name ?? "?"}`;

// -------------------------------------------------------------
// Small maths helpers
// -------------------------------------------------------------

const timesOf = (rows: ResultRow[]): Millis[] =>
  [...rows]
    .sort((a, b) => a.race.racedAt.localeCompare(b.race.racedAt))
    .filter(r => r.entry.status === "finished" && r.entry.finishTimeMs !== null)
    .map(r => r.entry.finishTimeMs as Millis);

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

/** "0.96s", rounded to hundredths the same way the game and formatGap round. */
const secs = (ms: number) => `${(Math.round(Math.abs(ms) / 10) / 100).toFixed(2)}s`;

/** "1.39s faster" / "0.40s slower" / "the same". */
const describeGap = (ms: number) => (Math.abs(ms) < 5 ? "the same" : `${secs(ms)} ${ms < 0 ? "faster" : "slower"}`);

/** Races per side needed to settle a gap this size, or null if the sets already have that many. */
function racesToSettle(a: number[], b: number[], diffMs: number): number | null {
  const sa = sd(a), sb = sd(b);
  if (sa === null || sb === null || Math.abs(diffMs) < 10) return null;
  const n = racesNeededPerSet(Math.sqrt((sa * sa + sb * sb) / 2), Math.abs(diffMs));
  return n > Math.max(a.length, b.length) ? n : null;
}

/**
 * The speed verdict in plain words. `diffMs` is subject − other (negative =
 * subject faster); `lowMs`..`highMs` is where the true gap likely sits.
 */
export function speedVerdict(subject: string, diffMs: number, lowMs: number, highMs: number, settle: number | null): { text: string; clear: boolean } {
  const clear = lowMs > 0 || highMs < 0;
  if (clear) {
    return {
      clear,
      text: `${subject} is ${describeGap(diffMs)} per race, and that's a real difference, not luck (the true gap is likely between ${secs(Math.min(Math.abs(lowMs), Math.abs(highMs)))} and ${secs(Math.max(Math.abs(lowMs), Math.abs(highMs)))}).`,
    };
  }
  return {
    clear,
    text: `${subject} was ${describeGap(diffMs)} here, but that could still be luck: the true gap could be anywhere from ${describeGap(lowMs)} to ${describeGap(highMs)}.`
      + (settle ? ` About ${settle} races each would settle it.` : " More races would settle it."),
  };
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="w-32 shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wider text-night-400">{label}</span>
      <span className="text-night-100">{children}</span>
    </li>
  );
}

// -------------------------------------------------------------
// Insights under a stage's table
// -------------------------------------------------------------

/** `rows`: this session's rows on the stage; `coreRows`: the format's counted records. */
export function StageInsights({ sessionId, stageId, rows, coreRows, ref_ }: {
  sessionId: ID; stageId: ID; rows: ResultRow[]; coreRows: ResultRow[]; ref_: Reference;
}) {
  const groups = groupsOf(rows)
    .map(g => ({ g, times: timesOf(rows.filter(r => groupKey(r) === g.id)) }))
    .filter(x => x.times.length > 0);
  if (!groups.length) return null;
  const many = groups.length > 1;
  const who = (g: Group) => (many ? `${groupLabel(g, ref_)}: ` : "");
  const cap = (s: string) => (many ? s : s.charAt(0).toUpperCase() + s.slice(1));

  const spreads = groups.map(x => sd(x.times)).filter((v): v is number => v !== null);
  const typicalSd = spreads.length ? median(spreads) : null;
  const n = Math.min(...groups.map(x => x.times.length));

  const onStage = coreRows.filter(r => r.race.stageId === stageId && r.entry.status === "finished" && r.entry.finishTimeMs !== null);
  const best = onStage.reduce<ResultRow | null>((b, r) => (!b || Number(r.entry.finishTimeMs) < Number(b.entry.finishTimeMs) ? r : b), null);
  const sessionBest = Math.min(...groups.flatMap(x => x.times));

  return (
    <ul className="mt-4 space-y-2 border-t border-night-800 pt-4 text-sm" aria-label="Session insights">
      {typicalSd !== null && n >= 2 && (
        <Line label="How sure">
          With a spread of ±{secs(typicalSd)}, {n} races per side can reliably spot a gap of about {secs(detectableDifferenceMs(typicalSd, n))}.
          {" "}To spot 0.50s you'd need about {racesNeededPerSet(typicalSd, 500)} per side.
        </Line>
      )}

      {groups.map(({ g, times }) => {
        if (times.length < 6) return null;
        const half = Math.floor(times.length / 2);
        const first = times.slice(0, half), second = times.slice(times.length - half);
        const c = compareSamples(first, second, "first", "second");
        if (!c) return null;
        return (
          <Line key={`drift-${g.id}`} label="Drift">
            {who(g)}{cap("first")} {half} races {formatGameTime(median(first))}, last {half} {formatGameTime(median(second))}.{" "}
            {c.isClearDifference
              ? <span className="text-star-400">It got {c.medianDiffMs > 0 ? "slower" : "faster"} as the session went on ({formatGap(c.medianDiffMs)}).</span>
              : "No real change across the session."}
          </Line>
        );
      })}

      {groups.map(({ g, times }) => {
        const rec = timesOf(onStage.filter(r => r.race.sessionId !== sessionId && groupKey(r) === g.id));
        const machine = ref_.machineById.get(g.machineId)?.name ?? "this machine";
        if (rec.length < 2 || times.length < 2) {
          return (
            <Line key={`rec-${g.id}`} label="Vs records">
              {who(g)}{rec.length ? `Only ${rec.length} other race` : "No other races"} with {groupName(g, ref_)} on {machine} here in your records, so nothing to compare yet.
            </Line>
          );
        }
        const c = compareSamples(rec, times, "rec", "session")!;
        return (
          <Line key={`rec-${g.id}`} label="Vs records">
            {who(g)}{cap("your")} other {groupName(g, ref_)} + {machine} races here: {rec.length}, median {formatGameTime(median(rec))}.{" "}
            {speedVerdict("This session", c.medianDiffMs, c.ciLowMs, c.ciHighMs, racesToSettle(rec, times, c.medianDiffMs)).text}
          </Line>
        );
      })}

      {best && (
        <Line label="Course best">
          {formatGameTime(best.entry.finishTimeMs)} by {best.entry.racer.kind === "amiibo" ? ref_.profileById.get(best.entry.racer.profileId)?.nickname : "?"} on {ref_.machineById.get(best.entry.machineId)?.name} (records).
          {" "}This session's best is {sessionBest <= (best.entry.finishTimeMs as number)
            ? <span className="font-semibold text-ok-400">{formatGameTime(sessionBest)}, a new best</span>
            : <>{formatGameTime(sessionBest)} ({formatGap(sessionBest - (best.entry.finishTimeMs as number))})</>}.
        </Line>
      )}
    </ul>
  );
}

// -------------------------------------------------------------
// Compare: two or more entries, each an amiibo + machine from a session
// -------------------------------------------------------------

/** An entry is "sessionId|profileId|machineId". */
type EntryKey = string;

interface Entry { key: EntryKey; session: Session; group: Group; rows: ResultRow[] }

/**
 * Compare any number of amiibo + machine pairs from sessions in one format, stage
 * by stage. `initial` pre-fills entries (e.g. the session you're on).
 * `onChange` lets a page keep the picks in its URL.
 */
export function MultiCompare({ formatId, ref_, initial, onChange, title = "Compare", subtitle }: {
  formatId: ID; ref_: Reference; initial: EntryKey[]; onChange?: (keys: EntryKey[]) => void; title?: string; subtitle?: string;
}) {
  const sessionsQ = useLiveQuery(
    async () => (await getAll("sessions")).filter(s => s.formatId === formatId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [formatId], ["sessions"],
  );
  const racesQ = useLiveQuery(async () => getAllByIndex("races", "formatId", formatId), [formatId], ["races"]);
  const [keys, setKeysRaw] = useState<EntryKey[]>(initial);
  const setKeys = (next: EntryKey[]) => { setKeysRaw(next); onChange?.(next); };

  const bySession = new Map<ID, Race[]>();
  for (const r of racesQ.data ?? []) if (r.sessionId) bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
  const options = (sessionsQ.data ?? []).map(s => ({ s, rows: sessionRows(bySession.get(s.id) ?? []) }))
    .map(x => ({ ...x, groups: groupsOf(x.rows) })).filter(x => x.groups.length);
  const lbl = (g: Group) => groupLabel(g, ref_);

  const entries: Entry[] = keys.map(k => {
    const [sid, pid, mid] = k.split("|");
    const opt = options.find(o => o.s.id === sid);
    const group = opt?.groups.find(g => g.profileId === pid && g.machineId === mid);
    return opt && group ? { key: k, session: opt.s, group, rows: opt.rows.filter(r => groupKey(r) === group.id) } : null;
  }).filter((e): e is Entry => e !== null);
  // Name each entry; add the session when two entries share an amiibo + machine.
  const nameOf = (e: Entry) => {
    const clash = entries.filter(x => x.group.id === e.group.id).length > 1;
    return clash ? `${lbl(e.group)} (${e.session.name})` : lbl(e.group);
  };

  const stageIds = ref_.stages.map(s => s.id).filter(id => entries.filter(e => e.rows.some(r => r.race.stageId === id)).length >= 2);
  const threshold = ref_.formatById.get(formatId)?.disasterThresholdPct ?? 5;

  const picker = (value: EntryKey, onPick: (k: EntryKey) => void, aria: string, placeholder?: string) => (
    <Select aria-label={aria} className="w-full sm:w-[28rem]" value={value} onChange={e => onPick(e.target.value)}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(({ s, groups }) => (
        <optgroup key={s.id} label={s.name}>
          {groups.map(g => {
            const k = `${s.id}|${g.profileId}|${g.machineId}`;
            return <option key={k} value={k} disabled={k !== value && keys.includes(k)}>{s.name} — {lbl(g)}</option>;
          })}
        </optgroup>
      ))}
    </Select>
  );

  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle ?? "Put as many amiibo + machine pairs from your sessions side by side as you like. Only stages at least two of them raced are compared, since times from different courses can't be compared fairly."} />
      {options.length === 0 ? (
        <p className="text-sm text-night-400">No sessions with races in this format yet.</p>
      ) : (
        <>
          <ol className="space-y-2" aria-label="Compared">
            {keys.map((k, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-sm text-night-400">{i + 1}.</span>
                {picker(k, v => setKeys(keys.map((x, j) => (j === i ? v : x))), `Compare entry ${i + 1}`)}
                {keys.length > 1 && <button type="button" onClick={() => setKeys(keys.filter((_, j) => j !== i))} className="rounded-lg px-2 py-1 text-sm text-night-400 hover:text-bad-400" aria-label={`Remove entry ${i + 1}`}>Remove</button>}
              </li>
            ))}
            {(
              <li className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-sm text-night-400">{keys.length + 1}.</span>
                {picker("", v => v && setKeys([...keys, v]), "Add to compare", keys.length === 0 ? "Choose…" : "+ Add another…")}
              </li>
            )}
          </ol>

          {entries.length >= 2 && (
            stageIds.length === 0 ? (
              <p className="mt-4 text-sm text-night-400">None of these have raced the same stage yet.</p>
            ) : (
              <div className="mt-4 space-y-3 text-sm" data-testid="session-compare">
                {stageIds.map(id => {
                  const here = entries.filter(e => e.rows.some(r => r.race.stageId === id));
                  return (
                    <StageCompare key={id} stage={ref_.stageById.get(id)?.name ?? "?"} threshold={threshold}
                      sides={here.map(e => ({ name: nameOf(e), times: timesOf(e.rows.filter(r => r.race.stageId === id)) }))} />
                  );
                })}
                {entries.length > 2 && stageIds.length > 0 && entries.some(e => !stageIds.every(id => e.rows.some(r => r.race.stageId === id))) && (
                  <p className="text-xs text-night-400">Each stage only lists the entries that raced it.</p>
                )}
              </div>
            )
          )}
        </>
      )}
    </Card>
  );
}

/** The session page's Compare card: starts with this session's first amiibo + machine. */
export function SessionCompare({ session, races, ref_ }: { session: Session; races: Race[]; ref_: Reference }) {
  const first = groupsOf(sessionRows(races))[0];
  if (!first) return null;
  return <MultiCompare formatId={session.formatId} ref_={ref_} initial={[`${session.id}|${first.profileId}|${first.machineId}`]} />;
}

// -------------------------------------------------------------
// One stage, two or more sides: numbers side by side and plain conclusions
// -------------------------------------------------------------

/** A tiny deterministic random source, so the odds don't flicker between renders. */
function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function StageCompare({ stage, sides, threshold }: { stage: string; sides: { name: string; times: Millis[] }[]; threshold: number }) {
  const stats = sides.map(sd_ => {
    const xs = sd_.times, med = median(xs);
    return {
      name: sd_.name, times: xs, n: xs.length, best: Math.min(...xs), med,
      mean: xs.reduce((p, x) => p + x, 0) / xs.length,
      spread: sd(xs),
      disasters: xs.filter(x => x > med * (1 + threshold / 100)).length,
    };
  }).sort((a, b) => a.med - b.med);
  const leader = stats[0];
  const conclusions: { text: string; tone?: "ok" | "bad" }[] = [];

  if (stats.length === 2) {
    const [A, B] = stats;
    const c = compareSamples(B.times, A.times, "B", "A");
    if (c) {
      const v = speedVerdict(A.name, c.medianDiffMs, c.ciLowMs, c.ciHighMs, racesToSettle(A.times, B.times, c.medianDiffMs));
      conclusions.push({ text: v.text, tone: v.clear ? "ok" : undefined });
    } else conclusions.push({ text: "Needs at least 2 races on each side for a verdict." });
  } else {
    conclusions.push({ text: `Fastest typical time: ${leader.name} (median ${formatGameTime(leader.med)}).`, tone: "ok" });
    for (const o of stats.slice(1)) {
      const c = compareSamples(o.times, leader.times, "o", "lead"); // lead − o (negative: leader faster)
      if (!c) { conclusions.push({ text: `${o.name}: needs at least 2 races to compare.` }); continue; }
      const gap = -c.medianDiffMs;
      const settle = racesToSettle(leader.times, o.times, gap);
      conclusions.push({
        text: c.isClearDifference
          ? `${o.name}: ${secs(gap)} slower than ${leader.name}. That's a real difference.`
          : `${o.name}: ${secs(gap)} slower than ${leader.name}, but that could still be luck${settle ? ` (about ${settle} races each would settle it)` : ""}.`,
      });
    }
  }

  // Who wins a single race? Draw one time from each side, many times over.
  if (stats.every(x => x.n >= 3)) {
    const rnd = seeded(stats.reduce((h, x) => h * 31 + x.n + Math.round(x.med), 7));
    const wins = stats.map(() => 0), N = 4000;
    for (let k = 0; k < N; k++) {
      let bi = 0, bt = Infinity;
      stats.forEach((x, i) => { const t = x.times[Math.floor(rnd() * x.n)]; if (t < bt) { bt = t; bi = i; } });
      wins[bi]++;
    }
    const odds = stats.map((x, i) => ({ name: x.name, p: Math.round((wins[i] / N) * 100) })).sort((a, b) => b.p - a.p);
    if (stats.length === 2) {
      conclusions.push({ text: odds[0].p >= 55 ? `In a single race, ${odds[0].name} would come out ahead about ${odds[0].p}% of the time.` : "In a single race it's close to a coin flip." });
    } else {
      conclusions.push({ text: `Who'd be fastest in a single race: ${odds.map(o => `${o.name} ${o.p}%`).join(" · ")}.` });
    }
  }

  const spreads = stats.filter(x => x.spread !== null && x.n >= 4);
  if (spreads.length >= 2) {
    const sorted = [...spreads].sort((a, b) => (a.spread as number) - (b.spread as number));
    const lo = sorted[0], hi = sorted[sorted.length - 1];
    conclusions.push({
      text: Number(hi.spread) / Math.max(1, Number(lo.spread)) >= 1.4
        ? `Most consistent: ${lo.name} (±${secs(lo.spread as number)}); least: ${hi.name} (±${secs(hi.spread as number)}).`
        : `All about equally consistent (±${secs(lo.spread as number)} to ±${secs(hi.spread as number)}).`,
    });
  }

  const bestOf = [...stats].sort((a, b) => a.best - b.best);
  if (bestOf[0].best !== bestOf[1].best) {
    conclusions.push({ text: `Best single race: ${bestOf[0].name}, ${formatGameTime(bestOf[0].best)} (${secs(bestOf[1].best - bestOf[0].best)} quicker than the next best).` });
  }
  if (stats.some(x => x.disasters)) {
    conclusions.push({ text: `Disasters (races more than ${threshold}% slower than usual): ${stats.map(x => `${x.name} ${x.disasters}`).join(", ")}.` });
  }

  const bestIn = (f: (x: typeof leader) => number | null) => {
    const vals = stats.map(f).filter((v): v is number => v !== null);
    return vals.length ? Math.min(...vals) : null;
  };
  const top = { best: bestIn(x => x.best), med: bestIn(x => x.med), mean: bestIn(x => x.mean), spread: bestIn(x => x.spread) };
  const cell = (v: string, win: boolean) => <td className={cx("px-2 py-1.5 text-right font-mono tabular", win && "text-star-400")}>{v}</td>;

  return (
    <div className="rounded-xl bg-night-850 px-4 py-3" data-testid="stage-pair">
      <div className="font-semibold">{stage}</div>
      <div className="-mx-4 mt-2 overflow-x-auto px-4">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-night-400">
              <th className="py-1 pr-3 font-medium" />
              <th className="px-2 py-1 text-right font-medium">Races</th>
              <th className="px-2 py-1 text-right font-medium">Best</th>
              <th className="px-2 py-1 text-right font-medium">Median</th>
              <th className="px-2 py-1 text-right font-medium">Average</th>
              <th className="px-2 py-1 text-right font-medium" title="How much times vary race to race">Spread</th>
              <th className="py-1 pl-2 text-right font-medium" title={`Races more than ${threshold}% slower than its median`}>Disasters</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-night-800">
            {stats.map(x => (
              <tr key={x.name}>
                <td className="py-1.5 pr-3 font-medium">{x.name}</td>
                <td className="px-2 py-1.5 text-right tabular">{x.n}</td>
                {cell(formatGameTime(x.best), x.best === top.best)}
                {cell(formatGameTime(x.med), x.med === top.med)}
                {cell(formatGameTime(x.mean), x.mean === top.mean)}
                {cell(x.spread === null ? "—" : `±${secs(x.spread)}`, x.spread !== null && x.spread === top.spread)}
                <td className="py-1.5 pl-2 text-right tabular">{x.disasters}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-3 space-y-1.5" aria-label="Conclusions">
        {conclusions.map((x, i) => (
          <li key={i} className={cx("flex gap-2", x.tone === "ok" ? "text-ok-400" : x.tone === "bad" ? "text-bad-400" : "text-night-100")}>
            <span aria-hidden className="text-night-400">•</span><span>{x.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
