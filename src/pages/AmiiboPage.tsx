import { useState } from "react";
import type { FormEvent } from "react";
import { getAll } from "../db/database";
import { createProfile, setProfileStatus, updateProfile } from "../db/repo";
import type { FigurePlayerProfile, FigurePlayerSnapshot, ID } from "../domain/schema";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { snapshotLabel, useReference } from "../hooks/useReference";
import type { Reference } from "../hooks/useReference";
import { useMode } from "../lib/mode";
import { Link, navigate } from "../lib/router";
import { Checkbox, Field, SaveErrorNotice, Select, TextArea, TextInput } from "../components/form";
import { Badge, Button, Card, CardHeader, Notice, Spinner, cx } from "../components/ui";
import { ProficiencyLine } from "../components/ProficiencyEditor";

// -------------------------------------------------------------
// Profile fields (shared by "new" and "edit")
// -------------------------------------------------------------

interface ProfileDraft {
  nickname: string;
  personality: string;
  trainingGoal: string;
  notes: string;
  isBaseline: boolean;
}

function ProfileFields({ d, set, idPrefix }: { d: ProfileDraft; set: (d: ProfileDraft) => void; idPrefix: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="The name you registered in-game" htmlFor={`${idPrefix}-name`}>
          <TextInput id={`${idPrefix}-name`} placeholder="Squeakers" value={d.nickname} onChange={e => set({ ...d, nickname: e.target.value })} />
        </Field>
        <Field label="Personality" hint="The personality the game assigned it" htmlFor={`${idPrefix}-personality`}>
          <TextInput id={`${idPrefix}-personality`} value={d.personality} onChange={e => set({ ...d, personality: e.target.value })} />
        </Field>
      </div>
      <div className="rounded-xl border border-night-700 p-3">
        <Checkbox
          checked={d.isBaseline}
          onChange={v => set({ ...d, isBaseline: v, personality: v && !d.personality.trim() ? "Balanced" : d.personality })}
          label="Baseline amiibo (Balanced)"
          hint="Trained to level 50 with learning off, so it races like the default AI. Your trained amiibo of the same character are compared against it, and it's left out of Rankings and Best picks unless you include it."
        />
      </div>
      <Field label="Training goal (optional)" htmlFor={`${idPrefix}-goal`}>
        <TextInput id={`${idPrefix}-goal`} placeholder="Pure racer, no attacking" value={d.trainingGoal} onChange={e => set({ ...d, trainingGoal: e.target.value })} />
      </Field>
      <Field label="About this amiibo (optional)" htmlFor={`${idPrefix}-notes`}>
        <TextArea id={`${idPrefix}-notes`} value={d.notes} onChange={e => set({ ...d, notes: e.target.value })} />
      </Field>
    </>
  );
}

// -------------------------------------------------------------
// New amiibo
// -------------------------------------------------------------

