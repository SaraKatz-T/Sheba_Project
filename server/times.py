"""זמנים בפורמט של החוזה: ISO 8601 ב-UTC עם Z, למשל 2026-10-20T08:14:03Z."""

from datetime import datetime, timezone


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
