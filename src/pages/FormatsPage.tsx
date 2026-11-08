import { useState } from "react";
import type { FormEvent } from "react";
import { getAll } from "../db/database";
import { saveFormat, setRecordFormat } from "../db/repo";
import { DEFAULT_WINNER_INDEX_WEIGHTS, maxRidersFor } from "../domain/schema";
import type { Format, ID, InGameSettings, Seats, TrackedMode } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Checkbox, Field, NumberInput, SaveErrorNotice, Select, TextArea, TextInput } from "../components/form";
import { Badge, Button, Card, CardHeader, Notice, Spinner, StarMark, cx } from "../components/ui";

type FormatDraft = Omit<Format, "id" | "createdAt" | "updatedAt"> & { id?: ID };

function blankFormat(mode: TrackedMode): FormatDraft {
  return {
    mode,
    name: "",
    settings: mode === "top_ride" ? {
      gameTempo: "normal", numberOfRiders: 4, ruleType: null, laps: "default",
      boostAssist: null, specialAssist: null, enemies: null, retirement: false,
      items: "normal", itemRestrictions: "normal", features: "all", antiReverse: true, boostAssistLevel: "weak",
    } : {
      gameTempo: "normal", numberOfRiders: 4, ruleType: "laps", laps: "default",
      boostAssist: false, specialAssist: false, enemies: true, retirement: null,
    },
    trackedSeats: 4,
    allowedRacerKinds: ["amiibo"],
    scoring: "placement",
    timing: "igt",
    runStructure: { kind: "single_race" },
    pointsTable: [10, 6, 3, 1],
    objective: "placement",
    winnerIndexWeights: { ...DEFAULT_WINNER_INDEX_WEIGHTS },
    disasterThresholdPct: 5,
    forbidsGlitches: false,
    requiresVideo: false,
    isArchived: false,
  };
}

// ---- small mappers for "Any" choices ----
type Tri = "any" | "on" | "off";
const toTri = (v: boolean | null): Tri => (v === null ? "any" : v ? "on" : "off");
const fromTri = (v: Tri): boolean | null => (v === "any" ? null : v === "on");

function TriSelect({ id, value, onChange, disabled }: { id: string; value: boolean | null; onChange: (v: boolean | null) => void; disabled?: boolean }) {
  return (
    <Select id={id} value={toTri(value)} onChange={e => onChange(fromTri(e.target.value as Tri))} disabled={disabled}>
      <option value="on">On</option>
      <option value="off">Off</option>
      <option value="any">Any (not enforced)</option>
    </Select>
  );
}

