"""זמן משוער לסיום קובץ (eta_at), לפי הנוסחה בחוזה:

    עכשיו + (עמודים שנשארו, שלו ושל הקבצים שלפניו ÷ מספר עובדי הקריאה) × זמן ממוצע לעמוד

הזמן הממוצע הוא ממוצע נע על העמודים האחרונים. לקובץ שעוד לא פוצל מניחים את מספר העמודים
הממוצע לקובץ. מחושב בכל שליפה, ולכן תמיד מעודכן.
"""

from datetime import datetime, timedelta, timezone

from . import settings, worker
from .times import iso, utcnow

ACTIVE = ("queued", "splitting", "processing")


def _parse(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def seconds_per_page(conn) -> float:
    rows = conn.execute(
        "SELECT started_at, finished_at FROM pages WHERE started_at IS NOT NULL AND finished_at IS NOT NULL "
        "ORDER BY finished_at DESC LIMIT ?", (settings.ETA_SAMPLE_PAGES,)).fetchall()
    durations = [(_parse(r["finished_at"]) - _parse(r["started_at"])).total_seconds() for r in rows]
    durations = [d for d in durations if d >= 0]
    return sum(durations) / len(durations) if durations else settings.DEFAULT_SECONDS_PER_PAGE


def eta_at(conn, upload_row) -> str | None:
    if upload_row["status"] not in ACTIVE:
        return None
    pages_per_file = conn.execute("SELECT AVG(page_count) FROM uploads WHERE page_count IS NOT NULL").fetchone()[0] or 1
    rows = conn.execute(
        "SELECT u.page_count, (SELECT COUNT(DISTINCT f.page_number) FROM forms f "
        "   WHERE f.upload_id = u.id AND f.status IN ('received', 'processing')) AS pages_left "
        "FROM uploads u WHERE u.status IN ('queued', 'splitting', 'processing') "
        "AND (u.queued_at < ? OR (u.queued_at = ? AND u.id <= ?))",   # הוא עצמו והקבצים שלפניו
        (upload_row["queued_at"], upload_row["queued_at"], upload_row["id"])).fetchall()
    pages = sum(pages_per_file if r["page_count"] is None else r["pages_left"] for r in rows)
    seconds = pages / max(settings.READ_WORKERS, 1) * seconds_per_page(conn)
    start = utcnow()
    if worker.is_paused():
        start = max(start, worker.paused_until)
    return iso(start + timedelta(seconds=seconds))
