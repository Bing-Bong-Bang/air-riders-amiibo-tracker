// Form controls shared by the entry pages.

import { useEffect, useId, useState } from "react";
import type { InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { formatGameTime, parseGameTime } from "../domain/schema";
import type { Millis } from "../domain/schema";
import { SaveError } from "../db/repo";
import { Notice, cx } from "./ui";

const CONTROL = "w-full rounded-xl border border-night-600 bg-night-850 px-3 py-2 text-sm text-night-100 placeholder:text-night-400 hover:border-night-400 focus:border-air-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50";

export function Field({ label, hint, error, children, htmlFor, className }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string; className?: string;
}) {
  return (
    <div className={cx("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wider text-night-300">{label}</label>
      {children}
      {error ? <p className="text-xs text-bad-400">{error}</p> : hint ? <p className="text-xs text-night-400">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={cx(CONTROL, className)} {...rest} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={2} className={cx(CONTROL, "resize-y", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(CONTROL, "pr-8", className)} {...rest}>{children}</select>;
}

export function NumberInput({ value, onChange, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: number | null; onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      className={cx(CONTROL, "tabular", className)}
      value={value ?? ""}
      onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
      {...rest}
    />
  );
}

export function Checkbox({ checked, onChange, label, hint, disabled, ariaLabel }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; ariaLabel?: string;
}) {
  return (
    <label className={cx("flex items-start gap-2.5 text-sm", disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer")}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={ariaLabel} onChange={e => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-air-500" />
      <span>
        <span className="text-night-100">{label}</span>
        {hint && <span className="block text-xs text-night-400">{hint}</span>}
      </span>
    </label>
  );
}

/** Segmented single-choice control. */
export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-xl border border-night-600 bg-night-850 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? "bg-night-600 text-night-100" : "text-night-300 hover:text-night-100",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Toggleable chip, for incident tags and similar multi-picks. */
export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active ? "border-star-400/60 bg-star-400/15 text-star-400" : "border-night-600 text-night-300 hover:border-night-400 hover:text-night-100",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Time box in the game's format. Accepts "01:25.72", "1:25.72", "85.72"
 * or digits only ("012572"). Reports ms, or null while empty/invalid.
 */
export function TimeInput({ value, onChange, id, inputRef, disabled, autoFocus, ariaLabel, invalid }: {
  value: Millis | null;
  onChange: (ms: Millis | null) => void;
  id?: string;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
  invalid?: boolean;
}) {
  const [text, setText] = useState(value === null ? "" : formatGameTime(value));
  const hintId = useId();

  // Keep the box in sync when the value is reset or loaded from outside.
  useEffect(() => {
    const parsed = parseGameTime(text);
    if (value === null && parsed !== null) setText("");
    else if (value !== null && parsed !== value) setText(formatGameTime(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const parsed = text.trim() ? parseGameTime(text) : null;
  const error = text.trim() === "" ? null
    : parsed === null ? "Use mm:ss.cc, like 01:25.72"
    : parsed % 10 !== 0 ? "The game shows hundredths: use 2 decimals"
    : null;
  const preview = parsed !== null && !error && formatGameTime(parsed) !== text.trim() ? formatGameTime(parsed) : null;

  return (
    <div>
      <input
        id={id}
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        placeholder="01:25.72"
        aria-label={ariaLabel}
        aria-invalid={!!error || invalid}
        aria-describedby={hintId}
        disabled={disabled}
        autoFocus={autoFocus}
        value={text}
        onChange={e => {
          const next = e.target.value;
          setText(next);
          const ms = next.trim() ? parseGameTime(next) : null;
          onChange(ms !== null && ms % 10 === 0 ? ms : null);
        }}
        onBlur={() => { if (parsed !== null && !error) setText(formatGameTime(parsed)); }}
        className={cx(CONTROL, "font-mono text-base tabular", (error || invalid) && "border-bad-400")}
      />
      <p id={hintId} className={cx("mt-1 h-4 text-xs", error ? "text-bad-400" : "text-night-400")}>
        {error ?? (preview ? `= ${preview}` : "")}
      </p>
    </div>
  );
}

/** Show a save failure: a SaveError's problem list, or any other error's message. */
export function SaveErrorNotice({ error }: { error: unknown }) {
  if (!error) return null;
  const problems = error instanceof SaveError ? error.problems : [(error as Error).message ?? String(error)];
  return (
    <Notice tone="bad" title="Not saved">
      {problems.length === 1 ? problems[0] : (
        <ul className="list-disc space-y-0.5 pl-5">{problems.map((p, i) => <li key={i}>{p}</li>)}</ul>
      )}
    </Notice>
  );
}