/** A pick from a fixed list of in-game choices, or "Any" (not enforced). */
function ChoiceSelect<T extends string>({ id, value, onChange, options }: { id: string; value: T | null | undefined; onChange: (v: T | null) => void; options: T[] }) {
  return (
    <Select id={id} value={value ?? "any"} onChange={e => onChange(e.target.value === "any" ? null : (e.target.value as T))}>
      {options.map(o => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}
      <option value="any">Any (not enforced)</option>
    </Select>
  );
}

function summary(f: Format): string[] {
  const s = f.settings;
  const parts: string[] = [];
  parts.push(f.flexibleSeats ? `1–${f.trackedSeats} logged racers` : f.trackedSeats === 1 ? "Solo" : `${f.trackedSeats} logged racers`);
  parts.push(s.numberOfRiders !== null ? `${s.numberOfRiders} riders` : `2–${maxRidersFor(f.mode)} riders`);
  parts.push(s.laps === null ? "any laps" : s.laps === "default" ? "default laps" : `${s.laps} laps`);
  if (f.mode === "top_ride") {
    if (s.items) parts.push(`items ${s.items}`);
    if (s.features) parts.push(`features ${s.features}`);
  } else if (s.retirement !== null) parts.push(`retirement ${s.retirement ? "on" : "off"}`);
  parts.push(f.scoring === "time" ? "ranked by time" : "ranked by placement");
  if (f.runStructure.kind === "course_set") parts.push(`full run of ${f.runStructure.stageIds.length} courses`);
  return parts;
}

// -------------------------------------------------------------
// Builder
// -------------------------------------------------------------

function FormatForm({ initial, ref_, raceCount, onDone }: { initial: FormatDraft; ref_: Reference; raceCount: number; onDone: () => void }) {
  const [d, setD] = useState<FormatDraft>(initial);
  const [pointsText, setPointsText] = useState((initial.pointsTable ?? []).join(", "));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const isDefault = !!initial.isDefaultRules;
  const locked = raceCount > 0 || isDefault;
  const set = <K extends keyof FormatDraft>(k: K, v: FormatDraft[K]) => setD(prev => ({ ...prev, [k]: v }));
  const setS = <K extends keyof InGameSettings>(k: K, v: InGameSettings[K]) => setD(prev => ({ ...prev, settings: { ...prev.settings, [k]: v } }));
  const most = maxRidersFor(d.mode);
  const seatOptions = Array.from({ length: most }, (_, i) => (i + 1) as Seats);
  const maxSeats = d.settings.numberOfRiders ?? most;
  const isTop = d.mode === "top_ride";
  const fullRun = d.runStructure.kind === "course_set";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!d.name.trim()) return setError(new Error("Give the format a name."));
    let pointsTable: number[] | undefined;
    if (d.scoring === "placement" && pointsText.trim()) {
      pointsTable = pointsText.split(/[,\s]+/).filter(Boolean).map(Number);
      if (pointsTable.some(n => !Number.isFinite(n))) return setError(new Error("Points must be numbers separated by commas, like 10, 6, 3, 1."));
    }
    setBusy(true);
    try {
      await saveFormat({ ...d, pointsTable: d.scoring === "placement" ? pointsTable : undefined });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const id = (s: string) => `ff-${s}`;

  return (
    <Card className="border-air-500/40">
      <form onSubmit={submit} className="space-y-6">
        <CardHeader title={d.id ? `Edit "${initial.name}"` : `New ${modeLabel(d.mode)} format`} />
        {isDefault && (
          <Notice title="These are the game's default rules">
            They can't be changed, only renamed. Use Duplicate for a variation, like retirement on.
          </Notice>
        )}
        {locked && !isDefault && (
          <Notice title={`${raceCount} race${raceCount === 1 ? "" : "s"} use this format`}>
            Its rules are locked so those results stay comparable. You can still rename it and change how it's scored for stats. Use Duplicate for a variation.
          </Notice>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor={id("name")}>
            <TextInput id={id("name")} placeholder="4-Racer, Retirement On" value={d.name} onChange={e => set("name", e.target.value)} />
          </Field>
          <Field label="Notes / rules text (optional)" htmlFor={id("desc")}>
            <TextArea id={id("desc")} value={d.description ?? ""} onChange={e => set("description", e.target.value)} />
          </Field>
        </div>

        <fieldset disabled={locked} className="space-y-4">
          <legend className="mb-2 text-sm font-semibold">In-game rules</legend>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Game tempo" htmlFor={id("tempo")}>
              <Select id={id("tempo")} value={d.settings.gameTempo ?? "any"} onChange={e => setS("gameTempo", e.target.value === "any" ? null : (e.target.value as "normal" | "slow"))}>
                <option value="normal">Normal</option><option value="slow">Slow</option><option value="any">Any</option>
              </Select>
            </Field>
            <Field label="No. of riders" hint="In the race, CPUs included" htmlFor={id("riders")}>
              <Select id={id("riders")} value={d.settings.numberOfRiders ?? "any"} onChange={e => {
                const v = e.target.value === "any" ? null : (Number(e.target.value) as Seats);
                setD(prev => ({ ...prev, settings: { ...prev.settings, numberOfRiders: v }, trackedSeats: v !== null && prev.trackedSeats > v ? v : prev.trackedSeats }));
              }}>
                {seatOptions.map(n => <option key={n} value={n}>{n}</option>)}<option value="any">Any</option>
              </Select>
            </Field>
            {!isTop && (
              <Field label="Rules" htmlFor={id("rules")}>
                <Select id={id("rules")} value={d.settings.ruleType ?? "any"} onChange={e => setS("ruleType", e.target.value === "any" ? null : (e.target.value as "laps" | "time"))}>
                  <option value="laps">Laps</option><option value="time">Time</option><option value="any">Any</option>
                </Select>
              </Field>
            )}
            <Field label="No. of laps" htmlFor={id("laps")}>
              <div className="flex gap-2">
                <Select id={id("laps")} value={d.settings.laps === null ? "any" : d.settings.laps === "default" ? "default" : "custom"}
                  onChange={e => setS("laps", e.target.value === "any" ? null : e.target.value === "default" ? "default" : 3)}>
                  <option value="default">Default</option><option value="custom">Custom</option><option value="any">Any</option>
                </Select>
                {typeof d.settings.laps === "number" && (
                  <NumberInput aria-label="Number of laps" min={1} className="w-20" value={d.settings.laps} onChange={v => setS("laps", v ?? 1)} />
                )}
              </div>
            </Field>
            {isTop ? (
              <>
                <Field label="Items" htmlFor={id("items")}>
                  <ChoiceSelect id={id("items")} value={d.settings.items} onChange={v => setS("items", v)} options={["off", "few", "normal", "many"]} />
                </Field>
                <Field label="Item restrictions" htmlFor={id("restrict")}>
                  <ChoiceSelect id={id("restrict")} value={d.settings.itemRestrictions} onChange={v => setS("itemRestrictions", v)} options={["normal", "safety", "attack", "surprise"]} />
                </Field>
                <Field label="Features" hint="Stage hazards" htmlFor={id("features")}>
                  <ChoiceSelect id={id("features")} value={d.settings.features} onChange={v => setS("features", v)} options={["all", "limited"]} />
                </Field>
                <Field label="Anti-reverse" htmlFor={id("antirev")}><TriSelect id={id("antirev")} value={d.settings.antiReverse ?? null} onChange={v => setS("antiReverse", v)} /></Field>
                <Field label="Boost assist" htmlFor={id("boost")}>
                  <ChoiceSelect id={id("boost")} value={d.settings.boostAssistLevel} onChange={v => setS("boostAssistLevel", v)} options={["off", "weak", "strong"]} />
                </Field>
              </>
            ) : (
              <>
                <Field label="Boost assist" htmlFor={id("boost")}><TriSelect id={id("boost")} value={d.settings.boostAssist} onChange={v => setS("boostAssist", v)} /></Field>
                <Field label="Special assist" htmlFor={id("special")}><TriSelect id={id("special")} value={d.settings.specialAssist} onChange={v => setS("specialAssist", v)} /></Field>
                <Field label="Enemies" htmlFor={id("enemies")}><TriSelect id={id("enemies")} value={d.settings.enemies} onChange={v => setS("enemies", v)} /></Field>
                <Field label="Retirement" htmlFor={id("retire")}><TriSelect id={id("retire")} value={d.settings.retirement} onChange={v => setS("retirement", v)} /></Field>
              </>
            )}
          </div>
        </fieldset>

        <fieldset disabled={locked} className="space-y-4">
          <legend className="mb-2 text-sm font-semibold">What you log</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={d.flexibleSeats ? "Most amiibo per race" : "Amiibo you log per race"} hint="CPUs in the race aren't logged" htmlFor={id("seats")}>
              <Select id={id("seats")} value={d.trackedSeats} onChange={e => set("trackedSeats", Number(e.target.value) as FormatDraft["trackedSeats"])}>
                {seatOptions.filter(n => n <= maxSeats).map(n => <option key={n} value={n}>{n}</option>)}
              </Select>
            </Field>
            <Field label="Ranked by" htmlFor={id("scoring")}>
              <Select id={id("scoring")} value={d.scoring} onChange={e => set("scoring", e.target.value as Format["scoring"])}>
                <option value="time">Finish time</option><option value="placement">Placement</option>
              </Select>
            </Field>
            <Field label="Timing" htmlFor={id("timing")}>
              <Select id={id("timing")} value={d.timing} onChange={e => set("timing", e.target.value as Format["timing"])}>
                <option value="igt">In-game time</option><option value="rta">Real time</option>
              </Select>
            </Field>
          </div>
          <Checkbox
            checked={!!d.flexibleSeats}
            onChange={v => set("flexibleSeats", v || undefined)}
            label="The number of amiibo varies race to race"
            hint={`Each race logs 1 to ${d.trackedSeats} amiibo. Can't be used with full runs.`}
          />
          <Checkbox
            checked={!!d.fillerCpu}
            onChange={on => set("fillerCpu", on ? { riderId: ref_.riders[0]?.id ?? "", machineId: ref_.machines[0]?.id ?? "", cpuLevel: 1, handicap: 4, count: 1 } : undefined)}
            label="Rules require a specific CPU"
            hint="Shown as a setup reminder. Its results aren't logged."
          />
          {d.fillerCpu && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="CPU rider" htmlFor={id("cpu-r")}>
                <Select id={id("cpu-r")} value={d.fillerCpu.riderId} onChange={e => set("fillerCpu", { ...d.fillerCpu!, riderId: e.target.value })}>
                  {ref_.riders.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
              </Field>
              <Field label="CPU machine" htmlFor={id("cpu-m")}>
                <Select id={id("cpu-m")} value={d.fillerCpu.machineId} onChange={e => set("fillerCpu", { ...d.fillerCpu!, machineId: e.target.value })}>
                  {ref_.machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </Field>
              <Field label="CPU level" htmlFor={id("cpu-l")}><NumberInput id={id("cpu-l")} min={1} value={d.fillerCpu.cpuLevel} onChange={v => set("fillerCpu", { ...d.fillerCpu!, cpuLevel: v ?? 1 })} /></Field>
              <Field label="Handicap" htmlFor={id("cpu-h")}><NumberInput id={id("cpu-h")} min={0} value={d.fillerCpu.handicap} onChange={v => set("fillerCpu", { ...d.fillerCpu!, handicap: v ?? 0 })} /></Field>
            </div>
          )}
        </fieldset>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold">How races group</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["single", "Each race stands alone", "Practice, heats, comparisons"],
              ["run", "Full run", `Every ${modeLabel(d.mode)} course once, times summed`],
            ] as const).map(([value, title, hint]) => {
              const active = (value === "run") === fullRun;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={locked}
                  aria-pressed={active}
                  onClick={() => set("runStructure", value === "run"
                    ? { kind: "course_set", stageIds: ref_.stages.filter(s => !s.isArchived).map(s => s.id), anyOrder: true, eachStageOnce: true, sameRacerThroughout: true, machineMayChange: true }
                    : { kind: "single_race" })}
                  className={cx("rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                    active ? "border-air-400 bg-air-500/10" : "border-night-600 hover:border-night-400")}
                >
                  <div className="font-semibold">{title}</div>
                  <div className="text-sm text-night-300">{hint}</div>
                </button>
              );
            })}
          </div>
          {d.runStructure.kind === "course_set" && (
            <Checkbox
              checked={d.runStructure.machineMayChange}
              onChange={v => d.runStructure.kind === "course_set" && set("runStructure", { ...d.runStructure, machineMayChange: v })}
              label="Machine may change between courses"
            />
          )}
          <div className="flex flex-wrap gap-6">
            <Checkbox checked={d.forbidsGlitches} onChange={v => set("forbidsGlitches", v)} label="A glitch or clip forfeits the run" />
            <Checkbox checked={d.requiresVideo} onChange={v => set("requiresVideo", v)} label="Video required" />
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold">Stats</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Best means" hint="Used by recommendations" htmlFor={id("objective")}>
              <Select id={id("objective")} value={d.objective} onChange={e => set("objective", e.target.value as Format["objective"])}>
                <option value="mean_time">Lowest average time (summed-time runs)</option>
                <option value="pb_chance">Best chance at a PB</option>
                <option value="placement">Best expected placement</option>
              </Select>
            </Field>
            {d.scoring === "placement" && (
              <Field label="Points per place (optional)" hint="1st, 2nd, 3rd… e.g. 10, 6, 3, 1" htmlFor={id("points")}>
                <TextInput id={id("points")} value={pointsText} onChange={e => setPointsText(e.target.value)} />
              </Field>
            )}
          </div>
          <details className="rounded-xl border border-night-700 p-4">
            <summary className="cursor-pointer text-sm font-medium text-night-300">Advanced: Winner Index and disasters</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Field label="Median weight" htmlFor={id("wim")}><NumberInput id={id("wim")} step={0.05} min={0} value={d.winnerIndexWeights.median} onChange={v => set("winnerIndexWeights", { ...d.winnerIndexWeights, median: v ?? 0 })} /></Field>
              <Field label="Spread weight" htmlFor={id("wis")}><NumberInput id={id("wis")} step={0.05} min={0} value={d.winnerIndexWeights.stdDev} onChange={v => set("winnerIndexWeights", { ...d.winnerIndexWeights, stdDev: v ?? 0 })} /></Field>
              <Field label="Disaster if slower than median by %" htmlFor={id("dis")}><NumberInput id={id("dis")} step={0.5} min={0.5} value={d.disasterThresholdPct} onChange={v => set("disasterThresholdPct", v ?? 5)} /></Field>
            </div>
            <p className="mt-3 text-xs text-night-400">
              Winner Index = median × {d.winnerIndexWeights.median} + spread × {d.winnerIndexWeights.stdDev}.
              {d.winnerIndexWeights.median > 0 && ` Each second of spread costs ${(d.winnerIndexWeights.stdDev / d.winnerIndexWeights.median).toFixed(2)} s.`}
            </p>
          </details>
        </div>

        <SaveErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save format"}</Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

// -------------------------------------------------------------

export function FormatsPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const raceCounts = useLiveQuery(async () => {
    const m = new Map<ID, number>();
    for (const r of await getAll("races")) m.set(r.formatId, (m.get(r.formatId) ?? 0) + 1);
    return m;
  }, [], ["races"]);
  const [editing, setEditing] = useState<FormatDraft | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (error) return <Notice tone="bad" title="Couldn't load formats">{error.message}</Notice>;
  if (loading || !ref_) return <Spinner />;

  const recordId = ref_.settings?.recordFormatIds[mode];
  const active = ref_.formats.filter(f => !f.isArchived);
  const archived = ref_.formats.filter(f => f.isArchived);
  const countFor = (id: ID) => raceCounts.data?.get(id) ?? 0;

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try { await fn(); } catch (e) { setActionError(e); }
  };
  const duplicate = (f: Format) => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = f;
    setEditing({ ...structuredClone(rest), name: `${f.name} (copy)`, isDefaultRules: undefined });
  };

  const row = (f: Format) => {
    const isRecord = f.id === recordId;
    return (
      <Card key={f.id} className={cx(isRecord && "border-star-400/40")}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {isRecord && <StarMark className="text-star-400" />}{f.name}
            </h2>
            <p className="mt-1 text-sm text-night-300">{summary(f).join(" · ")}</p>
          </div>
          <div className="flex gap-2">
            {f.isDefaultRules && <Badge tone="ok">Default rules</Badge>}
            {isRecord && <Badge tone="star">World-record format</Badge>}
            <Badge>{countFor(f.id)} races</Badge>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setEditing({ ...structuredClone(f) })}>Edit</Button>
          <Button variant="ghost" onClick={() => duplicate(f)}>Duplicate</Button>
          {!f.isArchived && !isRecord && <Button variant="ghost" onClick={() => run(() => setRecordFormat(mode, f.id))}>Make record format</Button>}
          {!isRecord && !f.isDefaultRules && (
            <Button variant="ghost" onClick={() => run(() => saveFormat({ ...f, isArchived: !f.isArchived }))}>
              {f.isArchived ? "Unarchive" : "Archive"}
            </Button>
          )}
        </div>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{modeLabel(mode)} formats</h1>
          <p className="mt-1 text-night-300">Each format is its own dataset. Results from different formats are never mixed.</p>
        </div>
        {!editing && <Button variant="primary" onClick={() => setEditing(blankFormat(mode))}>New format</Button>}
      </div>

      {editing && (
        <FormatForm
          key={editing.id ?? "new"}
          initial={editing}
          ref_={ref_}
          raceCount={editing.id ? countFor(editing.id) : 0}
          onDone={() => setEditing(null)}
        />
      )}
      <SaveErrorNotice error={actionError} />

      {active.length === 0 && !editing && <Notice title={`No ${modeLabel(mode)} formats yet`}>Create one to start logging {modeLabel(mode)} races.</Notice>}
      <div className="space-y-4">{active.map(row)}</div>

      {archived.length > 0 && (
        <div>
          <Button variant="ghost" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}>
            {showArchived ? "Hide" : "Show"} archived ({archived.length})
          </Button>
          {showArchived && <div className="mt-4 space-y-4">{archived.map(row)}</div>}
        </div>
      )}
    </div>
  );
}
