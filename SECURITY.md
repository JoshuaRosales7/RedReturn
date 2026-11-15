# Security

RedReturn is a research/education prototype. Report vulnerabilities privately to the maintainers (do not open a public issue with exploit details).

Controls in this repository: input bounds on every API field; request-body and computation limits; per-IP rate limiting (in-memory, single instance – put a gateway in front for multi-instance deployments); CORS allow-list via `REDRETURN_CORS_ORIGINS`; no secrets in `NEXT_PUBLIC_*`; optional `OPENAI_API_KEY`/`OPENAI_MODEL` are server-side only; error responses never include exception text; non-root API container.

Known limits: the rate limiter trusts the socket peer address (configure `--proxy-headers` behind a trusted proxy); no authentication (the API serves public, read-only scientific computations).
