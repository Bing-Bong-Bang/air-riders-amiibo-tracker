import { useEffect, useRef, useState } from "react";
import { subscribe } from "../db/database";
import type { StoreName } from "../db/database";

export interface LiveQueryResult<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
}

/**
 * Run an async database read and re-run it whenever one of `stores`
 * changes (in this tab or another). Omit `stores` to re-run on any
 * change. Stale results from superseded runs are discarded.
 */
export function useLiveQuery<T>(
  query: () => Promise<T>,
  deps: readonly unknown[],
  stores?: readonly StoreName[],
): LiveQueryResult<T> {
  const [state, setState] = useState<LiveQueryResult<T>>({ data: undefined, error: null, loading: true });
  const runId = useRef(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      const id = ++runId.current;
      queryRef.current().then(
        data => { if (!cancelled && id === runId.current) setState({ data, error: null, loading: false }); },
        error => { if (!cancelled && id === runId.current) setState(s => ({ data: s.data, error: error as Error, loading: false })); },
      );
    };
    run();
    const unsubscribe = subscribe(changed => {
      if (!stores || stores.some(s => changed.has(s))) run();
    });
    return () => { cancelled = true; unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
