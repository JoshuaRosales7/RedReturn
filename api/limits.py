"""Computational-abuse protection: per-client token bucket + body size cap (in-memory, single instance)."""
from __future__ import annotations

import os
import time
from collections import defaultdict

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .errors import body

MAX_BODY_BYTES = int(os.getenv("REDRETURN_MAX_BODY_BYTES", "200000"))
RATE_PER_MIN = int(os.getenv("REDRETURN_RATE_PER_MIN", "600"))
HEAVY_PATHS = ("/api/risk", "/api/routes/alternatives", "/api/scenarios", "/api/ares", "/api/ai", "/api/reports")
HEAVY_PER_MIN = int(os.getenv("REDRETURN_HEAVY_PER_MIN", "180"))
_buckets: dict[tuple[str, str], tuple[float, float]] = defaultdict(lambda: (0.0, 0.0))


def _take(key: tuple[str, str], rate_per_min: int) -> bool:
    now = time.monotonic()
    tokens, last = _buckets[key]
    if last == 0.0:
        tokens, last = float(rate_per_min), now
    tokens = min(float(rate_per_min), tokens + (now - last) * rate_per_min / 60)
    if tokens < 1:
        _buckets[key] = (tokens, now)
        return False
    _buckets[key] = (tokens - 1, now)
    return True


def reset() -> None:
    _buckets.clear()


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.url.path.startswith("/api/"):
            length = request.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BODY_BYTES:
                return JSONResponse(body("payload_too_large", f"Body exceeds {MAX_BODY_BYTES} bytes."), status_code=413)
            client = request.client.host if request.client else "unknown"
            if not _take((client, "all"), RATE_PER_MIN) or (
                    request.url.path.startswith(HEAVY_PATHS) and not _take((client, "heavy"), HEAVY_PER_MIN)):
                return JSONResponse(body("rate_limited", "Too many requests; slow down."), status_code=429,
                                    headers={"Retry-After": "10"})
        return await call_next(request)
