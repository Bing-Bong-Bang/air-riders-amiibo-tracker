// City Trial formats: the rules a set of matches is played under.
// Rules lock once a format has matches, so results never mix rule sets.

import { useState } from "react";
import type { FormEvent } from "react";
import { STADIUMS, STADIUM_TYPES } from "../../domain/cityTrial";
import type { CtFormat } from "../../domain/cityTrial";
import { saveCtFormat } from "../../db/ctRepo";
import type { CtFormatInput } from "../../db/ctRepo";
import { Checkbox, Chip, Field, NumberInput, SaveErrorNotice, Segmented, TextArea, TextInput } from "../../components/form";
import { Badge, Button, Card, CardHeader } from "../../components/ui";
import { rulesLine } from "./bits";
import type { CtData } from "./data";

type Draft = Omit<CtFormatInput, "pointsTable"> & { pointsText: string; useSets: boolean };

const blank = (): Draft => ({
  name: "", gameTempo: "normal", minutes: 5, stadiumVote: false, legendaries: true, fieldEvents: true, fieldChange: true,
  bannedStadiumIds: [], pointsText: "", useSets: false, set: { rounds: 4, advance: 2, banPlayedType: true, tiebreakerMinutes: 3 },
  description: "", isArchived: false,
});

const fromFormat = (f: CtFormat): Draft => ({
  ...f, pointsText: f.pointsTable?.join(", ") ?? "", useSets: !!f.set,
  set: f.set ?? { rounds: 4, advance: 2, banPlayedType: true, tiebreakerMinutes: 3 },
});

