import type { BaseRecord, ID, ISODate } from "../domain/schema";

/** Random UUID for a new record. */
export function newId(): ID {
  // randomUUID needs a secure context (https or localhost); fall back otherwise.
  if (typeof crypto.randomUUID === "function" && globalThis.isSecureContext !== false) return crypto.randomUUID();
  // Fallback: RFC 4122 v4 from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function nowIso(): ISODate {
  return new Date().toISOString();
}

/** id + timestamps for a brand-new record. */
export function newRecordBase(at: ISODate = nowIso()): BaseRecord {
  return { id: newId(), createdAt: at, updatedAt: at };
}
