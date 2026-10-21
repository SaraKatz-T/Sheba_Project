"""WebSocket /api/live: עדכונים חיים. השרת שולח, הלקוח רק מקשיב."""

from fastapi import APIRouter, WebSocket
from starlette.concurrency import run_in_threadpool

from .. import live, settings
from ..auth import session_expiry, token_hash

router = APIRouter()


@router.websocket("/api/live")
async def live_updates(ws: WebSocket):
    # הגנה מפני Cross-Site WebSocket Hijacking: רק דף של הלקוח עצמו יכול להתחבר
    if ws.headers.get("origin") not in settings.ALLOWED_ORIGINS:
        await ws.close(code=1008)   # לפני accept: הדפדפן מקבל 403 ולא נפתח חיבור
        return
    token = ws.cookies.get(settings.COOKIE_NAME)
    await ws.accept()
    if not token or await run_in_threadpool(session_expiry, token) is None:
        await ws.close(code=live.CLOSE_UNAUTHORIZED)   # 4401: הלקוח עובר למסך הכניסה
        return
    await live.serve(ws, token, token_hash(token))
