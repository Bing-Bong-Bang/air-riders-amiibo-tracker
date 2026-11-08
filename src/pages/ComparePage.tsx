// Compare sessions (#/compare): pick a format, then any number of amiibo + machine
// pairs from any of its sessions, compared stage by stage.

import { useState } from "react";
import { getAll } from "../db/database";
import type { ID } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { useReference } from "../hooks/useReference";
import { modeLabel, useMode } from "../lib/mode";
import { Link } from "../lib/router";
import { Field, Select } from "../components/form";
import { Notice, Spinner } from "../components/ui";
import { MultiCompare } from "./sessionInsights";

export function ComparePage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const sessions = useLiveQuery(() => getAll("sessions"), [], ["sessions"]);
  const [formatChoice, setFormatChoice] = useState<ID>("");

  if (error || sessions.error) return <Notice tone="bad" title="Couldn't load sessions">{(error ?? sessions.error)?.message}</Notice>;
  if (loading || sessions.loading || !ref_ || !sessions.data) return <Spinner />;

  const formats = ref_.formats.filter(f => f.mode === mode && sessions.data!.some(s => s.formatId === f.id));
  const recordId = ref_.settings?.recordFormatIds[mode];
  const format = formats.find(f => f.id === formatChoice) ?? formats.find(f => f.id === recordId) ?? formats[0];

  return (
    <div className="space-y-6">
      <div>
        <Link to="sessions" className="text-sm text-night-400 hover:text-night-100">← Sessions</Link>
        <h1 className="mt-1 text-3xl font-bold">Compare sessions</h1>
        <p className="mt-1 max-w-3xl text-night-300">
          Line up amiibo + machine pairs from any of your {modeLabel(mode)} sessions, e.g. YES CHEF! on Hop Star, YES CHEF! on Tank Star and Dedede on Warp Star, all on Floria Fields.
        </p>
      </div>
      {!format ? (
        <Notice title="No sessions yet">Start a session and log some races, then compare them here.</Notice>
      ) : (
        <>
          {formats.length > 1 && (
            <Field label="Format" htmlFor="cmp-format" hint="Formats never mix, so a comparison stays in one." className="max-w-md">
              <Select id="cmp-format" value={format.id} onChange={e => setFormatChoice(e.target.value)}>
                {formats.map(f => <option key={f.id} value={f.id}>{f.name}{f.id === recordId ? " ★" : ""}</option>)}
              </Select>
            </Field>
          )}
          <MultiCompare key={format.id} formatId={format.id} ref_={ref_} initial={[]} title={format.name} />
        </>
      )}
    </div>
  );
}
