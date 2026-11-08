// =============================================================
// Auto-save to a file on your computer.
//
// You pick a save file once (e.g. Documents/air-riders-data.json).
// After that, every change is written to it a moment later, so your
// data always exists outside the browser. If the browser's copy is
// ever lost, "Open a save file" restores everything from it.
//
// Uses the browser's File System Access API (Chrome and Edge). The
// browser keeps the working copy; the file is a full, always-current
// backup in the normal export format.
// =============================================================

import { useSyncExternalStore } from "react";
import { buildExport, checkImport, replaceAllData } from "../db/backup";
import type { ImportCheck } from "../db/backup";
import { DATA_STORE_NAMES, subscribe } from "../db/database";
import type { ExportFile } from "../domain/schema";

// ---- the parts of the API we use (not yet in TypeScript's DOM types) ----
interface SaveFileHandle extends FileSystemFileHandle {
  queryPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(d: { mode: "readwrite" }): Promise<PermissionState>;
}
interface PickerOptions {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o: PickerOptions) => Promise<SaveFileHandle>;
  showOpenFilePicker?: (o: PickerOptions) => Promise<SaveFileHandle[]>;
};

const DEBOUNCE_MS = 800;
const FILE_TYPES = [{ description: "Air Riders tracker data", accept: { "application/json": [".json"] } }];

export type FileSaveState =
  | { kind: "unsupported" }
  | { kind: "off" }
  | { kind: "needs_permission"; fileName: string }
  | { kind: "saving"; fileName: string }
  | { kind: "saved"; fileName: string; savedAt: Date }
  | { kind: "error"; fileName: string; message: string };

// ---- tiny observable state ----
let state: FileSaveState = { kind: "off" };
const listeners = new Set<() => void>();
function setState(next: FileSaveState) {
  state = next;
  listeners.forEach(l => l());
}
export function useFileSave(): FileSaveState {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => state,
  );
}

export function isFileSaveSupported(): boolean {
  const w = window as PickerWindow;
  return typeof w.showSaveFilePicker === "function" && typeof w.showOpenFilePicker === "function";
}

let handle: SaveFileHandle | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> | null = null;
let pendingAgain = false;

// ---- remembering the linked file between sessions ----
// The link lives in its own small database, separate from your data,
// behind a crash guard: a marker is set before touching it and cleared
// after. If a previous attempt never cleared it (the page crashed), the
// link is forgotten and not stored again on this browser; you just pick
// the file once per session instead. Your data and the save file are
// never affected.
const LINK_DB = "air-riders-tracker-filelink";
const GUARD_KEY = "air-riders-tracker.fileLink.pending";
const NO_PERSIST_KEY = "air-riders-tracker.fileLink.noPersist";

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* unavailable */ } };

/** True when this browser can't remember the save file between sessions. */
export function linkIsSessionOnly(): boolean {
  return lsGet(NO_PERSIST_KEY) === "1";
}

function openLinkDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const q = indexedDB.open(LINK_DB, 1);
    q.onupgradeneeded = () => q.result.createObjectStore("links");
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

async function storeHandle(h: SaveFileHandle | null): Promise<void> {
  if (linkIsSessionOnly()) return;
  lsSet(GUARD_KEY, "write");
  try {
    const db = await openLinkDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("links", "readwrite");
      if (h) tx.objectStore("links").put(h, "saveFile"); else tx.objectStore("links").delete("saveFile");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Can't be stored here (e.g. not cloneable): keep the link for this session only.
    lsSet(NO_PERSIST_KEY, "1");
  } finally {
    lsSet(GUARD_KEY, null);
  }
}

