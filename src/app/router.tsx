/* The router.
 *
 * docs/07 fixes the route table; the client only has to read the address bar
 * and write to it. That is small enough to own: a history listener, a pure
 * matcher, and a link that does not reload the page. The dependency list in
 * docs/14-scope-and-operations.md names React, TanStack Query, Radix and
 * cmdk — no router — so this file is the whole of it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

export interface RouteLocation {
  /** Always starts with `/` and never ends with one, except the root. */
  pathname: string;
  /** The query string with its `?`, or the empty string. */
  search: string;
}

/** A same-document navigation the History API does not announce. */
const NAVIGATED = "paim:navigated";

/** `/p/paim/` and `/p/paim` are the same screen, so they get one spelling. */
export function normalizePath(pathname: string): string {
  const withLeading = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const trimmed = withLeading.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function readLocation(): RouteLocation {
  return {
    pathname: normalizePath(window.location.pathname),
    search: window.location.search,
  };
}

/**
 * Matches one route pattern against a path. A `:name` segment captures one
 * segment; everything else is literal. Returns the parameters, or null when
 * the path is a different route.
 */
export function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  const patternParts = normalizePath(pattern).split("/");
  const pathParts = normalizePath(pathname).split("/");
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (const [i, expected] of patternParts.entries()) {
    const actual = pathParts[i] ?? "";
    if (expected.startsWith(":")) {
      // An empty segment is not a value: `/p/` is not a project.
      if (actual === "") return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (expected !== actual) return null;
  }
  return params;
}

export interface NavigateOptions {
  /** Replace the current entry instead of pushing one — no Back step. */
  replace?: boolean;
}

/**
 * Changes the address without reloading. It lives outside React so a
 * keyboard handler or a query callback can navigate too.
 */
export function navigate(to: string, options: NavigateOptions = {}): void {
  const current = `${window.location.pathname}${window.location.search}`;
  if (to === current) return;
  if (options.replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new Event(NAVIGATED));
}

const LocationContext = createContext<RouteLocation | null>(null);

export function Router({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<RouteLocation>(readLocation);

  useEffect(() => {
    const sync = () => setLocation(readLocation());
    // popstate covers Back and Forward; NAVIGATED covers our own pushes.
    window.addEventListener("popstate", sync);
    window.addEventListener(NAVIGATED, sync);
    sync();
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAVIGATED, sync);
    };
  }, []);

  const value = useMemo(
    () => ({ pathname: location.pathname, search: location.search }),
    [location.pathname, location.search],
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useLocation(): RouteLocation {
  const location = useContext(LocationContext);
  if (!location) throw new Error("useLocation outside <Router>");
  return location;
}

/** Returns the parameters of `pattern` when the current path matches it. */
export function useMatch(pattern: string): Record<string, string> | null {
  const { pathname } = useLocation();
  return useMemo(() => matchPath(pattern, pathname), [pattern, pathname]);
}

export function useNavigate(): (to: string, options?: NavigateOptions) => void {
  return useCallback((to: string, options?: NavigateOptions) => navigate(to, options), []);
}

/** A modified click is the user asking the browser for a second window. */
function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.defaultPrevented
  );
}

export function Link({
  to,
  children,
  className,
  replace,
  onClick,
  ...rest
}: {
  to: string;
  children: ReactNode;
  className?: string;
  replace?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick">) {
  return (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        if (!isPlainClick(event)) return;
        event.preventDefault();
        navigate(to, { replace: replace ?? false });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
