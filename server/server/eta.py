"""זמן משוער לסיום קובץ (eta_at).

מדמים את עובדי הקריאה כפי שהם עובדים באמת: READ_WORKERS עמודים נקראים במקביל.
- עמוד שכבר בקריאה תופס עובד, ונשאר לו (זמן ממוצע לעמוד - הזמן שכבר עבר).
- כל עמוד שממתין, שלו ושל הקבצים שלפניו בתור, נכנס לעובד הראשון שמתפנה.
- הקובץ מסתיים כשהעובד האחרון מסיים.
כך כמה עמודים שרצים במקביל לוקחים בערך זמן של עמוד אחד, ולא חלק ממנו.

הזמן הממוצע לעמוד הוא ממוצע נע על העמודים האחרונים. לקובץ שעוד לא פוצל מניחים את מספר
העמודים הממוצע לקובץ. מחושב בכל שליפה, ולכן תמיד מעודכן.
"""

import heapq
from datetime import datetime, timedelta, timezone

from . import settings, worker
from .times import iso, utcnow

ACTIVE = ("queued", "splitting", "processing")
MIN_LEFT_SECONDS = 5   # עמוד שעבר את הזמן הממוצע עדיין צריך עוד קצת, לא אפס


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
    if upload_row["status"] not in ACTIVE or upload_row["paused"]:
        return None
    now = utcnow()
    per_page = seconds_per_page(conn)
    pages_per_file = round(conn.execute(
        "SELECT AVG(page_count) FROM uploads WHERE page_count IS NOT NULL").fetchone()[0] or 1)

    # הוא עצמו והקבצים שלפניו בתור
    uploads = conn.execute(
        "SELECT id, page_count FROM uploads WHERE status IN ('queued', 'splitting', 'processing') AND paused = 0 "
        "AND (queued_at < ? OR (queued_at = ? AND id <= ?))",
        (upload_row["queued_at"], upload_row["queued_at"], upload_row["id"])).fetchall()

    running = []   # כמה שניות נשארו לכל עמוד שכבר בקריאה
    waiting = 0    # עמודים שעוד לא התחילו
    for u in uploads:
        if u["page_count"] is None:   # עוד לא פוצל
            waiting += pages_per_file
            continue
        pages_left = conn.execute(
            "SELECT p.started_at, p.finished_at FROM pages p WHERE p.upload_id = ? AND p.number IN ("
            "  SELECT DISTINCT f.page_number FROM forms f "
            "  WHERE f.upload_id = ? AND f.status IN ('received', 'processing'))",
            (u["id"], u["id"])).fetchall()
        for p in pages_left:
            if p["started_at"] and not p["finished_at"]:
                elapsed = (now - _parse(p["started_at"])).total_seconds()
                running.append(max(per_page - elapsed, MIN_LEFT_SECONDS))
            else:
                waiting += 1

    # כל עובד: מתי הוא מתפנה (בשניות מעכשיו)
    workers = max(settings.READ_WORKERS, 1)
    free_at = sorted(running)[:workers] + [0.0] * max(workers - len(running), 0)
    heapq.heapify(free_at)
    for _ in range(waiting):
        heapq.heappush(free_at, heapq.heappop(free_at) + per_page)
    seconds = max(max(free_at), max(running, default=0.0))

    start = now
    if worker.is_paused():
        start = max(start, worker.paused_until)
    return iso(start + timedelta(seconds=seconds))
