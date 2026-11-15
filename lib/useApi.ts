"use client";
import { useEffect, useState } from "react";
import { api, ApiFailure, isAbort } from "./api";

export type ApiState<T> = { data: T | null; error: { message: string; offline: boolean } | null; loading: boolean; reload: () => void };

/** GET a JSON resource from the RedReturn API; `null` path = do nothing. Context data only (never feeds the mission model). */
export function useApiGet<T>(path: string | null, timeoutMs = 40000): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiState<T>["error"]>(null);
  const [loading, setLoading] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!path) { setData(null); setError(null); setLoading(false); return; }
    const c = new AbortController();
    setLoading(true); setError(null);
    api<T>(path, { signal: c.signal, timeoutMs })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { if (isAbort(e)) return; setData(null); setLoading(false); setError({ message: e instanceof ApiFailure ? e.message : "Unexpected error", offline: e instanceof ApiFailure && e.offline }); });
    return () => c.abort();
  }, [path, timeoutMs, n]);
  return { data, error, loading, reload: () => setN(v => v + 1) };
}
