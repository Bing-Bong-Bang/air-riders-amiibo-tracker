// Small shared UI building blocks.

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-2xl border border-night-700 bg-night-900/80 p-5 shadow-[0_1px_0_rgb(255_255_255/0.03)_inset]", className)}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-night-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-night-300">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: "bg-air-500 text-night-950 hover:bg-air-400 disabled:bg-night-700 disabled:text-night-400",
  secondary: "border border-night-600 bg-night-800 text-night-100 hover:border-night-400 disabled:text-night-400",
  danger: "bg-bad-400 text-night-950 hover:brightness-110 disabled:bg-night-700 disabled:text-night-400",
  ghost: "text-night-300 hover:bg-night-800 hover:text-night-100 disabled:text-night-600",
};

export function Button({
  variant = "secondary", className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed",
        BUTTON_STYLES[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function StatTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-night-700 bg-night-850 px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wider text-night-400">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular text-night-100">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-night-400">{hint}</div>}
    </div>
  );
}

type BadgeTone = "neutral" | "air" | "top" | "star" | "ok" | "bad";

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral: "border-night-600 bg-night-800 text-night-300",
  air: "border-air-500/40 bg-air-500/10 text-air-400",
  top: "border-top-500/40 bg-top-500/10 text-top-400",
  star: "border-star-400/40 bg-star-400/10 text-star-400",
  ok: "border-ok-400/40 bg-ok-400/10 text-ok-400",
  bad: "border-bad-400/40 bg-bad-400/10 text-bad-400",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", BADGE_STYLES[tone])}>
      {children}
    </span>
  );
}

export function Notice({ tone = "neutral", title, children }: { tone?: "neutral" | "ok" | "bad"; title?: ReactNode; children?: ReactNode }) {
  const styles = {
    neutral: "border-night-600 bg-night-850 text-night-300",
    ok: "border-ok-400/40 bg-ok-400/5 text-night-100",
    bad: "border-bad-400/40 bg-bad-400/5 text-night-100",
  }[tone];
  return (
    <div className={cx("rounded-xl border px-4 py-3 text-sm", styles)} role={tone === "bad" ? "alert" : "status"}>
      {title && <div className={cx("font-semibold", tone === "ok" && "text-ok-400", tone === "bad" && "text-bad-400")}>{title}</div>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-night-300" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-night-600 border-t-air-400" aria-hidden />
      {label}
    </div>
  );
}

/** Small decorative star used in headings. */
export function StarMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cx("h-5 w-5", className)}>
      <path fill="currentColor" d="M12 2.5l2.7 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7l-5.8 3.4 1.5-6.5-5-4.4 6.6-.6z" />
    </svg>
  );
}
