"""אפליקציית FastAPI: כל הבקשות של החוזה תחת /api. תיעוד חי בכתובת /docs."""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from . import client_app, db, errors, live, settings
from .routes import auth as auth_routes
from .routes import capture as capture_routes
from .routes import dismissals as dismissal_routes
from .routes import forms as form_routes
from .routes import live as live_routes
from .routes import uploads as upload_routes
from .worker import runner

# הלוג של השרת והעובדים: רק מזהים, מספרי עמודים וזמנים. בלי שמות, ת"ז, ערכי שדות או שמות קבצים
_log = logging.getLogger("server")
if not _log.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s", "%H:%M:%S"))
    _log.addHandler(_handler)
    _log.setLevel(logging.INFO)
    _log.propagate = False


class _HideCaptureTokens(logging.Filter):
    """הקוד של צילום מהטלפון מופיע בנתיב (/api/capture/{token}), ולכן הבקשות האלה לא נכתבות ללוג הגישה."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        path = args[2] if isinstance(args, tuple) and len(args) >= 3 else ""   # כך uvicorn מעביר את הנתיב
        return not str(path).startswith("/api/capture/")


logging.getLogger("uvicorn.access").addFilter(_HideCaptureTokens())


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.APP_PASSWORD:
        raise RuntimeError("חסרה סיסמה. בקובץ .env צריך שורה APP_PASSWORD=...")
    db.init_db()
    live.bind_loop(asyncio.get_running_loop())   # עדכונים מהעובדים עוברים ללולאה הזו ומשם לחיבורים
    if settings.WORKERS_ENABLED:
        runner.start()
    yield
    if settings.WORKERS_ENABLED:
        runner.stop()
    live.bind_loop(None)


app = FastAPI(title="Shaba Forms API", version="2.3", lifespan=lifespan)
errors.install(app)

MAX_REQUEST_BYTES = settings.MAX_UPLOAD_BYTES + 1024 * 1024   # הקובץ + מעטפת ה-multipart


@app.middleware("http")
async def limit_body(request: Request, call_next):
    # דוחים בקשה גדולה מדי לפני שקוראים אותה בכלל (הבדיקה המדויקת של 25MB נעשית בקליטה)
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_REQUEST_BYTES:
        return errors.error_response(413, "file_too_large", "הקובץ גדול מ-25MB.")
    return await call_next(request)


@app.middleware("http")
async def no_store(request: Request, call_next):
    response = await call_next(request)
    # החוזה: בלי מטמון לתשובות עם נתונים אישיים ולתמונות. הכי פשוט ובטוח: לכל /api
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


app.include_router(auth_routes.router)
app.include_router(upload_routes.router)
app.include_router(form_routes.router)
app.include_router(capture_routes.router)
app.include_router(dismissal_routes.router)
app.include_router(live_routes.router)

# אחרון: כל נתיב שלא נתפס למעלה הולך ללקוח (רק כש-CLIENT_DIST מוגדר)
if settings.CLIENT_DIST:
    client_app.install(app, settings.CLIENT_DIST)
