"""POST /api/auth/login, POST /api/auth/logout, GET /api/auth/session."""

from fastapi import APIRouter, Depends, Request, Response

from .. import live, settings
from ..auth import create_session, delete_session, login_limiter, password_ok, require_session, token_hash
from ..errors import ApiError
from ..models import LoginRequest, Session

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_OPTIONS = dict(path="/api", httponly=True, secure=settings.COOKIE_SECURE, samesite="strict")


@router.post("/login", status_code=204)
def login(body: LoginRequest, request: Request):
    client = request.client.host if request.client else "unknown"
    wait = login_limiter.retry_after(client)
    if wait:   # בודקים לפני הסיסמה, כדי שגם סיסמה נכונה לא תעבור בזמן החסימה
        # לא אומרים מתי החסימה נגמרת: זה רק עוזר למי שמנסה לנחש סיסמאות
        raise ApiError(429, message="הכניסה למערכת נחסמה זמנית לאחר מספר ניסיונות כושלים. נא לנסות שוב מאוחר יותר.")
    if not password_ok(body.password):
        login_limiter.record_failure(client)
        raise ApiError(401, "bad_password", "הסיסמה שגויה")
    login_limiter.reset(client)
    token, _ = create_session()
    response = Response(status_code=204)
    response.set_cookie(settings.COOKIE_NAME, token, max_age=settings.SESSION_HOURS * 3600, **COOKIE_OPTIONS)
    return response


@router.post("/logout", status_code=204)
def logout(token: str = Depends(require_session)):
    delete_session(token)
    live.close_session(token_hash(token))   # החוזה: מנתקים את חיבורי ה-WebSocket של הסשן עם 4401
    response = Response(status_code=204)
    response.delete_cookie(settings.COOKIE_NAME, **COOKIE_OPTIONS)
    return response


@router.get("/session", response_model=Session, dependencies=[Depends(require_session)])
def session():
    return Session(authenticated=True)
