"""עובד קריאה: שולח עמוד ל-Gemini, קורא שוב את השם בהגדלה, ושומר את התוצאה כשורות ושדות.

כמה עובדים רצים במקביל (READ_WORKERS). לכל עובד מופע GeminiExtractor משלו, כך שאין ביניהם מצב משותף
והקוד הקיים לא משתנה.
"""

import json
import logging
import secrets
import threading
import time
from datetime import timedelta

from commitment_extractor.name_zoom import box_on_page, crop_name_region_with_box, crop_scale

from .. import crypto, db, events, settings
from ..times import iso, utcnow
from . import mapping, pause

log = logging.getLogger("server.worker")

STEP_PAGE = {"percent": 10, "step": "קריאת הטופס"}
STEP_NAME = {"percent": 60, "step": "אימות שם המטופל"}
STEP_PAUSED = {"percent": 0, "step": "בהמתנה, העיבוד יתחדש בקרוב"}   # בלי שם המודל: המשתמש לא צריך לדעת אותו
ERROR_FAILED = "לא הצלחנו לקרוא את העמוד. אפשר לנסות שוב."
QUOTA_MESSAGE = "כל המפתחות נחסמו"   # השגיאה ש-GeminiExtractor זורק כשהמכסה נגמרה גם אחרי ההמתנות שלו

_claim_lock = threading.Lock()


def make_extractor():
    """מופע חדש של הקוד הקיים. בבדיקות מחליפים אותו ב-Gemini מדומה."""
    from commitment_extractor.gemini_extractor import GeminiExtractor
    return GeminiExtractor()


def _page_forms(conn, upload_id: str, number: int) -> list[str]:
    return [r["id"] for r in conn.execute(
        "SELECT id FROM forms WHERE upload_id = ? AND page_number = ? ORDER BY position", (upload_id, number))]


def claim_page() -> tuple[str, int] | None:
    """לוקח את העמוד הבא שממתין (לפי סדר הגעת הקבצים) ומעביר את השורות שלו ל-processing."""
    now = iso(utcnow())
    with _claim_lock, db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")   # הבחירה והסימון יחד: "עצור" לא יכול להיכנס ביניהם
        row = conn.execute(
            "SELECT p.upload_id, p.number FROM pages p JOIN uploads u ON u.id = p.upload_id "
            "WHERE u.paused = 0 AND u.removed_at IS NULL AND (p.retry_at IS NULL OR p.retry_at <= ?) AND EXISTS (SELECT 1 FROM forms f "
            "  WHERE f.upload_id = p.upload_id AND f.page_number = p.number AND f.status = 'received') "
            "ORDER BY u.queued_at, p.number LIMIT 1", (now,)).fetchone()
        if row is None:
            return None
        upload_id, number = row["upload_id"], row["number"]
        conn.execute("UPDATE forms SET status = 'processing', progress = ?, updated_at = ? "
                     "WHERE upload_id = ? AND page_number = ? AND status = 'received'",
                     (json.dumps(STEP_PAGE, ensure_ascii=False), now, upload_id, number))
        conn.execute("UPDATE pages SET attempts = attempts + 1, retry_at = NULL, started_at = ?, finished_at = NULL, "
                     "claim_id = ? WHERE upload_id = ? AND number = ?", (now, secrets.token_hex(8), upload_id, number))
        form_ids = _page_forms(conn, upload_id, number)
    for form_id in form_ids:
        events.form_changed(form_id)
    return upload_id, number


def _set_progress(upload_id: str, number: int, progress: dict):
    with db.connect() as conn:
        conn.execute("UPDATE forms SET progress = ?, updated_at = ? WHERE upload_id = ? AND page_number = ? "
                     "AND status = 'processing'",
                     (json.dumps(progress, ensure_ascii=False), iso(utcnow()), upload_id, number))
        form_ids = _page_forms(conn, upload_id, number)
    for form_id in form_ids:
        events.form_changed(form_id)


