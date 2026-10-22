"""כל שגיאה חוזרת בגוף {"error": {"code", "message"}}, כפי שהחוזה דורש (גם 404).

404 בלי הגוף הזה הלקוח מפרש כ"כתובת שרת שגויה", ולכן גם כתובת שלא קיימת עוברת כאן.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

# קוד ברירת מחדל לכל סטטוס, כשלא נמסר קוד מפורש
DEFAULT_CODES = {
    400: "bad_request",
    401: "unauthorized",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    410: "gone",
    413: "file_too_large",
    415: "unsupported_type",
    429: "too_many_attempts",
    500: "server_error",
    502: "upstream_failed",
    503: "not_configured",
}


class ApiError(Exception):
    def __init__(self, status: int, code: str | None = None, message: str | None = None,
                 headers: dict | None = None, extra: dict | None = None):
        self.status = status
        self.code = code or DEFAULT_CODES.get(status, "error")
        self.message = message
        self.headers = headers
        self.extra = extra   # שדות נוספים בתוך error, למשל existing_upload בכפילות


def error_response(status: int, code: str, message: str | None = None, headers: dict | None = None,
                   extra: dict | None = None):
    body = {"code": code}
    if message:   # message לא חובה: בלעדיו הלקוח מציג הודעה בעברית לפי קוד ה-HTTP
        body["message"] = message
    if extra:
        body.update(extra)
    return JSONResponse({"error": body}, status_code=status, headers=headers)


def install(app: FastAPI):
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError):
        return error_response(exc.status, exc.code, exc.message, exc.headers, exc.extra)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        # כתובת שלא קיימת (404), שיטה לא נכונה (405) וכד'
        return error_response(exc.status_code, DEFAULT_CODES.get(exc.status_code, "error"),
                              headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError):
        # בלי פירוט: ברירת המחדל של FastAPI (422) מחזירה את הקלט עצמו, ובו עלולה להיות סיסמה
        return error_response(400, "bad_request")

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception):
        return error_response(500, "server_error")
