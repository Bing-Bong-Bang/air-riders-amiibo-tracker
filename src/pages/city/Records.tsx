// Two record books, kept apart like the game's Personal best screen:
//   Trial   — stadium results at the end of City Trial matches
//   Stadium — stadiums played from the Stadium menu, by rider count
// Plus the form to log a Stadium-menu run.

import { useState } from "react";
import type { FormEvent } from "react";
import { SCANNABLE_MACHINES, STADIUMS, STADIUM_BY_ID, STADIUM_TYPES, ordinal, stadiumRecords, trialRecords } from "../../domain/cityTrial";
import type { CtRecord, CtScores, StadiumRun } from "../../domain/cityTrial";
import type { ID } from "../../domain/schema";
import { deleteStadiumRun, saveStadiumRun } from "../../db/ctRepo";
import type { Reference } from "../../hooks/useReference";
import { newId, nowIso } from "../../lib/ids";
import { Checkbox, Field, NumberInput, SaveErrorNotice, Segmented, Select, TextArea } from "../../components/form";
import { Badge, Button, Card, CardHeader, Notice } from "../../components/ui";
import { AmiiboPicker, MachineSelect, PlaceSelect, ScoreInputs, StadiumSelect, fmtScore, machineName, scoresText } from "./bits";
import type { CtData } from "./data";

interface RunRow { machineId: string; scannedMachineId: string; place: number | null; scores: CtScores }

