// Compare (#/compare): pick a format, then any number of amiibo + machine pairs,
// from all counted races or from single sessions, compared course by course.
// ?format=<id>&pick=<source|profile|machine> (repeatable) pre-fills it, e.g.
// from an amiibo's stat page.

import { useState } from "react";
import { getAll } from "../db/database";
import type { ID } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { useLocation } from "../lib/router";
import { Field, Select } from "../components/form";
import { Notice, Spinner } from "../components/ui";
import { MultiCompare } from "./sessionInsights";

export function ComparePage() {
  const { mode } = useMode();
  const { params } = useLocation();
  const { data: ref_, error, loading } = useReference(mode);
  const races = useLiveQuery(() => getAll("races"), [], ["races"]);
  const [formatChoice, setFormatChoice] = useState<ID>(params.get("format") ?? "");
  const picks = params.getAll("pick");

  if (error || races.error) return <Notice tone="bad" title="Couldn't load your races">{(error ?? races.error)?.message}</Notice>;
  if (loading || races.loading || !ref_ || !races.data) return <Spinner />;

  const used = new Set(races.data.map(r => r.formatId));
  const formats = ref_.formats.filter(f => f.mode === mode && used.has(f.id));
  const recordId = ref_.settings?.recordFormatIds[mode];
  const format = formats.find(f => f.id === formatChoice) ?? formats.find(f => f.id === recordId) ?? formats[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Compare</h1>
        <p className="mt-1 max-w-3xl text-night-300">
          Put any {modeLabel(mode)} amiibo + machine pairs side by side, course by course, e.g. God 2.0 on Tank Star against the Balanced Dedede on Tank Star.
          Use <strong>All races</strong> for everything you've logged, or pick a single session.
        </p>
      </div>
      {!format ? (
        <Notice title="No races yet">Log some races, then compare them here.</Notice>
      ) : (
        <>
          {formats.length > 1 && (
            <Field label="Format" htmlFor="cmp-format" hint="Formats never mix, so a comparison stays in one." className="max-w-md">
              <Select id="cmp-format" value={format.id} onChange={e => setFormatChoice(e.target.value)}>
                {formats.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === recordId ? " ★" : ""}</option>)}
              </Select>
            </Field>
          )}
          <MultiCompare key={format.id} formatId={format.id} ref_={ref_} title={format.name}
            initial={format.id === params.get("format") ? picks : []} />
        </>
      )}
    </div>
  );
}