def _zoom_names(extractor, result: dict, png: bytes):
    """לכל מטופל: חיתוך והגדלה של אזור השם ושליחה חוזרת. כמו zoom_names ב-run_extraction.py,
    בלי לשמור את החיתוכים לדיסק (הם מכילים שמות)."""
    for record in result.get("records") or []:
        if not isinstance(record, dict):
            continue
        cropped = crop_name_region_with_box(png, record.get("name_box"))
        if cropped is None:
            record["name_zoom"] = {"skipped": "no valid name_box"}
            continue
        crop, crop_box = cropped
        # בדיוק מה שנשלח למודל: אזור החיתוך בעמוד והגדלה. רק מספרים, לא התמונה (יש בה שם).
        # בזכותם מסך הרשומה מציג את אותה תמונה (GET /api/forms/{id}/name-crop)
        sent = {"crop_box": crop_box, "crop_scale": crop_scale(png, crop_box)}
        try:
            zoom = extractor.extract_page(crop, task="name")
        except Exception as e:   # ההגדלה לא הכרחית: בלעדיה נשארים עם קריאת העמוד המלא
            record["name_zoom"] = {"error": type(e).__name__, **sent}
            continue
        # המיקום של כל שם בתוך החיתוך ← מיקום בעמוד, כדי שכל שדה יקבל מסגרת משלו
        for key in ("first_name", "last_name"):
            if isinstance(zoom, dict) and isinstance(zoom.get(key), dict):
                zoom[key]["page_box"] = box_on_page(zoom[key].get("box"), crop_box)
        if isinstance(zoom, dict):
            zoom.update(sent)
        record["name_zoom"] = zoom


def _finish_upload_if_done(conn, upload_id: str) -> bool:
    """כשאין בקובץ עוד שורות שממתינות או בעיבוד, הקובץ עובר ל-done."""
    left = conn.execute("SELECT COUNT(*) FROM forms WHERE upload_id = ? AND status IN ('received', 'processing')",
                        (upload_id,)).fetchone()[0]
    if left:
        return False
    cur = conn.execute("UPDATE uploads SET status = 'done', updated_at = ? WHERE id = ? AND status = 'processing'",
                       (iso(utcnow()), upload_id))
    return cur.rowcount > 0


def _still_mine(conn, upload_id: str, number: int, claim_id: str) -> bool:
    """האם הקריאה הזו עדיין רלוונטית. "עצור" או "הסר" בזמן הקריאה מבטלים אותה: אחרי "עצור" העמוד
    חוזר לתור ונקרא מחדש ב"המשך"; אחרי "הסר" הוא כבר נמחק."""
    return conn.execute(
        "SELECT 1 FROM pages p JOIN uploads u ON u.id = p.upload_id "
        "WHERE p.upload_id = ? AND p.number = ? AND p.claim_id = ? AND u.removed_at IS NULL AND u.paused = 0",
        (upload_id, number, claim_id)).fetchone() is not None


def _give_back(upload_id: str, number: int, claim_id: str):
    """קריאה שבוטלה: אם העמוד עדיין רשום עליה, מחזירים אותו לתור (בלי לספור ניסיון)."""
    with db.connect() as conn:
        cur = conn.execute("UPDATE pages SET claim_id = NULL, started_at = NULL, attempts = MAX(attempts - 1, 0) "
                           "WHERE upload_id = ? AND number = ? AND claim_id = ?", (upload_id, number, claim_id))
        if cur.rowcount:
            conn.execute("UPDATE forms SET status = 'received', progress = NULL, updated_at = ? "
                         "WHERE upload_id = ? AND page_number = ? AND status = 'processing'",
                         (iso(utcnow()), upload_id, number))
    log.info("עמוד %d בקובץ %s: נעצר או הוסר בזמן הקריאה, התשובה נזרקה", number, upload_id)


def read_page(extractor, upload_id: str, number: int):
    with db.connect() as conn:
        page = conn.execute("SELECT image_path, attempts, claim_id FROM pages WHERE upload_id = ? AND number = ?",
                            (upload_id, number)).fetchone()
    if page is None or not page["claim_id"]:   # הוסר או נעצר בין הלקיחה מהתור לתחילת הקריאה
        return
    claim_id = page["claim_id"]
    started = time.monotonic()
    try:
        png = crypto.read_file(settings.STORAGE_DIR / page["image_path"])   # מפוענח בזיכרון בלבד
        result = extractor.extract_page(png)
        with db.connect() as conn:
            mine = _still_mine(conn, upload_id, number, claim_id)
        if not mine:   # לא שולחים את ההגדלה של השם לחינם
            _give_back(upload_id, number, claim_id)
            return
        _set_progress(upload_id, number, STEP_NAME)
        _zoom_names(extractor, result, png)
    except Exception as e:
        with db.connect() as conn:
            mine = _still_mine(conn, upload_id, number, claim_id)
        if mine:
            _handle_failure(upload_id, number, page["attempts"], e)
        else:
            _give_back(upload_id, number, claim_id)
        return

    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")   # הבדיקה והשמירה יחד: "עצור" לא יכול להיכנס ביניהן
        mine = _still_mine(conn, upload_id, number, claim_id)
        if mine:
            conn.execute("UPDATE pages SET raw_result = ?, finished_at = ? WHERE upload_id = ? AND number = ?",
                         (crypto.seal(json.dumps(result, ensure_ascii=False)), iso(utcnow()), upload_id, number))
            form_ids = mapping.apply(conn, upload_id, number, result)
            done = _finish_upload_if_done(conn, upload_id)
    if not mine:
        _give_back(upload_id, number, claim_id)
        return
    log.info("עמוד %d בקובץ %s: נקרא (%d שורות, %.1f שנ')", number, upload_id, len(form_ids),
             time.monotonic() - started)
    for form_id in form_ids:
        events.form_changed(form_id)
    events.upload_changed(upload_id)   # form_ids, form_count ו-eta_at השתנו
    events.queue_changed(skip=upload_id)   # הזמן הממוצע לעמוד השתנה: גם הזמן המשוער של שאר הקבצים
    if done:
        log.info("קובץ %s: הסתיים", upload_id)


