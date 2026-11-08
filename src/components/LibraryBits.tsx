// Small shared pieces for the "library" pages: your notes on a course,
// character or machine, and a "Copy summary" button.

import { useState } from "react";
import { saveReferenceNotes } from "../db/repo";
import type { ID } from "../domain/schema";
import { SaveErrorNotice, TextArea } from "./form";
import { Button, Card, CardHeader } from "./ui";

export function NotesCard({ store, id, notes, what }: { store: "stages" | "riders" | "machines"; id: ID; notes?: string; what: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { await saveReferenceNotes(store, id, draft ?? ""); setDraft(null); } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader title="Notes" subtitle={`What you've learned about ${what} that numbers don't show.`}
        action={draft === null ? <Button variant="ghost" onClick={() => setDraft(notes ?? "")}>{notes ? "Edit notes" : "Add notes"}</Button> : undefined} />
      {draft === null ? (
        notes ? <p className="whitespace-pre-wrap text-sm text-night-100" data-testid="ref-notes">{notes}</p>
          : <p className="text-sm text-night-400">No notes yet. Things like shortcuts, hazards amiibo struggle with, or what works here.</p>
      ) : (
        <div className="space-y-3">
          <TextArea aria-label={`Notes on ${what}`} rows={5} value={draft} onChange={e => setDraft(e.target.value)} autoFocus />
          <SaveErrorNotice error={error} />
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save notes"}</Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Copies a plain-text summary to the clipboard. Falls back to a selectable box if the clipboard is blocked. */
export function CopySummaryButton({ build }: { build: () => string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const [text, setText] = useState("");
  const copy = async () => {
    const value = build();
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
      setTimeout(() => setState("idle"), 2000);
    } catch {
      setText(value);
      setState("manual");
    }
  };
  return (
    <div className="relative">
      <Button onClick={() => void copy()}>{state === "copied" ? "Copied ✓" : "Copy summary"}</Button>
      {state === "manual" && (
        <div className="absolute right-0 z-10 mt-2 w-96 max-w-[90vw] space-y-2 rounded-xl border border-night-600 bg-night-900 p-3 shadow-xl">
          <p className="text-xs text-night-300">Your browser blocked copying. Select the text below and copy it.</p>
          <textarea readOnly value={text} rows={10} aria-label="Summary text" className="w-full rounded-lg bg-night-850 p-2 font-mono text-xs text-night-100"
            onFocus={e => e.currentTarget.select()} />
          <Button variant="ghost" onClick={() => setState("idle")}>Close</Button>
        </div>
      )}
    </div>
  );
}
