"""כניסה בסיסמה אחת משותפת (אין משתמשים נפרדים), סשן בעוגייה, והגבלת ניסיונות."""

import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta

from fastapi import Request

from . import db, settings
from .errors import ApiError
from .times import iso, utcnow


def _sha256(text: str) -> bytes:
    return hashlib.sha256(text.encode("utf-8")).digest()


def token_hash(token: str) -> str:
    """הגיבוב שנשמר במקום ה-token (במסד הנתונים ובחיבורים החיים)."""
    return _sha256(token).hex()


def password_ok(password: str) -> bool:
    # השוואה בזמן קבוע; הגיבוב משווה את האורכים, כך שגם אורך הסיסמה לא דולף
    return hmac.compare_digest(_sha256(password), _sha256(settings.APP_PASSWORD))


class LoginLimiter:
    """סופר ניסיונות שגויים לכל כתובת בחלון זמן נע. נשמר בזיכרון של תהליך ה-API."""

    def __init__(self, max_failures: int, window_seconds: int):
        self.max_failures = max_failures
        self.window = window_seconds
        self._failures = defaultdict(deque)
        self._lock = threading.Lock()

    def _prune(self, key, now):
        q = self._failures[key]
        while q and now - q[0] >= self.window:
            q.popleft()
        if not q:
            del self._failures[key]
            return None
        return q

    def retry_after(self, key: str) -> int:
        """כמה שניות לחכות לפני ניסיון נוסף, או 0 אם מותר לנסות עכשיו."""
        with self._lock:
            now = time.monotonic()
            q = self._prune(key, now)
            if q is None or len(q) < self.max_failures:
                return 0
            return int(self.window - (now - q[0])) + 1

    def record_failure(self, key: str):
        with self._lock:
            self._failures[key].append(time.monotonic())

    def reset(self, key: str):
        with self._lock:
            self._failures.pop(key, None)


login_limiter = LoginLimiter(settings.LOGIN_MAX_FAILURES, settings.LOGIN_WINDOW_SECONDS)


def create_session() -> tuple[str, str]:
    """יוצר סשן חדש. מחזיר (token לעוגייה, expires_at)."""
    token = secrets.token_urlsafe(32)
    now = utcnow()
    expires_at = iso(now + timedelta(hours=settings.SESSION_HOURS))
    with db.connect() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at <= ?", (iso(now),))   # ניקוי סשנים שפגו
        conn.execute("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
                     (token_hash(token), iso(now), expires_at))
    return token, expires_at


def session_expiry(token: str | None) -> str | None:
    """expires_at של סשן תקף, או None. משמש גם את בדיקת ה-WebSocket."""
    if not token:
        return None
    with db.connect() as conn:
        row = conn.execute("SELECT expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?",
                           (token_hash(token), iso(utcnow()))).fetchone()
    return row["expires_at"] if row else None


def delete_session(token: str):
    with db.connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash(token),))


def require_session(request: Request) -> str:
    """תלות (Depends) לכל בקשה שדורשת כניסה. מחזירה את ה-token של הסשן."""
    token = request.cookies.get(settings.COOKIE_NAME)
    if session_expiry(token) is None:
        raise ApiError(401)
    return token
