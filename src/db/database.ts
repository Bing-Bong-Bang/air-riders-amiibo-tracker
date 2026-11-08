// =============================================================
// Local database: a small typed layer over IndexedDB.
//
// - One object store per record type, all keyed by `id`.
// - Indexes for the lookups the app makes (by mode, format, stage…).
// - Writes go through runWrite(), which is all-or-nothing: if anything
//   throws, the whole transaction is rolled back.
// - After every committed write, subscribers are told which stores
//   changed (in this tab and, via BroadcastChannel, in other tabs), so
//   useLiveQuery() can re-read and the UI updates on its own.
// =============================================================

import type {
  AmiiboFigure, AmiiboMachineFigure, AppSettings, Experiment, FigurePlayerProfile,
  FigurePlayerSnapshot, Format, IncidentTag, Machine, Player, Race, Rider, Run, Session,
  Stage, TestSet,
} from "../domain/schema";
import type { CtFormat, CtMatch, CtSession, StadiumRun } from "../domain/cityTrial";

export const DB_NAME = "air-riders-tracker";

/** Record type stored in each object store. */
export interface StoreTypes {
  settings: AppSettings;
  formats: Format;
  riders: Rider;
  machines: Machine;
  stages: Stage;
  players: Player;
  amiiboFigures: AmiiboFigure;
  amiiboMachineFigures: AmiiboMachineFigure;
  figurePlayerProfiles: FigurePlayerProfile;
  figurePlayerSnapshots: FigurePlayerSnapshot;
  sessions: Session;
  runs: Run;
  testSets: TestSet;
  experiments: Experiment;
  incidentTags: IncidentTag;
  races: Race;
  ctFormats: CtFormat;
  ctSessions: CtSession;
  ctMatches: CtMatch;
  stadiumRuns: StadiumRun;
}

export type StoreName = keyof StoreTypes;

interface IndexSpec {
  name: string;
  keyPath: string | string[];
}

/**
 * Store layout. Changing it means adding a step to MIGRATIONS and
 * bumping DB_VERSION; never edit a step that has already shipped.
 */
const STORE_INDEXES: Record<StoreName, IndexSpec[]> = {
  settings: [],
  formats: [{ name: "mode", keyPath: "mode" }],
  riders: [{ name: "sortOrder", keyPath: "sortOrder" }],
  machines: [{ name: "sortOrder", keyPath: "sortOrder" }],
  stages: [{ name: "mode", keyPath: "mode" }],
  players: [],
  amiiboFigures: [{ name: "riderId", keyPath: "riderId" }],
  amiiboMachineFigures: [{ name: "machineId", keyPath: "machineId" }],
  figurePlayerProfiles: [
    { name: "riderId", keyPath: "riderId" },
    { name: "status", keyPath: "status" },
  ],
  figurePlayerSnapshots: [
    { name: "profileId", keyPath: "profileId" },
    { name: "profileId_version", keyPath: ["profileId", "version"] },
  ],
  sessions: [{ name: "formatId", keyPath: "formatId" }],
  runs: [
    { name: "formatId", keyPath: "formatId" },
    { name: "status", keyPath: "status" },
  ],
  testSets: [
    { name: "mode", keyPath: "mode" },
    { name: "formatId", keyPath: "formatId" },
    { name: "experimentId", keyPath: "experimentId" },
  ],
  experiments: [{ name: "formatId", keyPath: "formatId" }],
  incidentTags: [{ name: "stageId", keyPath: "stageId" }],
  races: [
    { name: "mode", keyPath: "mode" },
    { name: "formatId", keyPath: "formatId" },
    { name: "stageId", keyPath: "stageId" },
    { name: "runId", keyPath: "runId" },
    { name: "testSetId", keyPath: "testSetId" },
    { name: "sessionId", keyPath: "sessionId" },
    { name: "racedAt", keyPath: "racedAt" },
    { name: "formatId_stageId", keyPath: ["formatId", "stageId"] },
  ],
  ctFormats: [],
  ctSessions: [{ name: "formatId", keyPath: "formatId" }],
  ctMatches: [
    { name: "formatId", keyPath: "formatId" },
    { name: "sessionId", keyPath: "sessionId" },
  ],
  stadiumRuns: [{ name: "stadiumId", keyPath: "stadiumId" }],
};

/** Stores that arrived with City Trial (database version 2). */
const CITY_TRIAL_STORES: StoreName[] = ["ctFormats", "ctSessions", "ctMatches", "stadiumRuns"];

export const STORE_NAMES = Object.keys(STORE_INDEXES) as StoreName[];

/** Stores holding your tracker data (currently every store). */
export type DataStoreName = StoreName;
export const DATA_STORE_NAMES: DataStoreName[] = STORE_NAMES;

/** Index names available on each store, for type-checked lookups. */
export type IndexName<S extends StoreName> = (typeof STORE_INDEXES)[S][number]["name"];

type Migration = (db: IDBDatabase, tx: IDBTransaction) => void;

