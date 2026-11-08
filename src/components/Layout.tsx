import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { MODES, useMode } from "../lib/mode";
import { Link, navigate, useLocation } from "../lib/router";
import type { Route } from "../lib/router";
import { FileSaveStatus } from "./FileSaveStatus";
import { StarMark, cx } from "./ui";

/** Race-mode pages (Air Ride and Top Ride). */
const NAV: { to: Route; label: string; modeAware: boolean }[] = [
  { to: "overview", label: "Overview", modeAware: true },
  { to: "log", label: "Log race", modeAware: true },
  { to: "races", label: "Races", modeAware: true },
  { to: "sessions", label: "Sessions", modeAware: true },
  { to: "runs", label: "Runs", modeAware: true },
  { to: "leaderboards", label: "Rankings", modeAware: true },
  { to: "recommendations", label: "Best picks", modeAware: true },
  { to: "amiibo", label: "Amiibo", modeAware: false },
  { to: "formats", label: "Formats", modeAware: true },
  { to: "roster", label: "Roster", modeAware: true },
  { to: "data", label: "Data", modeAware: false },
];

/** City Trial's own sections (tabs of the City Trial page), plus the shared pages. */
const CITY_NAV: { tab: string; label: string }[] = [
  { tab: "overview", label: "Overview" },
  { tab: "log", label: "Log match" },
  { tab: "matches", label: "Matches" },
  { tab: "sessions", label: "Sessions" },
  { tab: "rankings", label: "Rankings" },
  { tab: "records", label: "Records" },
  { tab: "formats", label: "Formats" },
];
const SHARED: Route[] = ["amiibo", "data"];

type Area = "race" | "city";
const AREA_KEY = "air-riders-tracker.area";
const readArea = (): Area => { try { return localStorage.getItem(AREA_KEY) === "city" ? "city" : "race"; } catch { return "race"; } };
const storeArea = (a: Area) => { try { localStorage.setItem(AREA_KEY, a); } catch { /* storage unavailable */ } };

function ModeSwitch({ area }: { area: Area }) {
  const { mode, setMode } = useMode();
  const options = [...MODES.map(m => ({ id: m.id as string, label: m.label })), { id: "city_trial", label: "City Trial" }];
  const current = area === "city" ? "city_trial" : mode;
  return (
    <div role="radiogroup" aria-label="Game mode" className="flex rounded-xl border border-night-700 bg-night-900 p-1">
      {options.map(m => {
        const active = m.id === current;
        return (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (m.id === "city_trial") { navigate("city"); return; }
              setMode(m.id as typeof mode);
              if (area === "city") navigate("overview");
            }}
            className={cx(
              "rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors",
              active && m.id === "air_ride" && "bg-air-500 text-night-950",
              active && m.id === "top_ride" && "bg-top-500 text-night-950",
              active && m.id === "city_trial" && "bg-star-400 text-night-950",
              !active && "text-night-300 hover:text-night-100",
            )}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

const linkClass = (on: boolean) => cx(
  "whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
  on ? "bg-night-800 text-night-100" : "text-night-300 hover:text-night-100",
);

export function Layout({ children }: { children: ReactNode }) {
  const { route, params } = useLocation();
  const { mode } = useMode();
  const [area, setArea] = useState<Area>(() => (route === "city" ? "city" : SHARED.includes(route) ? readArea() : "race"));

  // The area follows the page: City Trial pages → City Trial, race pages → races; Amiibo and Data keep whichever you came from.
  useEffect(() => {
    const next: Area | null = route === "city" ? "city" : SHARED.includes(route) ? null : "race";
    if (next && next !== area) { setArea(next); storeArea(next); }
  }, [route, area]);

  // Sub-pages highlight their parent tab and follow its mode behaviour.
  const parent: Route = route === "session" || route === "compare" ? "sessions" : route === "run" ? "runs" : route === "stats" ? "roster" : route === "stage" || route === "machine" ? "leaderboards" : route;
  const modeAware = route === "city" || (NAV.find(n => n.to === parent)?.modeAware ?? false);
  const cityTab = params.get("tab") === "session" ? "sessions" : params.get("tab") ?? "overview";
  const star = area === "city" ? "text-star-400" : mode === "air_ride" ? "text-air-400" : "text-top-400";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-night-800 bg-night-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
          <a href={area === "city" ? "#/city" : "#/overview"} className="flex items-center gap-2">
            <StarMark className={star} />
            <span className="font-display text-base font-bold tracking-tight">Air Riders Stat Tracker</span>
          </a>
          <nav aria-label="Main" className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto px-1 pb-0.5">
            {area === "city" ? (
              <>
                {CITY_NAV.map(item => (
                  <Link key={item.tab} to="city" params={{ tab: item.tab }} aria-current={route === "city" && cityTab === item.tab ? "page" : undefined} className={linkClass(route === "city" && cityTab === item.tab)}>
                    {item.label}
                  </Link>
                ))}
                {NAV.filter(n => SHARED.includes(n.to)).map(item => (
                  <Link key={item.to} to={item.to} aria-current={parent === item.to ? "page" : undefined} className={linkClass(parent === item.to)}>{item.label}</Link>
                ))}
              </>
            ) : NAV.map(item => (
              <Link key={item.to} to={item.to} aria-current={parent === item.to ? "page" : undefined} className={linkClass(parent === item.to)}>{item.label}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <FileSaveStatus />
            <div
              className={cx("transition-opacity", !modeAware && "opacity-40")}
              inert={!modeAware}
              title={modeAware ? undefined : "This page covers every mode"}
            >
              <ModeSwitch area={area} />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
