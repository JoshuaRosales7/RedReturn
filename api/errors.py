"""Consistent typed error contract: {"error": {"code", "message", "details"}}."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .scientific.dem import DemError
from .scientific.routing import RouteError


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: dict | None = None):
        super().__init__(message)
        self.status, self.code, self.message, self.details = status, code, message, details or {}


def body(code: str, message: str, details: dict | None = None) -> dict:
    return {"error": {"code": code, "message": message, "details": details or {}}}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_: Request, e: ApiError):
        return JSONResponse(body(e.code, e.message, e.details), status_code=e.status)

    @app.exception_handler(DemError)
    async def _dem(_: Request, e: DemError):
        return JSONResponse(body(e.code, e.message, e.details), status_code=422)

    @app.exception_handler(RouteError)
    async def _route(_: Request, e: RouteError):
        return JSONResponse(body(e.code, e.message, e.details), status_code=422)

    @app.exception_handler(RequestValidationError)
    async def _val(_: Request, e: RequestValidationError):
        errs = [{"loc": [str(x) for x in er["loc"]], "msg": er["msg"]} for er in e.errors()][:20]
        return JSONResponse(body("validation_error", "Request failed validation.", {"errors": errs}), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        d = e.detail if isinstance(e.detail, dict) else {}
        return JSONResponse(body(d.get("code", f"http_{e.status_code}"), d.get("message", str(e.detail)), d), status_code=e.status_code)

    @app.exception_handler(Exception)
    async def _any(_: Request, e: Exception):
        return JSONResponse(body("internal_error", "Unexpected server error.", {}), status_code=500)
