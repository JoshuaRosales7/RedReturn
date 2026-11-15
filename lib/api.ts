export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiFailure extends Error {
  constructor(public code: string, message: string, public status = 0, public details: unknown = {}) { super(message); }
  get offline() { return this.code === "network" || this.code === "timeout"; }
}

/** Typed JSON request with timeout and caller cancellation. Never sends credentials. */
export async function api<T>(path: string, opts: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException("timeout", "TimeoutError")), opts.timeoutMs ?? 20000);
  const onAbort = () => ctrl.abort(opts.signal?.reason);
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body ? "POST" : "GET"), signal: ctrl.signal, credentials: "omit",
      headers: opts.body ? { "Content-Type": "application/json" } : undefined, body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!res.ok) {
      let e: { error?: { code?: string; message?: string; details?: unknown } } = {};
      try { e = await res.json(); } catch { /* non-JSON error */ }
      throw new ApiFailure(e.error?.code ?? `http_${res.status}`, e.error?.message ?? `Request failed (${res.status})`, res.status, e.error?.details);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiFailure) throw err;
    if (opts.signal?.aborted) throw err;                                    // caller cancelled: propagate AbortError
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) throw new ApiFailure("timeout", "The API did not answer in time.");
    throw new ApiFailure("network", "The API is unreachable.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError" || (e as { name?: string })?.name === "AbortError";
