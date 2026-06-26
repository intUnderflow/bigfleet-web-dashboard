import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * useSearchParamState binds a single URL query parameter to a string state,
 * so a view's filters live in the URL and are shareable/bookmarkable
 * (roadmap v0.3 deep links). Writing the fallback value (or "") removes the
 * param to keep URLs clean; updates replace history rather than push.
 */
export function useSearchParamState(key: string, fallback = ""): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? fallback;

  const setValue = useCallback(
    (v: string) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (v && v !== fallback) next.set(key, v);
          else next.delete(key);
          return next;
        },
        { replace: true },
      );
    },
    [setParams, key, fallback],
  );

  return [value, setValue];
}
