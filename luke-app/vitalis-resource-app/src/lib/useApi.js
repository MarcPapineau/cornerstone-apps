import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * useFetch — minimal data hook. Re-runs when deps change or reload() is called.
 * Never decides anything; just marshals an async api.* call into {data,error,loading}.
 */
export function useFetch(fn, deps = []) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    Promise.resolve()
      .then(() => fnRef.current())
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
