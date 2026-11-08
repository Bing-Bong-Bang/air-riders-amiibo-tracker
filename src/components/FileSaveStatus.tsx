// Header pill showing whether your data is being saved to a file on your computer.

import { resumeFileSave, useFileSave } from "../lib/fileSave";
import { hrefFor } from "../lib/router";
import { cx } from "./ui";

const dot = (color: string) => <span aria-hidden className={cx("h-2 w-2 shrink-0 rounded-full", color)} />;
const PILL = "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium";

export function FileSaveStatus() {
  const s = useFileSave();
  switch (s.kind) {
    case "saved":
      return (
        <a href={hrefFor("data")} className={cx(PILL, "border-ok-400/40 text-ok-400 hover:bg-ok-400/10")}
          title={`Every change is saved to ${s.fileName}. Last saved ${s.savedAt.toLocaleTimeString()}.`} aria-label="Saved to file">
          {dot("bg-ok-400")}Saved
        </a>
      );
    case "saving":
      return <span className={cx(PILL, "border-night-600 text-night-300")}>{dot("bg-star-400 animate-pulse")}Saving…</span>;
    case "needs_permission":
      return (
        <button type="button" onClick={() => void resumeFileSave()} className={cx(PILL, "border-star-400/60 bg-star-400/10 text-star-400 hover:bg-star-400/20")}
          title={`Click to let Chrome keep saving to ${s.fileName}`} aria-label="Resume saving to your file">
          {dot("bg-star-400")}Resume saving
        </button>
      );
    case "error":
      return (
        <a href={hrefFor("data")} className={cx(PILL, "border-bad-400/50 text-bad-400 hover:bg-bad-400/10")} title={s.message}>
          {dot("bg-bad-400")}Save failed
        </a>
      );
    case "off":
      return (
        <a href={hrefFor("data")} className={cx(PILL, "border-star-400/40 text-star-400 hover:bg-star-400/10")}
          title="Not saved to a file yet: your data is only in this browser. Choose a save file on the Data page." aria-label="Not saved to a file">
          {dot("bg-star-400")}Not saved
        </a>
      );
    case "unsupported":
      return (
        <a href={hrefFor("data")} className={cx(PILL, "border-night-600 text-night-400 hover:text-night-100")}
          title="This browser can't auto-save to a file. Download backups from the Data page." aria-label="Browser storage only">
          {dot("bg-night-400")}Browser only
        </a>
      );
  }
}