/** MIGRATIONS[n] upgrades a database from version n to n + 1. */
const MIGRATIONS: Migration[] = [
  // v0 → v1: create every store and index (as of v1).
  db => {
    for (const name of STORE_NAMES.filter(n => !CITY_TRIAL_STORES.includes(n))) {
      const store = db.createObjectStore(name, { keyPath: "id" });
      for (const index of STORE_INDEXES[name]) store.createIndex(index.name, index.keyPath);
    }
  },
  // v1 → v2: City Trial stores.
  db => {
    for (const name of CITY_TRIAL_STORES) {
      if (db.objectStoreNames.contains(name)) continue;
      const store = db.createObjectStore(name, { keyPath: "id" });
      for (const index of STORE_INDEXES[name]) store.createIndex(index.name, index.keyPath);
    }
  },
];

export const DB_VERSION = MIGRATIONS.length;

// -------------------------------------------------------------
// Opening
// -------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser doesn't support IndexedDB, which the tracker needs to save data."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = request.result;
      const tx = request.transaction as IDBTransaction;
      for (let v = event.oldVersion; v < DB_VERSION; v++) MIGRATIONS[v](db, tx);
    };
    request.onblocked = () => {
      reject(new Error("The tracker is open in another tab with an older version. Close the other tabs and reload."));
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer version opened in another tab: step aside so it can upgrade.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("Couldn't open the local database."));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

/** Wrap an IDBRequest in a promise. */
function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("The change was cancelled and nothing was saved."));
    tx.onerror = () => { /* surfaced through onabort */ };
  });
}

// -------------------------------------------------------------
// Reads
// -------------------------------------------------------------

export async function getAll<S extends StoreName>(store: S): Promise<StoreTypes[S][]> {
  const db = await openDatabase();
  return done(db.transaction(store, "readonly").objectStore(store).getAll()) as Promise<StoreTypes[S][]>;
}

export async function getById<S extends StoreName>(store: S, id: string): Promise<StoreTypes[S] | undefined> {
  const db = await openDatabase();
  return done(db.transaction(store, "readonly").objectStore(store).get(id)) as Promise<StoreTypes[S] | undefined>;
}

export async function getAllByIndex<S extends StoreName>(
  store: S, index: IndexName<S>, value: IDBValidKey,
): Promise<StoreTypes[S][]> {
  const db = await openDatabase();
  const idx = db.transaction(store, "readonly").objectStore(store).index(index);
  return done(idx.getAll(value)) as Promise<StoreTypes[S][]>;
}

export async function count<S extends StoreName>(store: S, index?: IndexName<S>, value?: IDBValidKey): Promise<number> {
  const db = await openDatabase();
  const os = db.transaction(store, "readonly").objectStore(store);
  return done(index && value !== undefined ? os.index(index).count(value) : os.count());
}

// -------------------------------------------------------------
// Writes
// -------------------------------------------------------------

/**
 * The operations available inside runWrite(). Only await these inside
 * the callback: awaiting anything else (a fetch, a timer) lets the
 * browser commit the transaction early.
 */
export interface WriteTx {
  get<S extends StoreName>(store: S, id: string): Promise<StoreTypes[S] | undefined>;
  getAll<S extends StoreName>(store: S): Promise<StoreTypes[S][]>;
  put<S extends StoreName>(store: S, value: StoreTypes[S]): Promise<void>;
  putMany<S extends StoreName>(store: S, values: StoreTypes[S][]): Promise<void>;
  delete<S extends StoreName>(store: S, id: string): Promise<void>;
  clear<S extends StoreName>(store: S): Promise<void>;
}

/**
 * Run several reads/writes as ONE all-or-nothing change. If `fn`
 * throws or any request fails, nothing is saved.
 */
export async function runWrite<T>(stores: StoreName[], fn: (tx: WriteTx) => Promise<T>): Promise<T> {
  const db = await openDatabase();
  const tx = db.transaction(stores, "readwrite");
  const finished = txDone(tx);
  const api: WriteTx = {
    get: (store, id) => done(tx.objectStore(store).get(id)),
    getAll: store => done(tx.objectStore(store).getAll()),
    put: async (store, value) => { await done(tx.objectStore(store).put(value)); },
    putMany: async (store, values) => {
      const os = tx.objectStore(store);
      await Promise.all(values.map(v => done(os.put(v))));
    },
    delete: async (store, id) => { await done(tx.objectStore(store).delete(id)); },
    clear: async store => { await done(tx.objectStore(store).clear()); },
  };

  let result: T;
  try {
    result = await fn(api);
  } catch (error) {
    try { tx.abort(); } catch { /* already finished */ }
    await finished.catch(() => undefined);
    throw error;
  }
  await finished;
  notifyChanged(stores);
  return result;
}

/** Delete the whole database (used by "reset all data"). */
export async function deleteDatabase(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise.catch(() => null);
    db?.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close the tracker in your other tabs, then try again."));
  });
  notifyChanged(STORE_NAMES);
}

// -------------------------------------------------------------
// Change notifications
// -------------------------------------------------------------

type Listener = (changed: ReadonlySet<StoreName>) => void;
const listeners = new Set<Listener>();
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(`${DB_NAME}-changes`) : null;

channel?.addEventListener("message", (event: MessageEvent<StoreName[]>) => {
  const changed = new Set(event.data);
  listeners.forEach(l => l(changed));
});

function notifyChanged(stores: StoreName[]): void {
  const changed = new Set(stores);
  listeners.forEach(l => l(changed));
  channel?.postMessage(stores);
}

/** Subscribe to committed changes. Returns an unsubscribe function. */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
