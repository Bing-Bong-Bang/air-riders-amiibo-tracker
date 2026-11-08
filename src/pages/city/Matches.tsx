// Every logged City Trial match, newest first, with edit, delete and the
// counts-in-records switch.

import { useState } from "react";
import { FIELD_CHANGE_BY_ID, FIELD_EVENT_BY_ID, entryStatTotal, ordinal, stadiumName } from "../../domain/cityTrial";
import type { CtMatch } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import { deleteCtMatch, setCtMatchIncluded } from "../../db/ctRepo";
import type { Reference } from "../../hooks/useReference";
import { navigate } from "../../lib/router";
import { Checkbox, Field, Select } from "../../components/form";
import { Badge, Button, Card, Notice } from "../../components/ui";
import { machineName, scoresText } from "./bits";
import type { CtData } from "./data";

export function MatchCard({ ref_, data, match }: { ref_: Reference; data: CtData; match: CtMatch }) {
  const [confirm, setConfirm] = useState(false);
  const format = data.formatById.get(match.formatId);
  const session = match.sessionId ? data.sessionById.get(match.sessionId) : undefined;
  const entries = [...match.entries].sort((a, b) => (a.room ?? 1) - (b.room ?? 1) || (a.place ?? 99) - (b.place ?? 99));
  const extras = [
    ...(match.fieldEvents ?? []).map(k => FIELD_EVENT_BY_ID.get(k)?.name).filter(Boolean),
    ...(match.fieldChanges ?? []).map(k => FIELD_CHANGE_BY_ID.get(k)?.name).filter(Boolean),
  ];
  return (
    <Card className={match.includeInStats ? undefined : "opacity-75"}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-lg font-bold">{stadiumName(match.stadiumId)}{match.room2 && <span className="text-night-400"> + {stadiumName(match.room2.stadiumId)}</span>}</div>
          <p className="text-sm text-night-300">
            {new Date(match.playedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            {" · "}{format?.name ?? "?"} · {match.riderCount} riders
            {session && <> · <button type="button" className="text-air-400 hover:underline" onClick={() => navigate("city", { tab: "session", id: session.id })}>{session.name}</button></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {match.isTiebreaker && <Badge tone="star">Tiebreaker</Badge>}
          {!match.includeInStats && <Badge>Not in records</Badge>}
          {match.gameVersion && <Badge>v{match.gameVersion}</Badge>}
        </div>
      </div>
      <table className="mt-3 w-full text-sm">
        <tbody>
          {entries.map(e => {
            const total = entryStatTotal(e);
            const sid = e.room === 2 ? match.room2?.stadiumId : match.stadiumId;
            return (
              <tr key={e.id} className="border-t border-night-800">
                <td className="w-14 py-1.5 font-semibold tabular">{e.place ? ordinal(e.place) : "—"}</td>
                <td className="py-1.5">
                  {ref_.profileById.get(e.profileId)?.nickname ?? "?"}
                  {e.isGigantes && <span className="ml-1.5"><Badge tone="star">Gigantes</Badge></span>}
                  {e.room === 2 && <span className="ml-1.5 text-xs text-night-400">2nd stadium</span>}
                </td>
                <td className="py-1.5 text-right text-night-300 tabular">{total !== null ? `${total} stats` : ""}</td>
                <td className="hidden py-1.5 pl-3 text-night-300 sm:table-cell">
                  {e.machineId ? machineName(e.machineId) : ""}
                  {e.scannedMachineId && <span className="text-xs text-night-400">{e.machineId ? " · " : ""}scanned with {machineName(e.scannedMachineId)}</span>}
                </td>
                <td className="py-1.5 pl-3 text-right text-night-300 tabular">
                  {[typeof e.kos === "number" ? `${e.kos} KO` : "", scoresText(sid, e.scores)].filter(Boolean).join(" · ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {extras.length > 0 && <p className="mt-2 text-xs text-night-400">{extras.join(" · ")}</p>}
      {match.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-night-300">{match.notes}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => navigate("city", { tab: "log", edit: match.id })}>Edit</Button>
        <Checkbox checked={match.includeInStats} onChange={v => void setCtMatchIncluded(match.id, v)} label="Counts in records" />
        {!confirm
          ? <Button variant="ghost" className="hover:text-bad-400" onClick={() => setConfirm(true)}>Delete…</Button>
          : <>
              <Button variant="danger" onClick={() => void deleteCtMatch(match.id)}>Delete this match</Button>
              <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
            </>}
      </div>
    </Card>
  );
}

export function Matches({ ref_, data }: { ref_: Reference; data: CtData }) {
  const [formatId, setFormatId] = useState<ID | "">("");
  const [profileId, setProfileId] = useState<ID | "">("");
  const [limit, setLimit] = useState(30);
  const list = data.matches.filter(m => (!formatId || m.formatId === formatId) && (!profileId || m.entries.some(e => e.profileId === profileId)));
  const inMatches = new Set(data.matches.flatMap(m => m.entries.map(e => e.profileId)));
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Format" htmlFor="ct-m-format">
            <Select id="ct-m-format" value={formatId} onChange={e => setFormatId(e.target.value)}>
              <option value="">All formats</option>
              {data.formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Amiibo" htmlFor="ct-m-amiibo">
            <Select id="ct-m-amiibo" value={profileId} onChange={e => setProfileId(e.target.value)}>
              <option value="">Anyone</option>
              {ref_.profiles.filter(p => inMatches.has(p.id)).map(p => <option key={p.id} value={p.id}>{p.nickname}</option>)}
            </Select>
          </Field>
          <span className="text-sm text-night-400">{list.length} match{list.length === 1 ? "" : "es"}</span>
        </div>
      </Card>
      {list.length === 0 && <Notice title="No matches here yet" />}
      {list.slice(0, limit).map(m => <MatchCard key={m.id} ref_={ref_} data={data} match={m} />)}
      {list.length > limit && <Button onClick={() => setLimit(limit + 30)}>Show more</Button>}
    </div>
  );
}
