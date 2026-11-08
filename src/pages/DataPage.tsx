import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { buildExport, checkCurrentData, checkImport, exportFileName, replaceAllData } from "../db/backup";
import type { ImportCheck } from "../db/backup";
import { count, getById } from "../db/database";
import { setGameVersion } from "../db/repo";
import { resetToSeed } from "../db/seed";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { downloadJson, readFileText } from "../lib/download";
import {
  chooseSaveFile, confirmOpenSaveFile, isFileSaveSupported, linkIsSessionOnly, pickSaveFileToOpen, resumeFileSave, saveNow, stopFileSave, useFileSave,
} from "../lib/fileSave";
import type { OpenedSaveFile } from "../lib/fileSave";
import { Badge, Button, Card, CardHeader, Notice, StatTile } from "../components/ui";

const STAGE_LABEL: Record<Exclude<ImportCheck, { ok: true }>["stage"], string> = {
  read: "The file couldn't be read",
  version: "Version problem",
  schema: "Some records are malformed",
  integrity: "The data doesn't hang together",
};

const COUNT_LABELS: [keyof Extract<ImportCheck, { ok: true }>["summary"]["counts"], string][] = [
  ["races", "Races"], ["sessions", "Sessions"], ["runs", "Runs"], ["figurePlayerProfiles", "Amiibo profiles"],
  ["figurePlayerSnapshots", "Snapshots"], ["formats", "Formats"], ["stages", "Stages"], ["incidentTags", "Incident tags"],
  ["ctMatches", "City Trial matches"], ["stadiumRuns", "Stadium runs"],
];

async function downloadBackup(): Promise<void> {
  downloadJson(exportFileName(), await buildExport());
}

function ProblemList({ problems }: { problems: string[] }) {
  return (
    <ul className="mt-2 max-h-64 list-disc space-y-1 overflow-y-auto pl-5 text-night-300">
      {problems.map((p, i) => <li key={i}>{p}</li>)}
    </ul>
  );
}

// -------------------------------------------------------------

