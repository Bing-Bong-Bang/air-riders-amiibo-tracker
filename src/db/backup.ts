// =============================================================
// JSON export / import.
//
// Export: one versioned file with every record.
// Import: parse → version check → migrate → validate every record →
// integrity checks → replace all data in ONE transaction. Any failure
// before the final step leaves your current data untouched, and the
// final step is all-or-nothing.
// =============================================================

import { SCHEMA_VERSION } from "../domain/schema";
import type { ExportFile, TrackedMode } from "../domain/schema";
import { nowIso } from "../lib/ids";
import { DATA_STORE_NAMES, getAll, getById, runWrite } from "./database";
import type { DataStoreName } from "./database";
import { checkIntegrity } from "./integrity";
import { buildCtSeedFormats, mergeSwordKirby, migrateTrialsToSessions } from "./seed";
import type { Dataset } from "./integrity";
import { describeIssues, exportFileSchema } from "./validation";

/** Export-file keys for each store (settings is a single object, not a list). */
type ListKey = Exclude<keyof Dataset, "settings">;
const LIST_KEYS: ListKey[] = DATA_STORE_NAMES.filter((s): s is ListKey & DataStoreName => s !== "settings");

// -------------------------------------------------------------
// Export
// -------------------------------------------------------------

export async function readDataset(): Promise<Dataset> {
  const settings = await getById("settings", "settings");
  if (!settings) throw new Error("The database hasn't been set up yet. Reload the page and try again.");
  const lists = await Promise.all(LIST_KEYS.map(key => getAll(key)));
  const data = { settings } as Dataset;
  LIST_KEYS.forEach((key, i) => { (data as Record<ListKey, unknown>)[key] = lists[i]; });
  return data;
}

export async function buildExport(): Promise<ExportFile> {
  return {
    app: "kirby-air-riders-tracker",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    data: await readDataset(),
  };
}

export function exportFileName(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `air-riders-tracker_${stamp}.json`;
}

// -------------------------------------------------------------
// Import
// -------------------------------------------------------------

/**
 * MIGRATIONS[n] turns a schemaVersion n file into version n + 1.
 * Empty while the export format is still version 1.
 */
const MIGRATIONS: Record<number, (file: Record<string, unknown>) => Record<string, unknown>> = {};

function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  let file = raw;
  let version = Number(file.schemaVersion);
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) throw new Error(`No upgrade path from export version ${version}.`);
    file = { ...step(file), schemaVersion: version + 1 };
    version++;
  }
  return file;
}

export interface ImportSummary {
  exportedAt: string;
  counts: Record<ListKey, number>;
  racesByMode: Record<TrackedMode, number>;
}

export type ImportCheck =
  | { ok: true; file: ExportFile; summary: ImportSummary }
  | { ok: false; stage: "read" | "version" | "schema" | "integrity"; problems: string[] };

/** Validate an export file's text without touching the database. */
export function checkImport(text: string): ImportCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, stage: "read", problems: ["This file isn't valid JSON."] };
  }
  if (typeof raw !== "object" || raw === null || (raw as { app?: unknown }).app !== "kirby-air-riders-tracker") {
    return { ok: false, stage: "read", problems: ["This isn't an Air Riders tracker export."] };
  }
  const version = Number((raw as { schemaVersion?: unknown }).schemaVersion);
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, stage: "version", problems: ["The file has no valid version number."] };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false, stage: "version",
      problems: [`This file was made by a newer version of the tracker (export v${version}; this app reads up to v${SCHEMA_VERSION}). Update the app first.`],
    };
  }

  let migrated: Record<string, unknown>;
  try {
    migrated = migrate(raw as Record<string, unknown>);
  } catch (e) {
    return { ok: false, stage: "version", problems: [(e as Error).message] };
  }

  const parsed = exportFileSchema.safeParse(migrated);
  if (!parsed.success) return { ok: false, stage: "schema", problems: describeIssues(parsed.error) };

  const problems = checkIntegrity(parsed.data.data);
  if (problems.length) return { ok: false, stage: "integrity", problems };

  const counts = Object.fromEntries(LIST_KEYS.map(k => [k, parsed.data.data[k].length])) as Record<ListKey, number>;
  const racesByMode: Record<TrackedMode, number> = { air_ride: 0, top_ride: 0 };
  for (const r of parsed.data.data.races) racesByMode[r.mode]++;
  return { ok: true, file: parsed.data, summary: { exportedAt: parsed.data.exportedAt, counts, racesByMode } };
}

/** Replace ALL local data with a checked export, as one all-or-nothing change. */
export async function replaceAllData(file: ExportFile): Promise<void> {
  await runWrite(DATA_STORE_NAMES, async tx => {
    for (const store of DATA_STORE_NAMES) await tx.clear(store);
    await tx.put("settings", file.data.settings);
    for (const key of LIST_KEYS) {
      // Each list key matches its store; the record types line up by construction.
      await tx.putMany(key, file.data[key] as never);
    }
    // Older backups may still hold trials; they load as sessions.
    await migrateTrialsToSessions(tx);
    // Older backups may have Sword Kirby as its own rider.
    await mergeSwordKirby(tx);
    // Files from before City Trial have no City Trial formats: start them off.
    if (!file.data.ctFormats.length) await tx.putMany("ctFormats", buildCtSeedFormats());
  });
}

/** Run the integrity checks against the data currently saved. */
export async function checkCurrentData(): Promise<string[]> {
  return checkIntegrity(await readDataset());
}
