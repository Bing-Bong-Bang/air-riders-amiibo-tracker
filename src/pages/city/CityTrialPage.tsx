// City Trial: its own section, separate from Air Ride and Top Ride.
// Sections (in the top bar when City Trial is the mode): Overview · Log match ·
// Matches · Sessions · Records · Formats.

import { useReference } from "../../hooks/useReference";
import { useLocation } from "../../lib/router";
import { Notice, Spinner } from "../../components/ui";
import { useCtData } from "./data";
import { Formats } from "./Formats";
import { LogMatch } from "./LogMatch";
import { Matches } from "./Matches";
import { Overview } from "./Overview";
import { Rankings } from "./Rankings";
import { Records } from "./Records";
import { SessionDetail, Sessions } from "./Sessions";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "log", label: "Log match" },
  { id: "matches", label: "Matches" },
  { id: "sessions", label: "Sessions" },
  { id: "rankings", label: "Rankings" },
  { id: "records", label: "Records" },
  { id: "formats", label: "Formats" },
] as const;
type Tab = (typeof TABS)[number]["id"] | "session";

export function CityTrialPage() {
  const { params } = useLocation();
  // Profiles, riders and versions are shared with the race modes; mode only filters race data.
  const { data: ref_, error, loading } = useReference("air_ride");
  const ct = useCtData();
  const raw = params.get("tab");
  const tab: Tab = raw === "session" || TABS.some(t => t.id === raw) ? (raw as Tab) : "overview";

  if (error || ct.error) return <Notice tone="bad" title="Couldn't load City Trial">{(error ?? ct.error)?.message}</Notice>;
  if (loading || ct.loading || !ref_ || !ct.data) return <Spinner />;
  const data = ct.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">City Trial</h1>
        <p className="mt-1 max-w-3xl text-night-300">
          Nothing here mixes with Air Ride or Top Ride. Log who placed where, and when you can, their stat totals, machine and score.
        </p>
      </div>
      {tab === "overview" && <Overview ref_={ref_} data={data} />}
      {tab === "log" && <LogMatch key={`${params.get("edit") ?? ""}|${params.get("session") ?? ""}`} ref_={ref_} data={data} editId={params.get("edit")} presetSession={params.get("session")} />}
      {tab === "matches" && <Matches ref_={ref_} data={data} />}
      {tab === "sessions" && <Sessions ref_={ref_} data={data} />}
      {tab === "session" && <SessionDetail key={params.get("id") ?? ""} ref_={ref_} data={data} id={params.get("id") ?? ""} />}
      {tab === "rankings" && <Rankings ref_={ref_} data={data} />}
      {tab === "records" && <Records ref_={ref_} data={data} />}
      {tab === "formats" && <Formats data={data} />}
    </div>
  );
}
