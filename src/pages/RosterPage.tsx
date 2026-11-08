import { useState } from "react";
import { getAll, getAllByIndex } from "../db/database";
import type { Rider } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { modeLabel, useMode } from "../lib/mode";
import { Link } from "../lib/router";
import { Badge, Card, Notice, Spinner, cx } from "../components/ui";

type Tab = "riders" | "machines" | "stages";

function groupRiders(riders: Rider[]): [string, Rider[]][] {
  const groups = new Map<string, Rider[]>();
  for (const r of [...riders].sort((a, b) => a.sortOrder - b.sortOrder)) {
    groups.set(r.characterGroup, [...(groups.get(r.characterGroup) ?? []), r]);
  }
  return [...groups];
}

export function RosterPage() {
  const { mode } = useMode();
  const [tab, setTab] = useState<Tab>("riders");
  const { data, error, loading } = useLiveQuery(async () => {
    const [riders, machines, stages, profiles] = await Promise.all([
      getAll("riders"), getAll("machines"), getAllByIndex("stages", "mode", mode), getAll("figurePlayerProfiles"),
    ]);
    return { riders, machines, stages, profiles: profiles.sort((a, b) => a.nickname.localeCompare(b.nickname)) };
  }, [mode], ["riders", "machines", "stages", "figurePlayerProfiles"]);

  if (error) return <Notice tone="bad" title="Couldn't load the roster">{error.message}</Notice>;
  if (loading || !data) return <Spinner />;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "riders", label: "Riders", count: data.riders.length },
    { id: "machines", label: "Machines", count: data.machines.length },
    { id: "stages", label: `${modeLabel(mode)} stages`, count: data.stages.length },
  ];
  const accent = mode === "air_ride" ? "border-air-500 text-air-400" : "border-top-500 text-top-400";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Roster & stages</h1>
        <p className="mt-1 text-night-300">
          {data.riders.length} riders × {data.machines.length} machines = {data.riders.length * data.machines.length} combos to measure. Click a character or amiibo for its stats.
        </p>
      </div>

      <div role="tablist" aria-label="Roster sections" className="flex gap-1 border-b border-night-800">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors",
              tab === t.id ? accent : "border-transparent text-night-300 hover:text-night-100",
            )}
          >
            {t.label} <span className="ml-1 text-night-400 tabular">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "riders" && (
        <div className="grid gap-4 md:grid-cols-2">
          {groupRiders(data.riders).map(([group, members]) => (
            <Card key={group} className="p-4">
              <h2 className="mb-3 text-base font-semibold">{group}</h2>
              <ul className="space-y-2">
                {members.map(r => {
                  const mine = data.profiles.filter(p => p.riderId === r.id);
                  return (
                    <li key={r.id} className="rounded-xl bg-night-850 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link to="stats" params={{ rider: r.id }} className="font-medium hover:text-air-400" title={`${r.name} stats`}>
                          {r.name} <span aria-hidden className="text-night-400">›</span>
                        </Link>
                        {r.description && <span className="text-right text-xs text-night-400">{r.description}</span>}
                      </div>
                      {mine.length > 0 ? (
                        <ul className="mt-1.5 flex flex-wrap gap-1.5">
                          {mine.map(p => (
                            <li key={p.id}>
                              <Link to="stats" params={{ profile: p.id }}
                                className={cx("inline-block rounded-full border px-2.5 py-0.5 text-xs hover:border-air-400 hover:text-air-400",
                                  p.status === "retired" ? "border-night-700 text-night-400 line-through" : "border-night-600 text-night-100")}>
                                {p.nickname}{p.isBaseline ? " · baseline" : ""}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-night-400">No amiibo yet</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {tab === "machines" && (
        <Card className="p-0">
          <ul className="divide-y divide-night-800">
            {[...data.machines].sort((a, b) => a.sortOrder - b.sortOrder).map(m => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-5 py-3">
                <span className="font-medium">{m.name}</span>
                <span className="flex gap-2">
                  {m.isLegendary && <Badge tone="star">Legendary</Badge>}
                  {m.hasAmiibo && <Badge>amiibo</Badge>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === "stages" && (
        data.stages.length === 0 ? (
          <Notice>No {modeLabel(mode)} stages.</Notice>
        ) : (
          <Card className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-night-800 text-left text-xs uppercase tracking-wider text-night-400">
                  <th className="px-5 py-3 font-medium">Stage</th>
                  <th className="px-5 py-3 text-right font-medium">Default laps</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-night-800">
                {data.stages.filter(s => !s.isArchived).sort((a, b) => a.sortOrder - b.sortOrder).map(s => (
                  <tr key={s.id}>
                    <td className="px-5 py-2.5 font-medium">{s.name}</td>
                    <td className="px-5 py-2.5 text-right tabular text-night-300">{s.defaultLaps ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}
    </div>
  );
}