function FormatForm({ initial, locked, onDone }: { initial?: CtFormat; locked: boolean; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial ? fromFormat(initial) : blank());
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(x => ({ ...x, [k]: v }));
  const banned = new Set(d.bannedStadiumIds);
  const toggleIds = (ids: string[], off: boolean) => set("bannedStadiumIds", off ? [...new Set([...d.bannedStadiumIds, ...ids])] : d.bannedStadiumIds.filter(x => !ids.includes(x)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const points = d.pointsText.trim() ? d.pointsText.split(/[\s,/]+/).filter(Boolean).map(Number) : undefined;
    if (points?.some(n => !Number.isFinite(n))) { setError(new Error("Points should be numbers, like 8, 6, 4, 2.")); return; }
    if (d.useSets && !points) { setError(new Error("Sets need a points table.")); return; }
    const { pointsText: _p, useSets, ...rest } = d;
    try {
      await saveCtFormat({ ...rest, pointsTable: points, set: useSets ? d.set : undefined, id: initial?.id });
      onDone();
    } catch (err) { setError(err); }
  };

  return (
    <Card className="border-air-500/40">
      <form onSubmit={submit} className="space-y-4">
        <CardHeader title={initial ? `Edit ${initial.name}` : "New City Trial format"} subtitle={locked ? "This format has matches, so only its name and description can change." : undefined} />
        <Field label="Name" htmlFor="ctf-name"><TextInput id="ctf-name" value={d.name} onChange={e => set("name", e.target.value)} /></Field>
        <fieldset disabled={locked} className="space-y-4 disabled:opacity-60">
          <div className="flex flex-wrap items-end gap-6">
            <Field label="Game tempo"><Segmented label="Game tempo" value={d.gameTempo} onChange={v => set("gameTempo", v)} options={[{ value: "normal", label: "Normal" }, { value: "slow", label: "Slow" }]} /></Field>
            <Field label="Time (min)" htmlFor="ctf-min"><NumberInput id="ctf-min" className="w-24" min={3} max={7} value={d.minutes} onChange={v => set("minutes", v ?? 5)} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Checkbox checked={d.stadiumVote} onChange={v => set("stadiumVote", v)} label="Stadium vote" hint="Off = everyone goes to one random stadium (blind)" />
            <Checkbox checked={d.legendaries} onChange={v => set("legendaries", v)} label="Legendary machines" />
            <Checkbox checked={d.fieldEvents} onChange={v => set("fieldEvents", v)} label="Field events" />
            <Checkbox checked={d.fieldChange} onChange={v => set("fieldChange", v)} label="Field change" />
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-night-300">Active stadiums</div>
            <p className="mb-2 text-xs text-night-400">Click a stadium to switch it off. {banned.size ? `${banned.size} off.` : "All on."}</p>
            <div className="space-y-2">
              {STADIUM_TYPES.map(type => {
                const list = STADIUMS.filter(s => s.type === type);
                const ids = list.map(s => s.id);
                const allOff = ids.every(id => banned.has(id));
                return (
                  <div key={type} className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => toggleIds(ids, !allOff)} className="w-36 text-left text-sm font-semibold text-night-100 hover:text-air-400" title={allOff ? "Switch the whole type on" : "Switch the whole type off"}>
                      {type}{allOff ? " (off)" : ""}
                    </button>
                    {list.length > 1 && list.map(s => (
                      <Chip key={s.id} active={!banned.has(s.id)} onClick={() => toggleIds([s.id], !banned.has(s.id))}>{s.name.replace(`${type} `, "").replace("Race: ", "")}</Chip>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <Field label="Points by place (optional)" htmlFor="ctf-points" hint="1st first, e.g. 8, 6, 4, 2">
            <TextInput id="ctf-points" value={d.pointsText} onChange={e => set("pointsText", e.target.value)} placeholder="8, 6, 4, 2" />
          </Field>
          <Checkbox checked={d.useSets} onChange={v => set("useSets", v)} label="Played in sets" hint="A session is one set: points add up over its rounds and the top amiibo advance." />
          {d.useSets && d.set && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Rounds per set" htmlFor="ctf-rounds"><NumberInput id="ctf-rounds" min={1} value={d.set.rounds} onChange={v => set("set", { ...d.set!, rounds: v ?? 4 })} /></Field>
              <Field label="Advance" htmlFor="ctf-adv"><NumberInput id="ctf-adv" min={1} value={d.set.advance} onChange={v => set("set", { ...d.set!, advance: v ?? 2 })} /></Field>
              <Field label="Tiebreaker (min)" htmlFor="ctf-tb"><NumberInput id="ctf-tb" min={3} max={7} value={d.set.tiebreakerMinutes ?? null} onChange={v => set("set", { ...d.set!, tiebreakerMinutes: v ?? undefined })} /></Field>
              <div className="sm:col-span-3">
                <Checkbox checked={d.set.banPlayedType} onChange={v => set("set", { ...d.set!, banPlayedType: v })} label="Ban a stadium type once played" hint="Play Drag Race 2 and every Drag Race is off for the rest of the set." />
              </div>
            </div>
          )}
        </fieldset>
        <Field label="Description / full rules" htmlFor="ctf-desc"><TextArea id="ctf-desc" rows={4} value={d.description ?? ""} onChange={e => set("description", e.target.value)} /></Field>
        <SaveErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary">{initial ? "Save" : "Add format"}</Button>
          <Button variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

export function Formats({ data }: { data: CtData }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const used = (id: string) => data.matches.some(m => m.formatId === id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-night-300">Each format keeps its own results. Rules fix once a format has matches; make a new format for new rules.</p>
        {editing === null && <Button variant="primary" onClick={() => setEditing("new")}>New format</Button>}
      </div>
      {editing === "new" && <FormatForm locked={false} onDone={() => setEditing(null)} />}
      {data.formats.map(f => editing === f.id
        ? <FormatForm key={f.id} initial={f} locked={used(f.id)} onDone={() => setEditing(null)} />
        : (
          <Card key={f.id} className={f.isArchived ? "opacity-60" : undefined}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-display text-lg font-bold">{f.name}</div>
                <p className="text-sm text-night-300">{rulesLine(f)}</p>
              </div>
              <div className="flex gap-2">
                {f.isDefaultRules && <Badge tone="air">Game default</Badge>}
                <Badge>{data.matches.filter(m => m.formatId === f.id).length} matches</Badge>
              </div>
            </div>
            {f.description && <p className="mt-2 whitespace-pre-wrap text-sm text-night-400">{f.description}</p>}
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" onClick={() => setEditing(f.id)}>Edit</Button>
              <Button variant="ghost" onClick={() => void saveCtFormat({ ...f, isArchived: !f.isArchived })}>{f.isArchived ? "Unarchive" : "Archive"}</Button>
            </div>
          </Card>
        ))}
    </div>
  );
}
