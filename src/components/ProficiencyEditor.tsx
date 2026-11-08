// Machine proficiency on an amiibo: maxed on every machine unless you say
// otherwise. Only machines with amiibo figures (the 7 raced in Air Ride and
// Top Ride) can be scanned, so only those carry proficiency.

import { useState } from "react";
import { SCANNABLE_MACHINES, belowMax, proficiencyOf } from "../domain/cityTrial";
import type { FigurePlayerProfile } from "../domain/schema";
import { setProficiency } from "../db/ctRepo";
import { NumberInput, SaveErrorNotice } from "./form";
import { Button } from "./ui";

export function ProficiencyLine({ profile }: { profile: FigurePlayerProfile }) {
  const [open, setOpen] = useState(false);
  const below = belowMax(profile.machineProficiency);
  return (
    <div className="mt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-night-400">Machine proficiency</span>
        <span className={below.length ? "font-medium" : "text-night-300"}>
          {below.length === 0 ? "Maxed on all machines"
            : below.length <= 3 ? below.map(m => `${m.name} ${proficiencyOf(profile.machineProficiency, m.id)}`).join(", ") + "; the rest maxed"
            : `Below max on ${below.length} machines`}
        </span>
        {!open && <button type="button" className="text-xs text-air-400 hover:underline" onClick={() => setOpen(true)}>Change</button>}
      </div>
      {open && <ProficiencyEditor profile={profile} onDone={() => setOpen(false)} />}
    </div>
  );
}

function ProficiencyEditor({ profile, onDone }: { profile: FigurePlayerProfile; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(SCANNABLE_MACHINES.map(m => [m.id, proficiencyOf(profile.machineProficiency, m.id)])));
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setError(null);
    try {
      await setProficiency(profile.id, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v ?? 100])));
      onDone();
    } catch (err) { setError(err); }
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl bg-night-850 p-3">
      <p className="text-xs text-night-400">0–100 for each machine figure an amiibo can be scanned with. Leave at 100 for maxed. It may matter in City Trial, where an amiibo could favour machines it's best with.</p>
      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {SCANNABLE_MACHINES.map(m => (
          <label key={m.id} className="flex items-center justify-between gap-3">
            <span className="whitespace-nowrap text-sm">{m.name}</span>
            <div className="w-24 shrink-0">
              <NumberInput aria-label={`${m.name} proficiency`} min={0} max={100} value={values[m.id]} onChange={v => setValues(x => ({ ...x, [m.id]: v }))} />
            </div>
          </label>
        ))}
      </div>
      <SaveErrorNotice error={error} />
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => void save()}>Save proficiency</Button>
        <Button variant="ghost" onClick={() => setValues(Object.fromEntries(SCANNABLE_MACHINES.map(m => [m.id, 100])))}>Set all to 100</Button>
        <Button variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}
