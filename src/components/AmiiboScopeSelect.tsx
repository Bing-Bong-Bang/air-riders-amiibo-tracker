// "Which amiibo count?": trained (default), baseline only, or both.
// Only shown once a baseline amiibo exists.

import type { AmiiboScope } from "../domain/coreData";
import { Select } from "./form";

export function AmiiboScopeSelect({ value, onChange, show }: { value: AmiiboScope; onChange: (v: AmiiboScope) => void; show: boolean }) {
  if (!show) return null;
  return (
    <label className="space-y-1.5">
      <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Amiibo</span>
      <Select aria-label="Amiibo" className="w-auto min-w-48" value={value} onChange={e => onChange(e.target.value as AmiiboScope)}
        title="Trained: your own amiibo. Baseline: Balanced (default AI) amiibo only, i.e. what any player's untrained amiibo would do.">
        <option value="trained">Trained amiibo</option>
        <option value="baseline">Baseline only</option>
        <option value="both">Trained + baseline</option>
      </Select>
    </label>
  );
}
