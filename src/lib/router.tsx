// Minimal hash router: #/overview, #/log?edit=<id>, …
// Hash URLs work whether the app runs from the dev server or a built folder.

import { useEffect, useState } from "react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

export const ROUTES = ["overview", "log", "races", "sessions", "session", "compare", "runs", "run", "leaderboards", "stage", "machine", "recommendations", "amiibo", "stats", "formats", "roster", "city", "data"] as const;
export type Route = (typeof ROUTES)[number];
const DEFAULT_ROUTE: Route = "overview";

interface Location {
  route: Route;
  params: URLSearchParams;
}

function readLocation(): Location {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const name = path.split("/")[0];
  return {
    route: (ROUTES as readonly string[]).includes(name) ? (name as Route) : DEFAULT_ROUTE,
    params: new URLSearchParams(query),
  };
}

export function useLocation(): Location {
  const [loc, setLoc] = useState<Location>(readLocation);
  useEffect(() => {
    const onChange = () => setLoc(readLocation());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return loc;
}

export function useRoute(): Route {
  return useLocation().route;
}

export function hrefFor(route: Route, params?: Record<string, string>): string {
  const q = params ? new URLSearchParams(params).toString() : "";
  return `#/${route}${q ? `?${q}` : ""}`;
}

export function navigate(route: Route, params?: Record<string, string>): void {
  window.location.hash = hrefFor(route, params);
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: Route;
  params?: Record<string, string>;
  children: ReactNode;
}

export function Link({ to, params, children, ...rest }: LinkProps) {
  return <a href={hrefFor(to, params)} {...rest}>{children}</a>;
}
