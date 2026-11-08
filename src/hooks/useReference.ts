import { getAll, getById } from "../db/database";
import type {
  AppSettings, FigurePlayerProfile, FigurePlayerSnapshot, Format, ID, IncidentTag, Machine, Rider,
  Stage, TrackedMode,
} from "../domain/schema";
import { useLiveQuery } from "./useLiveQuery";
import type { LiveQueryResult } from "./useLiveQuery";

export interface Reference {
  settings: AppSettings | undefined;
  riders: Rider[];              // sorted, game order
  machines: Machine[];          // sorted, game order
  /** Stages and formats of the current mode only. */
  stages: Stage[];
  formats: Format[];
  profiles: FigurePlayerProfile[];
  snapshots: FigurePlayerSnapshot[];
  tags: IncidentTag[];
  riderById: Map<ID, Rider>;
  machineById: Map<ID, Machine>;
  stageById: Map<ID, Stage>;
  formatById: Map<ID, Format>;
  profileById: Map<ID, FigurePlayerProfile>;
  snapshotById: Map<ID, FigurePlayerSnapshot>;
  /** Snapshots of each profile, newest version first. */
  snapshotsByProfile: Map<ID, FigurePlayerSnapshot[]>;
}

const bySort = <T extends { sortOrder: number }>(a: T, b: T) => a.sortOrder - b.sortOrder;

export async function loadReference(mode: TrackedMode): Promise<Reference> {
  const [settings, riders, machines, stages, formats, profiles, snapshots, tags] = await Promise.all([
    getById("settings", "settings"), getAll("riders"), getAll("machines"), getAll("stages"),
    getAll("formats"), getAll("figurePlayerProfiles"), getAll("figurePlayerSnapshots"), getAll("incidentTags"),
  ]);
  const modeStages = stages.filter(s => s.mode === mode).sort(bySort);
  const modeFormats = formats.filter(f => f.mode === mode).sort((a, b) => a.name.localeCompare(b.name));
  const snapshotsByProfile = new Map<ID, FigurePlayerSnapshot[]>();
  for (const s of snapshots) snapshotsByProfile.set(s.profileId, [...(snapshotsByProfile.get(s.profileId) ?? []), s]);
  for (const list of snapshotsByProfile.values()) list.sort((a, b) => b.version - a.version);
  const map = <T extends { id: ID }>(rows: T[]) => new Map(rows.map(r => [r.id, r]));

  return {
    settings,
    riders: riders.sort(bySort),
    machines: machines.sort(bySort),
    stages: modeStages,
    formats: modeFormats,
    profiles: profiles.sort((a, b) => a.nickname.localeCompare(b.nickname)),
    snapshots,
    tags: tags.filter(t => !t.isArchived),
    riderById: map(riders),
    machineById: map(machines),
    stageById: map(stages),
    formatById: map(formats),
    profileById: map(profiles),
    snapshotById: map(snapshots),
    snapshotsByProfile,
  };
}

export function useReference(mode: TrackedMode): LiveQueryResult<Reference> {
  return useLiveQuery(() => loadReference(mode), [mode], [
    "settings", "riders", "machines", "stages", "formats", "figurePlayerProfiles", "figurePlayerSnapshots", "incidentTags",
  ]);
}

/** "v3 · Nov 2, 2026" */
export function snapshotLabel(s: FigurePlayerSnapshot): string {
  const date = new Date(s.takenAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `v${s.version} · ${date}`;
}

/**
 * Amiibo name, plus the special when it raced as a Kirby color:
 * "Squeakers (Crash)". Other riders just give the name.
 */
export function racerLabel(ref_: Reference, profileId: ID, riderId: ID): string {
  const name = ref_.profileById.get(profileId)?.nickname ?? "?";
  const rider = ref_.riderById.get(riderId);
  if (!rider?.amiiboFigure || !ref_.riders.some(r => r.id !== rider.id && r.amiiboFigure === rider.amiiboFigure)) return name;
  const special = /\(([^)]+)\)/.exec(rider.name)?.[1];
  return special ? `${name} (${special})` : name;
}