async function loadHandle(): Promise<SaveFileHandle | null> {
  if (lsGet(GUARD_KEY)) {
    // A previous read or write of the link never finished: stop storing links on this browser.
    lsSet(GUARD_KEY, null);
    lsSet(NO_PERSIST_KEY, "1");
    await new Promise<void>(r => { const q = indexedDB.deleteDatabase(LINK_DB); q.onsuccess = q.onerror = q.onblocked = () => r(); });
    return null;
  }
  if (linkIsSessionOnly()) return null;
  lsSet(GUARD_KEY, "read");
  try {
    const db = await openLinkDb();
    const h = await new Promise<unknown>((resolve, reject) => {
      const g = db.transaction("links").objectStore("links").get("saveFile");
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
    db.close();
    return h && typeof (h as SaveFileHandle).createWritable === "function" ? (h as SaveFileHandle) : null;
  } catch {
    return null;
  } finally {
    lsSet(GUARD_KEY, null);
  }
}

async function permission(h: SaveFileHandle, ask: boolean): Promise<PermissionState> {
  if (!h.queryPermission) return "granted";
  const current = await h.queryPermission({ mode: "readwrite" });
  if (current === "granted" || !ask || !h.requestPermission) return current;
  return h.requestPermission({ mode: "readwrite" });
}

async function writeFile(h: SaveFileHandle, data: ExportFile): Promise<void> {
  const writable = await h.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/** Write the current data to the linked file now. */
export async function saveNow(): Promise<void> {
  if (!handle) return;
  if (writing) { pendingAgain = true; return writing; }
  const h = handle;
  writing = (async () => {
    setState({ kind: "saving", fileName: h.name });
    try {
      if ((await permission(h, false)) !== "granted") {
        setState({ kind: "needs_permission", fileName: h.name });
        return;
      }
      await writeFile(h, await buildExport());
      if (handle === h) setState({ kind: "saved", fileName: h.name, savedAt: new Date() });
    } catch (e) {
      if (handle === h) setState({ kind: "error", fileName: h.name, message: (e as Error).message || "The file couldn't be written." });
    }
  })().finally(() => {
    writing = null;
    if (pendingAgain) { pendingAgain = false; void saveNow(); }
  });
  return writing;
}

function scheduleSave(): void {
  if (!handle || state.kind === "needs_permission") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void saveNow(); }, DEBOUNCE_MS);
}

let started = false;

/** Call once after the database is ready. Reconnects a previously linked file. */
export async function initFileSave(): Promise<void> {
  if (started) return;
  started = true;
  if (!isFileSaveSupported()) { setState({ kind: "unsupported" }); return; }
  subscribe(changed => {
    if (DATA_STORE_NAMES.some(s => changed.has(s))) scheduleSave();
  });
  const h = await loadHandle();
  if (!h) { setState({ kind: "off" }); return; }
  handle = h;
  if ((await permission(h, false)) === "granted") await saveNow();
  else setState({ kind: "needs_permission", fileName: h.name });
}

/** Pick a new save file and start auto-saving to it. Must be called from a click. */
export async function chooseSaveFile(): Promise<boolean> {
  const w = window as PickerWindow;
  let h: SaveFileHandle;
  try {
    h = await w.showSaveFilePicker!({ suggestedName: "air-riders-data.json", types: FILE_TYPES });
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return false; // picker closed
    throw e;
  }
  handle = h;
  await storeHandle(h);
  await saveNow();
  return true;
}

/** Ask again for permission to write the linked file (Chrome asks after a restart). Must be called from a click. */
export async function resumeFileSave(): Promise<void> {
  if (!handle) return;
  if ((await permission(handle, true)) === "granted") await saveNow();
  else setState({ kind: "needs_permission", fileName: handle.name });
}

export async function stopFileSave(): Promise<void> {
  if (timer) clearTimeout(timer);
  handle = null;
  await storeHandle(null);
  setState({ kind: "off" });
}

export interface OpenedSaveFile {
  handle: SaveFileHandle;
  fileName: string;
  check: ImportCheck;
}

/** Pick an existing save file and check it. Nothing changes until confirmOpenSaveFile. */
export async function pickSaveFileToOpen(): Promise<OpenedSaveFile | null> {
  const w = window as PickerWindow;
  let h: SaveFileHandle;
  try {
    [h] = await w.showOpenFilePicker!({ types: FILE_TYPES, multiple: false });
  } catch (e) {
    if ((e as DOMException).name === "AbortError") return null;
    throw e;
  }
  const text = await (await h.getFile()).text();
  return { handle: h, fileName: h.name, check: checkImport(text) };
}

/** Replace the browser's data with the opened file's, then keep auto-saving to that file. */
export async function confirmOpenSaveFile(opened: OpenedSaveFile): Promise<void> {
  if (!opened.check.ok) throw new Error("That file has problems and can't be opened.");
  // Ask for write access first (still inside the click), so saving can continue straight away.
  const access = await permission(opened.handle, true);
  await replaceAllData(opened.check.file);
  handle = opened.handle;
  await storeHandle(opened.handle);
  if (access === "granted") setState({ kind: "saved", fileName: opened.handle.name, savedAt: new Date() });
  else setState({ kind: "needs_permission", fileName: opened.handle.name });
}
