// Small City Trial building blocks shared by the log forms and tables.

import { useState } from "react";
import { CT_MACHINES, CT_MACHINE_BY_ID, STADIUMS, STADIUM_BY_ID, STADIUM_TYPES, formatYards, ordinal, parseYards } from "../../domain/cityTrial";
import type { CtFormat, CtScores, Stadium } from "../../domain/cityTrial";
import { formatGameTime } from "../../domain/schema";
import type { ID } from "../../domain/schema";
import type { Reference } from "../../hooks/useReference";
import { NumberInput, Select, TextInput, TimeInput } from "../../components/form";
import { cx } from "../../components/ui";

/** Stadium picker grouped by type. Banned stadiums are left out; types played this set are greyed out. */
export function StadiumSelect({ id, value, onChange, format, playedTypes = [], allowNone = true, ariaLabel }: {
  id?: string; value: string | null; onChange: (v: string | null) => void; format?: CtFormat;
  playedTypes?: string[]; allowNone?: boolean; ariaLabel?: string;
}) {
  const banned = new Set(format?.bannedStadiumIds ?? []);
  return (
    <Select id={id} aria-label={ariaLabel} value={value ?? ""} onChange={e => onChange(e.target.value || null)}>
      {allowNone && <option value="">Not noted</option>}
      {STADIUM_TYPES.map(type => {
        const list = STADIUMS.filter(s => s.type === type && (!banned.has(s.id) || s.id === value));
        if (!list.length) return null;
        const played = playedTypes.includes(type);
        return (
          <optgroup key={type} label={played ? `${type} (already played this set)` : type}>
            {list.map(s => <option key={s.id} value={s.id} disabled={played && s.id !== value}>{s.name}</option>)}
          </optgroup>
        );
      })}
    </Select>
  );
}

export function PlaceSelect({ value, onChange, size, ariaLabel }: { value: number | null; onChange: (v: number | null) => void; size: number; ariaLabel: string }) {
  return (
    <Select aria-label={ariaLabel} value={value ?? ""} onChange={e => onChange(e.target.value ? Number(e.target.value) : null)} className="w-24">
      <option value="">—</option>
      {Array.from({ length: Math.max(1, size) }, (_, i) => i + 1).map(p => <option key={p} value={p}>{ordinal(p)}</option>)}
    </Select>
  );
}

export function MachineSelect({ value, onChange, ariaLabel, legendaries = true }: { value: string; onChange: (v: string) => void; ariaLabel: string; legendaries?: boolean }) {
  return (
    <Select aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Not noted</option>
      <optgroup label="Machines">{CT_MACHINES.filter(m => !m.isLegendary).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
      {(legendaries || CT_MACHINES.some(m => m.isLegendary && m.id === value)) && (
        <optgroup label="Legendary">{CT_MACHINES.filter(m => m.isLegendary).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
      )}
    </Select>
  );
}

export const machineName = (id: string | undefined) => (id ? CT_MACHINE_BY_ID.get(id)?.name ?? "?" : "—");

/** Yards box: accepts "1834.67" or "1,834.67". */
export function YardsInput({ value, onChange, ariaLabel }: { value: number | undefined; onChange: (v: number | undefined) => void; ariaLabel: string }) {
  const [text, setText] = useState(value === undefined ? "" : formatYards(value));
  const parsed = parseYards(text);
  const bad = text.trim() !== "" && parsed === null;
  return (
    <div>
      <TextInput
        aria-label={ariaLabel}
        inputMode="decimal"
        placeholder="1,834.67"
        value={text}
        aria-invalid={bad}
        className={cx("tabular", bad && "border-bad-400")}
        onChange={e => { setText(e.target.value); const v = parseYards(e.target.value); onChange(v ?? undefined); }}
        onBlur={() => { if (parsed !== null) setText(formatYards(parsed)); }}
      />
      {bad && <p className="mt-1 text-xs text-bad-400">Use yards like 1,834.67</p>}
    </div>
  );
}

/** One input per score the stadium records (time, points/damage, distance). */
export function ScoreInputs({ stadium, value, onChange, who }: { stadium: Stadium; value: CtScores; onChange: (v: CtScores) => void; who: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {stadium.scores.map(score => (
        <label key={score.label} className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-night-300">{score.label}</span>
          {score.kind === "time" ? (
            <TimeInput ariaLabel={`${who} ${score.label}`} value={value.timeMs ?? null} onChange={ms => onChange({ ...value, timeMs: ms ?? undefined })} />
          ) : score.kind === "points" ? (
            <NumberInput aria-label={`${who} ${score.label}`} value={value.points ?? null} onChange={v => onChange({ ...value, points: v ?? undefined })} />
          ) : (
            <YardsInput ariaLabel={`${who} ${score.label}`} value={value.distance} onChange={v => onChange({ ...value, distance: v })} />
          )}
        </label>
      ))}
    </div>
  );
}

/** A score in its own units: 01:25.72, 1,834.67 yd, 120 pts. */
export function fmtScore(kind: "time" | "points" | "distance", v: number, label = "pts"): string {
  if (kind === "time") return formatGameTime(v);
  if (kind === "distance") return `${formatYards(v)} yd`;
  return `${v.toLocaleString()} ${label === "Damage" ? "dmg" : "pts"}`;
}

/** Scores an entry has, in the stadium's units, joined for a table cell. */
export function scoresText(stadiumId: string | null | undefined, s: CtScores | undefined): string {
  const stadium = stadiumId ? STADIUM_BY_ID.get(stadiumId) : undefined;
  if (!stadium || !s) return "";
  return stadium.scores.map(sc => {
    const v = sc.kind === "time" ? s.timeMs : sc.kind === "points" ? s.points : s.distance;
    return typeof v === "number" ? fmtScore(sc.kind, v, sc.label) : null;
  }).filter(Boolean).join(" · ");
}

/** Toggle buttons for picking which amiibo took part. */
export function AmiiboPicker({ ref_, picked, onChange, max }: { ref_: Reference; picked: ID[]; onChange: (ids: ID[]) => void; max: number }) {
  const active = ref_.profiles.filter(p => p.status === "active");
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Amiibo in this match">
      {active.map(p => {
        const on = picked.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            disabled={!on && picked.length >= max}
            onClick={() => onChange(on ? picked.filter(x => x !== p.id) : [...picked, p.id])}
            className={cx(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              on ? "border-air-400/70 bg-air-500/15 text-air-400" : "border-night-600 text-night-300 hover:border-night-400 hover:text-night-100",
            )}
          >
            {p.nickname}
            <span className="ml-1 text-xs text-night-400">{ref_.riderById.get(p.riderId)?.name.replace(/^Kirby \((.+)\)$/, "Kirby $1")}</span>
          </button>
        );
      })}
    </div>
  );
}

/** "62%" with an optional ± range. */
export function pct(v: number | null | undefined, digits = 0): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function rulesLine(f: CtFormat): string {
  const parts = [
    `${f.minutes} min`, f.gameTempo === "slow" ? "slow tempo" : null,
    f.stadiumVote ? "stadium vote" : "blind stadium",
    f.legendaries ? "legendaries on" : "legendaries off",
    f.fieldEvents ? null : "field events off", f.fieldChange ? null : "field change off",
    f.bannedStadiumIds.length ? `${f.bannedStadiumIds.length} stadium${f.bannedStadiumIds.length === 1 ? "" : "s"} off` : "all stadiums",
    f.pointsTable ? `points ${f.pointsTable.join("/")}` : null,
    f.set ? `sets of ${f.set.rounds}, top ${f.set.advance} advance` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