function ExportCard() {
  const { data } = useLiveQuery(async () => {
    const [races, trials, profiles] = await Promise.all([count("races"), count("sessions"), count("figurePlayerProfiles")]);
    return { races, trials, profiles };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onExport = async () => {
    setBusy(true);
    setError(null);
    try { await downloadBackup(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Back up" subtitle="Download everything (both modes) as one JSON file." />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatTile label="Races" value={data?.races ?? "…"} />
        <StatTile label="Sessions" value={data?.trials ?? "…"} />
        <StatTile label="Amiibo" value={data?.profiles ?? "…"} />
      </div>
      <Button variant="primary" onClick={onExport} disabled={busy}>{busy ? "Preparing…" : "Download backup"}</Button>
      {error && <div className="mt-3"><Notice tone="bad" title="Backup failed">{error}</Notice></div>}
    </Card>
  );
}

// -------------------------------------------------------------

function ImportCard() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [check, setCheck] = useState<ImportCheck | null>(null);
  const [backupFirst, setBackupFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setResult(null);
    setFileName(file.name);
    try {
      setCheck(checkImport(await readFileText(file)));
    } catch (e) {
      setCheck({ ok: false, stage: "read", problems: [(e as Error).message] });
    }
  };

  const onReplace = async () => {
    if (!check?.ok) return;
    if (!window.confirm("Replace ALL data in the tracker with this file? This can't be undone.")) return;
    setBusy(true);
    setResult(null);
    try {
      if (backupFirst) await downloadBackup();
      await replaceAllData(check.file);
      setResult({ tone: "ok", text: "Import complete. Your data now matches the file." });
      setCheck(null);
      setFileName(null);
    } catch (e) {
      setResult({ tone: "bad", text: `Nothing was changed. ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Restore from a backup" subtitle="The file is fully checked before anything changes." />
      <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={onPick} />
      <Button onClick={() => inputRef.current?.click()} disabled={busy}>Choose backup file…</Button>
      {fileName && <span className="ml-3 text-sm text-night-300">{fileName}</span>}

      {check && !check.ok && (
        <div className="mt-4">
          <Notice tone="bad" title={STAGE_LABEL[check.stage]}>
            Your current data is untouched.
            <ProblemList problems={check.problems} />
          </Notice>
        </div>
      )}

      {check?.ok && (
        <div className="mt-4 space-y-4">
          <Notice tone="ok" title="File checked: no problems found">
            Exported {new Date(check.summary.exportedAt).toLocaleString()}.
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="air">Air Ride races: {check.summary.racesByMode.air_ride}</Badge>
              <Badge tone="top">Top Ride races: {check.summary.racesByMode.top_ride}</Badge>
            </div>
          </Notice>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            {COUNT_LABELS.map(([key, label]) => (
              <div key={key} className="flex justify-between gap-2 border-b border-night-800 py-1">
                <dt className="text-night-400">{label}</dt>
                <dd className="tabular">{check.summary.counts[key]}</dd>
              </div>
            ))}
          </dl>
          <label className="flex items-center gap-2 text-sm text-night-300">
            <input type="checkbox" checked={backupFirst} onChange={e => setBackupFirst(e.target.checked)} className="h-4 w-4 accent-air-500" />
            Download a backup of my current data first
          </label>
          <div className="flex gap-2">
            <Button variant="danger" onClick={onReplace} disabled={busy}>{busy ? "Importing…" : "Replace all my data"}</Button>
            <Button variant="ghost" onClick={() => { setCheck(null); setFileName(null); }} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {result && <div className="mt-4"><Notice tone={result.tone} title={result.tone === "ok" ? "Done" : "Import failed"}>{result.text}</Notice></div>}
    </Card>
  );
}

// -------------------------------------------------------------

function IntegrityCard() {
  const [problems, setProblems] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try { setProblems(await checkCurrentData()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Check my data" subtitle="Looks for broken links, results filed under the wrong mode, and rule violations." />
      <Button onClick={run} disabled={busy}>{busy ? "Checking…" : "Run check"}</Button>
      {error && <div className="mt-4"><Notice tone="bad" title="Check failed">{error}</Notice></div>}
      {problems && (
        <div className="mt-4">
          {problems.length === 0
            ? <Notice tone="ok" title="No problems found" />
            : <Notice tone="bad" title={`${problems.length} problem${problems.length === 1 ? "" : "s"} found`}><ProblemList problems={problems} /></Notice>}
        </div>
      )}
    </Card>
  );
}

// -------------------------------------------------------------

function StorageCard() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const supported = typeof navigator !== "undefined" && !!navigator.storage?.persist;

  const refresh = async () => {
    if (!supported) return;
    setPersisted(await navigator.storage.persisted());
    const est = await navigator.storage.estimate();
    if (est.usage !== undefined) setUsage(`${(est.usage / 1024 / 1024).toFixed(1)} MB used`);
  };
  useEffect(() => { void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const request = async () => {
    await navigator.storage.persist();
    await refresh();
  };

  return (
    <Card>
      <CardHeader
        title="Storage protection"
        subtitle="Browsers may clear site data when disk space runs low unless it's protected."
        action={persisted === null ? null : persisted ? <Badge tone="ok">Protected</Badge> : <Badge tone="bad">Not protected</Badge>}
      />
      {!supported && <Notice>This browser can't protect storage. Keep regular backups.</Notice>}
      {supported && (
        <div className="flex flex-wrap items-center gap-3">
          {!persisted && <Button onClick={request}>Protect my data</Button>}
          {usage && <span className="text-sm text-night-400">{usage}</span>}
        </div>
      )}
      <p className="mt-3 text-sm text-night-400">The save file above is your copy outside the browser. Without one, download a backup regularly.</p>
    </Card>
  );
}

// -------------------------------------------------------------

function ResetCard() {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const onReset = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await downloadBackup();
      await resetToSeed();
      setTyped("");
      setMessage({ tone: "ok", text: "All data erased and the starting roster restored. A backup of what was erased was downloaded." });
    } catch (e) {
      setMessage({ tone: "bad", text: `Nothing was erased. ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-bad-400/30">
      <CardHeader title="Erase everything" subtitle="Deletes all races, sessions and amiibo, and restores the starting roster and stages. A backup downloads first." />
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-night-300">
          Type <span className="font-mono font-semibold text-night-100">ERASE</span> to confirm{" "}
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            className="ml-2 w-28 rounded-lg border border-night-600 bg-night-850 px-2 py-1 font-mono text-night-100"
            aria-label="Type ERASE to confirm"
          />
        </label>
        <Button variant="danger" onClick={onReset} disabled={typed !== "ERASE" || busy}>{busy ? "Erasing…" : "Erase all data"}</Button>
      </div>
      {message && <div className="mt-4"><Notice tone={message.tone}>{message.text}</Notice></div>}
    </Card>
  );
}

// -------------------------------------------------------------

function SaveFileCard() {
  const s = useFileSave();
  const [opened, setOpened] = useState<OpenedSaveFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const supported = isFileSaveSupported();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null); setDone(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const linked = s.kind === "saved" || s.kind === "saving" || s.kind === "needs_permission" || s.kind === "error";

  return (
    <Card className={s.kind === "saved" ? "border-ok-400/40" : "border-star-400/40"}>
      <CardHeader
        title="Save file on your computer"
        subtitle="Every change is written to a file you choose, so your data never lives only in the browser."
        action={s.kind === "saved" ? <Badge tone="ok">Auto-saving</Badge> : linked ? <Badge tone="star">Paused</Badge> : <Badge tone="bad">Off</Badge>}
      />
      {!supported ? (
        <Notice title="This browser can't save to a file automatically">
          Open the tracker in <strong>Chrome</strong> or <strong>Edge</strong> to turn on automatic saving. In this browser, use Download backup below regularly.
        </Notice>
      ) : (
        <div className="space-y-4">
          {s.kind === "off" && (
            <p className="text-sm text-night-300">
              Choose where to keep your data, for example <span className="font-mono text-night-100">Documents\air-riders-data.json</span>.
              It's a normal backup file, always up to date. If this browser ever loses its data, use <strong>Open a save file</strong> to get everything back.
            </p>
          )}
          {s.kind === "saved" && <p className="text-sm text-night-300">Saving every change to <span className="font-mono text-night-100">{s.fileName}</span>. Last saved {s.savedAt.toLocaleTimeString()}.</p>}
          {linkIsSessionOnly() && (
            <p className="text-xs text-night-400">This browser can't remember the save file between sessions, so choose it again each time you open the tracker. Pick the same file and it's simply kept up to date.</p>
          )}
          {s.kind === "saving" && <p className="text-sm text-night-300">Saving to <span className="font-mono text-night-100">{s.fileName}</span>…</p>}
          {s.kind === "needs_permission" && (
            <Notice title={`Saving to ${s.fileName} is paused`}>Chrome asks for your OK again after it restarts. Click Resume, then choose "Allow on every visit" if it's offered.</Notice>
          )}
          {s.kind === "error" && (
            <Notice tone="bad" title={`Couldn't save to ${s.fileName}`}>{s.message} The file may have been moved, renamed or opened elsewhere. Try Save now, or choose the file again.</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            {s.kind === "off" && <Button variant="primary" disabled={busy} onClick={() => void run(async () => { if (await chooseSaveFile()) setDone("Saving to your file is on."); })}>Choose save file…</Button>}
            {s.kind === "needs_permission" && <Button variant="primary" disabled={busy} onClick={() => void run(resumeFileSave)}>Resume saving</Button>}
            {(s.kind === "saved" || s.kind === "error") && <Button disabled={busy} onClick={() => void run(saveNow)}>Save now</Button>}
            {linked && <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { if (await chooseSaveFile()) setDone("Now saving to the new file."); })}>Use a different file…</Button>}
            <Button variant="ghost" disabled={busy} onClick={() => void run(async () => { setOpened(await pickSaveFileToOpen()); })}>Open a save file…</Button>
            {linked && <Button variant="ghost" disabled={busy} onClick={() => void run(stopFileSave)}>Stop saving to file</Button>}
          </div>

          {opened && !opened.check.ok && (
            <Notice tone="bad" title={`${opened.fileName} can't be opened`}><ProblemList problems={opened.check.problems} /></Notice>
          )}
          {opened?.check.ok && (
            <Notice title={`Open ${opened.fileName}?`}>
              It has {opened.check.summary.counts.races} races and {opened.check.summary.counts.figurePlayerProfiles} amiibo (saved {new Date(opened.check.summary.exportedAt).toLocaleString()}).
              This <strong>replaces</strong> what's in the browser now, then keeps saving to this file.
              <div className="mt-3 flex gap-2">
                <Button variant="danger" disabled={busy} onClick={() => void run(async () => { await confirmOpenSaveFile(opened); setOpened(null); setDone(`Loaded ${opened.fileName}. Saving to it from now on.`); })}>Replace and open</Button>
                <Button variant="ghost" disabled={busy} onClick={() => setOpened(null)}>Cancel</Button>
              </div>
            </Notice>
          )}
          {error && <Notice tone="bad" title="Something went wrong">{error}</Notice>}
          {done && <Notice tone="ok" title="Done">{done}</Notice>}
        </div>
      )}
    </Card>
  );
}

function GameVersionCard() {
  const { data: settings } = useLiveQuery(() => getById("settings", "settings"), [], ["settings"]);
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const current = settings?.gameVersion ?? "";
  const shown = value ?? current;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setMessage(null);
    try {
      await setGameVersion(shown);
      setValue(null);
      setMessage({ tone: "ok", text: `New races will be recorded as version ${shown.trim().replace(/^ver\.?\s*/i, "")}.` });
    } catch (err) {
      setMessage({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Game version"
        subtitle="Every race is stamped with the game version it was played on, so a balance patch can't quietly mix old and new results."
        action={current ? <Badge tone="star">Ver. {current}</Badge> : null}
      />
      <form onSubmit={save} className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="block text-xs font-semibold uppercase tracking-wider text-night-300">Current version</span>
          <input
            value={shown}
            onChange={e => setValue(e.target.value)}
            placeholder="1.3.4"
            aria-label="Current game version"
            className="w-32 rounded-xl border border-night-600 bg-night-850 px-3 py-2 font-mono text-sm text-night-100"
          />
        </label>
        <Button type="submit" disabled={busy || shown.trim() === current}>Save</Button>
        <span className="text-sm text-night-400">When the game updates, change this. Rankings and Best picks can then show one version or all.</span>
      </form>
      {message && <div className="mt-3"><Notice tone={message.tone}>{message.text}</Notice></div>}
    </Card>
  );
}

export function DataPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Data</h1>
        <p className="mt-1 text-night-300">Your data is kept in this browser and, once you choose one, in a save file on your computer. Backups cover both modes.</p>
      </div>
      <SaveFileCard />
      <GameVersionCard />
      <div className="grid gap-6 lg:grid-cols-2">
        <ExportCard />
        <StorageCard />
      </div>
      <ImportCard />
      <IntegrityCard />
      <ResetCard />
    </div>
  );
}