function StadiumRunForm({ ref_, onDone }: { ref_: Reference; onDone: () => void }) {
  const [stadiumId, setStadiumId] = useState<string | null>(null);
  const [players, setPlayers] = useState<number | null>(1);
  const [picks, setPicks] = useState<ID[]>([]);
  const [rows, setRows] = useState<Record<ID, RunRow>>({});
  const [counts, setCounts] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const stadium = stadiumId ? STADIUM_BY_ID.get(stadiumId) : undefined;
  const size = players ?? 1;
  const row = (id: ID): RunRow => rows[id] ?? { machineId: "", scannedMachineId: "", place: null, scores: {} };
  const patch = (id: ID, p: Partial<RunRow>) => setRows(r => ({ ...r, [id]: { ...row(id), ...p } }));
  const nameOf = (id: ID) => ref_.profileById.get(id)?.nickname ?? "?";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!stadiumId) { setError(new Error("Pick the stadium.")); return; }
    if (!picks.length) { setError(new Error("Pick the amiibo that played.")); return; }
    setBusy(true);
    try {
      await saveStadiumRun({
        stadiumId,
        playedAt: nowIso(),
        players: size,
        entries: picks.map(pid => {
          const r = row(pid);
          const scores = Object.fromEntries(Object.entries(r.scores).filter(([, v]) => typeof v === "number")) as CtScores;
          return {
            id: newId(), profileId: pid, snapshotId: ref_.snapshotsByProfile.get(pid)?.[0]?.id ?? "",
            riderId: ref_.profileById.get(pid)?.riderId ?? "",
            ...(r.machineId ? { machineId: r.machineId } : {}),
            ...(r.scannedMachineId ? { scannedMachineId: r.scannedMachineId } : {}),
            ...(size > 1 && r.place ? { place: r.place } : {}),
            scores,
          };
        }),
        includeInStats: counts,
        notes,
      });
      setSavedMsg(`${stadium?.name}: ${picks.map(pid => `${nameOf(pid)} ${scoresText(stadiumId, row(pid).scores) || "saved"}`).join(", ")}.`);
      setRows({});
      setNotes("");
      setResetKey(k => k + 1);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Log a Stadium-menu run" subtitle="A stadium played straight from the Stadium menu. These records stay separate from the ones set after a City Trial." action={<Button variant="ghost" onClick={onDone}>Close</Button>} />
      <form onSubmit={submit} className="space-y-4" key={resetKey}>
        {savedMsg && <Notice tone="ok" title="Saved">{savedMsg} Stadium and lineup are kept for the next one.</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Stadium" htmlFor="sr-stadium">
            <StadiumSelect id="sr-stadium" value={stadiumId} onChange={setStadiumId} allowNone={false} />
          </Field>
          <Field label="Riders in the stadium" htmlFor="sr-players" hint="1 = solo. Everyone, including ones you don't log.">
            <NumberInput id="sr-players" min={1} max={stadium?.maxPlayers ?? 8} value={players} onChange={setPlayers} />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-night-300">Amiibo</div>
          <AmiiboPicker
            ref_={ref_}
            picked={picks}
            max={stadium?.maxPlayers ?? 8}
            onChange={ids => { setPicks(ids); if (ids.length > size) setPlayers(ids.length); }}
          />
        </div>
        {picks.map(pid => (
          <div key={pid} className="space-y-3 rounded-xl border border-night-700 bg-night-850 p-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-32 flex-1 font-semibold">{nameOf(pid)}</div>
              {size > 1 && (
                <label className="space-y-1">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Place</span>
                  <PlaceSelect ariaLabel={`${nameOf(pid)} place`} size={size} value={row(pid).place} onChange={v => patch(pid, { place: v })} />
                </label>
              )}
              <label className="min-w-48 space-y-1">
                <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Machine</span>
                <MachineSelect ariaLabel={`${nameOf(pid)} machine`} value={row(pid).machineId} onChange={v => patch(pid, { machineId: v })} />
              </label>
              <label className="min-w-40 space-y-1">
                <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Scanned in with</span>
                <Select aria-label={`${nameOf(pid)} scanned in with`} value={row(pid).scannedMachineId} onChange={e => patch(pid, { scannedMachineId: e.target.value })}>
                  <option value="">Not noted</option>
                  {SCANNABLE_MACHINES.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </Select>
              </label>
            </div>
            {stadium ? <ScoreInputs stadium={stadium} value={row(pid).scores} onChange={v => patch(pid, { scores: v })} who={nameOf(pid)} /> : <p className="text-sm text-night-400">Pick the stadium to log a score.</p>}
          </div>
        ))}
        <Checkbox checked={counts} onChange={setCounts} label="Counts in records" />
        <Field label="Notes" htmlFor="sr-notes"><TextArea id="sr-notes" value={notes} onChange={e => setNotes(e.target.value)} /></Field>
        <SaveErrorNotice error={error} />
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save run"}</Button>
      </form>
    </Card>
  );
}

function RecordTable({ ref_, records, showPlayers }: { ref_: Reference; records: CtRecord[]; showPlayers: boolean }) {
  if (!records.length) return <Notice title="No records yet">Log a score in a stadium and it appears here.</Notice>;
  const order = new Map(STADIUMS.map((s, i) => [s.id, i]));
  const sorted = [...records].sort((a, b) => (order.get(a.stadiumId) ?? 0) - (order.get(b.stadiumId) ?? 0) || (a.players ?? 0) - (b.players ?? 0));
  const byType = STADIUM_TYPES.map(t => ({ type: t, rows: sorted.filter(r => STADIUM_BY_ID.get(r.stadiumId)?.type === t) })).filter(g => g.rows.length);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead className="border-b border-night-700 text-xs uppercase tracking-wider text-night-300">
          <tr>
            <th className="px-2 py-2 text-left">Stadium</th>
            {showPlayers && <th className="px-2 py-2 text-left">Riders</th>}
            <th className="px-2 py-2 text-right">Record</th>
            <th className="px-2 py-2 text-left">Held by</th>
            <th className="px-2 py-2 text-left">Machine</th>
            <th className="px-2 py-2 text-left">Date</th>
          </tr>
        </thead>
        {byType.map(g => (
          <tbody key={g.type}>
            <tr><th colSpan={showPlayers ? 6 : 5} className="px-2 pt-3 pb-1 text-left text-xs font-semibold uppercase tracking-wider text-night-400">{g.type}</th></tr>
            {g.rows.map(r => (
              <tr key={`${r.stadiumId}|${r.score.label}|${r.players ?? ""}`} className="border-t border-night-800">
                <td className="px-2 py-1.5">{STADIUM_BY_ID.get(r.stadiumId)?.name}{STADIUM_BY_ID.get(r.stadiumId)!.scores.length > 1 && <span className="text-xs text-night-400"> · {r.score.label}</span>}</td>
                {showPlayers && <td className="px-2 py-1.5">{r.players === 1 ? <Badge tone="air">Solo</Badge> : `${r.players}`}</td>}
                <td className="px-2 py-1.5 text-right font-semibold tabular">{fmtScore(r.score.kind, r.value, r.score.label)}</td>
                <td className="px-2 py-1.5">{ref_.profileById.get(r.profileId)?.nickname ?? "?"}</td>
                <td className="px-2 py-1.5 text-night-300">{r.machineId ? machineName(r.machineId) : "—"}</td>
                <td className="px-2 py-1.5 text-night-400">{new Date(r.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function RunList({ ref_, runs }: { ref_: Reference; runs: StadiumRun[] }) {
  const [limit, setLimit] = useState(15);
  const [confirm, setConfirm] = useState<ID | null>(null);
  if (!runs.length) return null;
  return (
    <Card>
      <CardHeader title="Stadium-menu runs" subtitle="Newest first" />
      <ul className="divide-y divide-night-800 text-sm">
        {runs.slice(0, limit).map(r => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="w-40 font-semibold">{STADIUM_BY_ID.get(r.stadiumId)?.name}</span>
            <span className="text-night-400">{r.players === 1 ? "Solo" : `${r.players} riders`}</span>
            <span className="flex-1">
              {r.entries.map(e => `${e.place ? `${ordinal(e.place)} ` : ""}${ref_.profileById.get(e.profileId)?.nickname ?? "?"} ${scoresText(r.stadiumId, e.scores)}${e.machineId ? ` (${machineName(e.machineId)})` : ""}${e.scannedMachineId ? `, scanned with ${machineName(e.scannedMachineId)}` : ""}`).join(" · ")}
            </span>
            {!r.includeInStats && <Badge>Not in records</Badge>}
            <span className="text-xs text-night-400">{new Date(r.playedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            {confirm === r.id
              ? <><Button variant="danger" onClick={() => void deleteStadiumRun(r.id)}>Delete</Button><Button variant="ghost" onClick={() => setConfirm(null)}>Keep</Button></>
              : <Button variant="ghost" className="hover:text-bad-400" onClick={() => setConfirm(r.id)}>Delete…</Button>}
          </li>
        ))}
      </ul>
      {runs.length > limit && <Button className="mt-2" onClick={() => setLimit(limit + 15)}>Show more</Button>}
    </Card>
  );
}

export function Records({ ref_, data }: { ref_: Reference; data: CtData }) {
  const [book, setBook] = useState<"trial" | "stadium">("trial");
  const [players, setPlayers] = useState<"all" | "solo" | "group">("all");
  const [logging, setLogging] = useState(false);
  const trial = trialRecords(data.matches.filter(m => m.includeInStats));
  const stadium = stadiumRecords(data.runs.filter(r => r.includeInStats))
    .filter(r => players === "all" || (players === "solo" ? r.players === 1 : (r.players ?? 1) > 1));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented label="Record book" value={book} onChange={setBook} options={[{ value: "trial", label: "Trial (after City Trial)" }, { value: "stadium", label: "Stadium (from the menu)" }]} />
        {!logging && <Button variant="primary" onClick={() => { setLogging(true); setBook("stadium"); }}>Log a Stadium-menu run</Button>}
      </div>
      {logging && <StadiumRunForm ref_={ref_} onDone={() => setLogging(false)} />}
      <Card>
        {book === "trial" ? (
          <>
            <CardHeader title="Trial records" subtitle="Best scores in each stadium at the end of a City Trial match, after collecting stats. Logged from the More section of a match." />
            <RecordTable ref_={ref_} records={trial} showPlayers={false} />
          </>
        ) : (
          <>
            <CardHeader
              title="Stadium records"
              subtitle="Best scores from the Stadium menu, kept separately for each number of riders, so a solo boss time never competes with a 4-rider one."
              action={<Segmented label="Riders" value={players} onChange={setPlayers} options={[{ value: "all", label: "All" }, { value: "solo", label: "Solo" }, { value: "group", label: "With others" }]} />}
            />
            <RecordTable ref_={ref_} records={stadium} showPlayers />
          </>
        )}
      </Card>
      {book === "stadium" && <RunList ref_={ref_} runs={data.runs} />}
    </div>
  );
}