function NewProfileForm({ ref_, onDone }: { ref_: Reference; onDone: () => void }) {
  const [riderId, setRiderId] = useState("");
  const [d, setD] = useState<ProfileDraft>({ nickname: "", personality: "", trainingGoal: "", notes: "", isBaseline: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!riderId) return setError(new Error("Pick which rider this amiibo is."));
    if (!d.nickname.trim()) return setError(new Error("Give the amiibo its in-game name."));
    setBusy(true);
    try {
      await createProfile({ riderId, ...d });
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-air-500/40">
      <form onSubmit={submit} className="space-y-5">
        <CardHeader title="New amiibo" subtitle="Assumed fully trained: level 50 and maxed on every machine. You can lower machine proficiency on its card later." />
        <Field label="Rider" htmlFor="np-rider" className="sm:max-w-sm"
          hint={ref_.riderById.get(riderId)?.amiiboFigure === "Kirby" ? "Kirby's color decides its special." : undefined}>
          <Select id="np-rider" value={riderId} onChange={e => setRiderId(e.target.value)}>
            <option value="">Choose…</option>
            {ref_.riders.map(r => <option key={r.id} value={r.id}>{r.name}{r.amiiboFigure === "Kirby" && r.description ? ` · ${r.description}` : ""}</option>)}
          </Select>
        </Field>
        <ProfileFields d={d} set={setD} idPrefix="np" />
        <SaveErrorNotice error={error} />
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={busy}>{busy ? "Saving…" : "Save amiibo"}</Button>
          <Button variant="ghost" onClick={onDone} disabled={busy}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

// -------------------------------------------------------------
// One amiibo
// -------------------------------------------------------------

function EditProfileForm({ profile, latest, onDone }: { profile: FigurePlayerProfile; latest: FigurePlayerSnapshot | undefined; onDone: () => void }) {
  const [d, setD] = useState<ProfileDraft>({
    nickname: profile.nickname, personality: profile.personality ?? "", trainingGoal: profile.trainingGoal ?? "", notes: profile.notes ?? "",
    isBaseline: !!profile.isBaseline,
  });
  const [startVersion, setStartVersion] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const before = profile.personality ?? "";
  const personalityChanged = d.personality.trim() !== before.trim();
  const next = (latest?.version ?? 0) + 1;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!d.nickname.trim()) return setError(new Error("The name can't be empty."));
    setBusy(true);
    setError(null);
    const change = `Retrained: personality ${before.trim() || "not set"} → ${d.personality.trim() || "not set"}`;
    try {
      await updateProfile(profile.id, d, personalityChanged && startVersion ? { trainingSinceLast: change } : undefined);
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-4 space-y-4 rounded-xl border border-night-700 p-4">
      <ProfileFields d={d} set={setD} idPrefix={`ep-${profile.id}`} />
      {personalityChanged && (
        <div className="rounded-xl border border-star-400/30 bg-star-400/5 p-3">
          <Checkbox
            checked={startVersion}
            onChange={setStartVersion}
            label={`It was retrained: start version ${next}`}
            hint={`Races logged from now on count as v${next}, so they can be compared with v${next - 1} instead of being mixed together.`}
          />
        </div>
      )}
      <SaveErrorNotice error={error} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy}>Save</Button>
        <Button variant="ghost" onClick={onDone} disabled={busy}>Cancel</Button>
      </div>
    </form>
  );
}

/** Two-step retire: open this panel, then type the amiibo's name to confirm. */
function RetireConfirm({ profile, totalRaces, onCancel }: { profile: FigurePlayerProfile; totalRaces: number; onCancel: () => void }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim().toLowerCase() === profile.nickname.trim().toLowerCase();
  const retire = async () => {
    setBusy(true);
    setError(null);
    try { await setProfileStatus(profile.id, "retired"); } catch (err) { setError(err); setBusy(false); }
  };
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-bad-400/40 bg-bad-400/5 p-4" role="alertdialog" aria-label={`Retire ${profile.nickname}`}>
      <h3 className="font-semibold text-bad-400">Retire {profile.nickname}?</h3>
      <p className="text-sm text-night-300">
        It will be hidden from race entry. Its {totalRaces} logged race{totalRaces === 1 ? "" : "s"} stay saved and keep counting in stats.
        You can reactivate it later from "Show retired".
      </p>
      <Field label={`Type ${profile.nickname} to confirm`} htmlFor={`rt-${profile.id}`} className="sm:max-w-xs">
        <TextInput id={`rt-${profile.id}`} autoComplete="off" value={typed} onChange={e => setTyped(e.target.value)} />
      </Field>
      <SaveErrorNotice error={error} />
      <div className="flex gap-2">
        <Button variant="danger" onClick={retire} disabled={!matches || busy}>{busy ? "Retiring…" : "Retire"}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Keep it</Button>
      </div>
    </div>
  );
}

