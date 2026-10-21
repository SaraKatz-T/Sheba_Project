"""צילום מהטלפון: הטלפון לא נכנס בסיסמה, אלא עם קוד קצר-מועד שהמחשב מציג בברקוד.

הקוד עצמו לא נשמר (רק הגיבוב שלו) ולא נכתב ללוג.
"""

import hashlib
import secrets
from datetime import timedelta

from . import db, settings
from .errors import ApiError
from .models import CaptureSession
from .times import iso, utcnow


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session() -> CaptureSession:
    token = secrets.token_urlsafe(32)
    now = utcnow()
    expires_at = iso(now + timedelta(minutes=settings.CAPTURE_SESSION_MINUTES))
    with db.connect() as conn:
        # ניקוי: קודים שפגו לפני יותר מיום. קודים שפגו לאחרונה נשארים, כדי להחזיר להם 410 ולא 404
        conn.execute("DELETE FROM capture_sessions WHERE expires_at <= ?", (iso(now - timedelta(days=1)),))
        conn.execute("INSERT INTO capture_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
                     (_hash(token), iso(now), expires_at))
    return CaptureSession(token=token, expires_at=expires_at)


def check(token: str) -> str:
    """מחזיר את expires_at של קוד תקף. קוד שלא קיים: 404, קוד שפג: 410."""
    with db.connect() as conn:
        row = conn.execute("SELECT expires_at FROM capture_sessions WHERE token_hash = ?",
                           (_hash(token),)).fetchone()
    if row is None:
        raise ApiError(404, message="הקוד לא נמצא. סרקו שוב את הברקוד שבמחשב.")
    if row["expires_at"] <= iso(utcnow()):
        raise ApiError(410, "capture_expired", "תוקף הקוד פג. פתחו ברקוד חדש במחשב.")
    return row["expires_at"]


def reserve_slot(token: str):
    """תופס מקום לצילום אחד מתוך CAPTURE_MAX_UPLOADS. מעבר לזה: 429."""
    check(token)
    with db.connect() as conn:
        cur = conn.execute(
            "UPDATE capture_sessions SET upload_count = upload_count + 1 WHERE token_hash = ? AND upload_count < ?",
            (_hash(token), settings.CAPTURE_MAX_UPLOADS))
    if cur.rowcount == 0:
        raise ApiError(429, "too_many_uploads", "הגעתם למספר הצילומים המרבי לקוד הזה. פתחו ברקוד חדש במחשב.")


def release_slot(token: str):
    """מחזיר את המקום כשהצילום נדחה (סוג לא נתמך, גדול מדי וכו'), כדי שלא ייספר."""
    with db.connect() as conn:
        conn.execute("UPDATE capture_sessions SET upload_count = upload_count - 1 "
                     "WHERE token_hash = ? AND upload_count > 0", (_hash(token),))