def _failure_message(error: Exception) -> str:
    """ההודעה שמוצגת במסך כשעמוד נכשל. חסימה של NetFree או ניתוק מקבלים הודעה משלהם, כדי שיהיה ברור שזו לא תקלה בקריאה."""
    from commitment_extractor.gemini_extractor import NetworkBlocked
    if isinstance(error, NetworkBlocked):
        return f"{str(error).split(',')[0]}. אפשר לנסות שוב."
    return ERROR_FAILED


def _handle_failure(upload_id: str, number: int, attempts: int, error: Exception):
    now = utcnow()
    with db.connect() as conn:
        if QUOTA_MESSAGE in str(error):
            # המכסה נגמרה: זה לא כישלון של העמוד. עוצרים את כל התור, והעמוד חוזר לתור בלי שהניסיון נספר
            until = now + timedelta(minutes=settings.QUOTA_PAUSE_MINUTES)
            pause(until)
            conn.execute("UPDATE pages SET attempts = attempts - 1, started_at = NULL WHERE upload_id = ? AND number = ?",
                         (upload_id, number))
            conn.execute("UPDATE forms SET status = 'received', updated_at = ? WHERE upload_id = ? AND page_number = ? "
                         "AND status = 'processing'", (iso(now), upload_id, number))
            waiting = [r["id"] for r in conn.execute("SELECT id FROM forms WHERE status = 'received'")]
            conn.execute("UPDATE forms SET progress = ? WHERE status = 'received'",
                         (json.dumps(STEP_PAUSED, ensure_ascii=False),))
            log.warning("המכסה של Gemini נגמרה: התור נעצר עד %s", (until.astimezone()).strftime("%H:%M"))
            changed = waiting
        elif attempts < settings.MAX_PAGE_ATTEMPTS:
            delay = settings.RETRY_DELAYS_SECONDS[min(attempts, len(settings.RETRY_DELAYS_SECONDS)) - 1]
            conn.execute("UPDATE pages SET retry_at = ? WHERE upload_id = ? AND number = ?",
                         (iso(now + timedelta(seconds=delay)), upload_id, number))
            conn.execute("UPDATE forms SET status = 'received', progress = NULL, updated_at = ? "
                         "WHERE upload_id = ? AND page_number = ? AND status = 'processing'", (iso(now), upload_id, number))
            log.warning("עמוד %d בקובץ %s: ניסיון %d נכשל (%s), ננסה שוב בעוד %d שנ'",
                        number, upload_id, attempts, type(error).__name__, delay)
            changed = _page_forms(conn, upload_id, number)
        else:
            conn.execute("UPDATE forms SET status = 'failed', progress = NULL, error = ?, updated_at = ? "
                         "WHERE upload_id = ? AND page_number = ? AND status = 'processing'",
                         (_failure_message(error), iso(now), upload_id, number))
            _finish_upload_if_done(conn, upload_id)
            log.warning("עמוד %d בקובץ %s: נכשל אחרי %d ניסיונות (%s)",
                        number, upload_id, attempts, type(error).__name__)
            changed = _page_forms(conn, upload_id, number)
    for form_id in changed:
        events.form_changed(form_id)
    events.upload_changed(upload_id)
    events.queue_changed(skip=upload_id)   # ניסיון חוזר או עצירה משנים את הזמן המשוער של כולם


def clear_pause_message():
    """העצירה הסתיימה: מוחקים את ההודעה "ממתין: המכסה נגמרה" מהשורות שממתינות."""
    with db.connect() as conn:
        rows = conn.execute("UPDATE forms SET progress = NULL WHERE status = 'received' AND progress = ? RETURNING id",
                            (json.dumps(STEP_PAUSED, ensure_ascii=False),)).fetchall()
    for row in rows:
        events.form_changed(row["id"])
    log.info("העצירה הסתיימה: ממשיכים לקרוא עמודים")