function ProfileCard({ profile, ref_, raceCounts }: {
  profile: FigurePlayerProfile; ref_: Reference; raceCounts: { air_ride: number; top_ride: number };
}) {
  const [panel, setPanel] = useState<"none" | "edit" | "retire">("none");
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const versions = ref_.snapshotsByProfile.get(profile.id) ?? [];
  const latest = versions[0];
  const rider = ref_.riderById.get(profile.riderId);
  const retired = profile.status === "retired";

  const reactivate = async () => {
    setError(null);
    try { await setProfileStatus(profile.id, "active"); } catch (err) { setError(err); }
  };

  return (
    <Card className={cx(retired && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">
            <Link to="stats" params={{ profile: profile.id }} className="hover:text-air-400" title={`Open ${profile.nickname}'s stats`}>{profile.nickname}</Link>
          </h2>
          <p className="text-sm text-night-300">
            {rider?.name ?? "Unknown rider"} · <Link to="stats" params={{ profile: profile.id }} className="text-air-400 hover:underline">View stats →</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {profile.isBaseline && <Badge tone="star">Baseline</Badge>}
          {retired && <Badge tone="bad">Retired</Badge>}
          <Badge tone="air">AR {raceCounts.air_ride}</Badge>
          <Badge tone="top">TR {raceCounts.top_ride}</Badge>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-night-400">Personality</dt>
        <dd className={profile.personality ? "font-medium" : "text-night-400"}>{profile.personality ?? "Not set"}</dd>
        {profile.trainingGoal && <><dt className="text-night-400">Goal</dt><dd>{profile.trainingGoal}</dd></>}
        {latest && <><dt className="text-night-400">Version</dt><dd>{snapshotLabel(latest)}</dd></>}
      </dl>
      {profile.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-night-300">{profile.notes}</p>}
      {!retired && <ProficiencyLine profile={profile} />}

      <div className="mt-4 flex flex-wrap gap-2">
        {!retired && <Button onClick={() => navigate("log", { amiibo: profile.id })}>New data entry</Button>}
        <Button variant="ghost" onClick={() => navigate("stats", { profile: profile.id })}>Stats</Button>
        <Button variant="ghost" onClick={() => setPanel(panel === "edit" ? "none" : "edit")}>Edit</Button>
        {versions.length > 1 && (
          <Button variant="ghost" onClick={() => setShowHistory(!showHistory)} aria-expanded={showHistory}>
            {showHistory ? "Hide" : "Show"} versions ({versions.length})
          </Button>
        )}
        {retired
          ? <Button variant="ghost" onClick={reactivate}>Reactivate</Button>
          : <Button variant="ghost" className="hover:text-bad-400" onClick={() => setPanel(panel === "retire" ? "none" : "retire")}>Retire…</Button>}
      </div>
      <div className="mt-3"><SaveErrorNotice error={error} /></div>

      {panel === "edit" && <EditProfileForm profile={profile} latest={latest} onDone={() => setPanel("none")} />}
      {panel === "retire" && !retired && (
        <RetireConfirm profile={profile} totalRaces={raceCounts.air_ride + raceCounts.top_ride} onCancel={() => setPanel("none")} />
      )}

      {showHistory && (
        <ol className="mt-4 space-y-2">
          {versions.map(s => (
            <li key={s.id} className="rounded-xl bg-night-850 px-4 py-3 text-sm">
              <span className="font-semibold">{snapshotLabel(s)}</span>
              {s.trainingSinceLast && <p className="mt-1 text-night-300">{s.trainingSinceLast}</p>}
              {!s.trainingSinceLast && s.version === 1 && <p className="mt-1 text-night-400">First version</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

// -------------------------------------------------------------

export function AmiiboPage() {
  const { mode } = useMode();
  const { data: ref_, error, loading } = useReference(mode);
  const counts = useLiveQuery(async () => {
    const races = await getAll("races");
    const map = new Map<ID, { air_ride: number; top_ride: number }>();
    for (const r of races) {
      for (const e of r.entries) {
        if (e.racer.kind !== "amiibo") continue;
        const c = map.get(e.racer.profileId) ?? { air_ride: 0, top_ride: 0 };
        c[r.mode]++;
        map.set(e.racer.profileId, c);
      }
    }
    return map;
  }, [], ["races"]);
  const [creating, setCreating] = useState(false);
  const [showRetired, setShowRetired] = useState(false);

  if (error) return <Notice tone="bad" title="Couldn't load your amiibo">{error.message}</Notice>;
  if (loading || !ref_) return <Spinner />;

  const active = ref_.profiles.filter(p => p.status === "active");
  const retired = ref_.profiles.filter(p => p.status === "retired");
  const zero = { air_ride: 0, top_ride: 0 };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Amiibo</h1>
          <p className="mt-1 text-night-300">Each trained amiibo is a profile. If a retrain changes its personality, editing it starts a new version so old and new results stay separate.</p>
        </div>
        {!creating && <Button variant="primary" onClick={() => setCreating(true)}>New amiibo</Button>}
      </div>

      {creating && <NewProfileForm ref_={ref_} onDone={() => setCreating(false)} />}

      {active.length === 0 && !creating && (
        <Notice title="No amiibo yet">Add your first amiibo to start logging races.</Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {active.map(p => <ProfileCard key={p.id} profile={p} ref_={ref_} raceCounts={counts.data?.get(p.id) ?? zero} />)}
      </div>

      {retired.length > 0 && (
        <div>
          <Button variant="ghost" onClick={() => setShowRetired(!showRetired)} aria-expanded={showRetired}>
            {showRetired ? "Hide" : "Show"} retired ({retired.length})
          </Button>
          {showRetired && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {retired.map(p => <ProfileCard key={p.id} profile={p} ref_={ref_} raceCounts={counts.data?.get(p.id) ?? zero} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
