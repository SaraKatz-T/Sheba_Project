"""עובד הפיצול: מפרק קובץ לעמודים, מכין כל עמוד כתמונה ויוצר שורה (טופס) לכל עמוד.

- ציור העמוד מה-PDF רץ אחד-אחד: pypdfium2 לא מאפשר עבודה במקביל.
- היישור (Tesseract), ההקטנה והשמירה רצים במקביל על כמה עמודים (SPLIT_THREADS).
- כל עמוד נכנס לתור הקריאה ברגע שהוא מוכן, כך ש-Gemini מתחיל לעבוד עוד לפני שכל הקובץ פוצל.
- פיצול שנקטע (כיבוי, שגיאה, ניסיון חוזר, "עצור") ממשיך מאיפה שעצר: עמוד שכבר נמצא במסד לא נוצר שוב.
- "עצור" או "הסר" באמצע: הפיצול נעצר אחרי העמוד הנוכחי. בעצירה הקובץ חוזר ל-queued עד "המשך".
"""

import io
import logging
import secrets
import shutil
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait

from PIL import Image

from commitment_extractor.page_loader import iter_images
from commitment_extractor.preprocess import fit_size, straighten

from .. import crypto, db, events, settings
from ..times import iso, utcnow
from . import PDFIUM_LOCK, wake
from .reader import _finish_upload_if_done

log = logging.getLogger("server.worker")

ERROR_UNREADABLE = "לא הצלחנו לקרוא את הקובץ. ייתכן שהוא פגום או מוצפן."
ERROR_EMPTY = "הקובץ ריק: לא נמצאו בו עמודים."


def claim_upload() -> str | None:
    """לוקח את הקובץ הוותיק ביותר שממתין בתור ומעביר אותו ל-splitting."""
    with db.connect() as conn:
        row = conn.execute(
            "UPDATE uploads SET status = 'splitting', updated_at = ? WHERE id = "
            "(SELECT id FROM uploads WHERE status = 'queued' AND paused = 0 AND removed_at IS NULL "
            "ORDER BY queued_at, id LIMIT 1) RETURNING id",
            (iso(utcnow()),)).fetchone()
    return row["id"] if row else None


def _fail(upload_id: str, error: str):
    with db.connect() as conn:
        conn.execute("UPDATE uploads SET status = 'failed', error = ?, updated_at = ? "
                     "WHERE id = ? AND removed_at IS NULL",
                     (error, iso(utcnow()), upload_id))
    events.upload_changed(upload_id)


def _prepare(img: Image.Image, prepare: bool, target) -> tuple[int, int]:
    """יישור, הקטנה ושמירה (מוצפנת) של עמוד אחד. רץ בחוט נפרד."""
    if prepare:
        img, _ = straighten(img)
        img = fit_size(img)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    crypto.write_file(target, buf.getvalue())
    return img.width, img.height


def _stop_reason(upload_id: str) -> str | None:
    """האם המשתמש עצר או הסיר את הקובץ באמצע הפיצול."""
    with db.connect() as conn:
        row = conn.execute("SELECT paused, removed_at FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None or row["removed_at"]:
        return "removed"
    if row["paused"]:
        return "paused"
    return None


def _add_page(upload_id: str, number: int, width: int, height: int, image_path: str) -> bool:
    """מכניס עמוד מוכן ושורה שלו לתור הקריאה, ומעיר את עובדי הקריאה.
    קובץ שהוסר בינתיים לא מקבל עמודים חדשים."""
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")   # הבדיקה וההכנסה יחד: "הסר" לא יכול להיכנס ביניהן
        if not conn.execute("SELECT 1 FROM uploads WHERE id = ? AND removed_at IS NULL", (upload_id,)).fetchone():
            return False
        cur = conn.execute("INSERT OR IGNORE INTO pages (upload_id, number, width, height, image_path) "
                           "VALUES (?, ?, ?, ?, ?)", (upload_id, number, width, height, image_path))
        if cur.rowcount == 0:
            return False
        form_id = "f_" + secrets.token_hex(6)
        conn.execute("INSERT INTO forms (id, upload_id, page_number, position, status, updated_at) "
                     "VALUES (?, ?, ?, 1, 'received', ?)", (form_id, upload_id, number, iso(utcnow())))
    events.form_changed(form_id)
    events.upload_changed(upload_id)
    wake()
    return True


def _cleanup_removed(upload_id: str, original):
    """הקובץ הוסר בזמן הפיצול. אם נמחק לגמרי, מוחקים את התיקייה שלו; אם הטפסים שנקראו נשמרו,
    מוחקים רק את הקובץ המקורי (ב-Windows הוא היה נעול בזמן הפיצול, ולכן ההסרה לא הצליחה למחוק אותו)."""
    with db.connect() as conn:
        exists = conn.execute("SELECT 1 FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if exists:
        original.unlink(missing_ok=True)
    else:
        shutil.rmtree(settings.STORAGE_DIR / "uploads" / upload_id, ignore_errors=True)


def split_upload(upload_id: str):
    events.upload_changed(upload_id)
    events.queue_changed()   # התור זז: המקום בתור של כל השאר השתנה
    with db.connect() as conn:
        row = conn.execute("SELECT source, stored_path FROM uploads WHERE id = ?", (upload_id,)).fetchone()
        existing = {r["number"] for r in conn.execute("SELECT number FROM pages WHERE upload_id = ?", (upload_id,))}
    if row is None or not row["stored_path"]:   # הוסר בין הלקיחה מהתור לתחילת הפיצול
        return
    original = settings.STORAGE_DIR / row["stored_path"]
    pages_dir = settings.STORAGE_DIR / "uploads" / upload_id / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    prepare = row["source"] != "phone"   # צילום מהטלפון כבר מיושר, חתוך ומוקטן
    started = time.monotonic()
    added = 0

    def collect(futures: set[Future]) -> Exception | None:
        """מכניס לתור את העמודים שסיימו. מחזיר את השגיאה הראשונה, אם הייתה."""
        nonlocal added
        error = None
        for future in futures:
            number, target = in_flight.pop(future)
            try:
                width, height = future.result()
            except Exception as e:
                error = error or e
                continue
            if _add_page(upload_id, number, width, height, target.relative_to(settings.STORAGE_DIR).as_posix()):
                added += 1
            elif number not in existing:
                target.unlink(missing_ok=True)   # הקובץ הוסר: התמונה שהוכנה לא נחוצה
        return error

    threads = max(settings.SPLIT_THREADS, 1)
    in_flight: dict[Future, tuple[int, object]] = {}
    error: Exception | None = None
    stopped: str | None = None
    try:
        data = crypto.read_file(original)   # מפוענח בזיכרון בלבד
    except (OSError, crypto.CryptoError) as e:
        log.warning("קובץ %s: אי אפשר לפענח את הקובץ המקורי (%s)", upload_id, type(e).__name__)
        _fail(upload_id, ERROR_UNREADABLE)
        return
    page_iter = iter_images(original, data)
    pool = ThreadPoolExecutor(max_workers=threads, thread_name_prefix=f"split-{upload_id}")
    try:
        while error is None:
            stopped = _stop_reason(upload_id)
            if stopped:
                break
            with PDFIUM_LOCK:   # רק ציור העמוד עצמו; היישור וההקטנה רצים בלי המנעול
                item = next(page_iter, None)
            if item is None:
                break
            number, img = item
            if number in existing:   # כבר נוצר בפיצול קודם שנקטע
                continue
            target = pages_dir / f"p{number:03d}.png"
            in_flight[pool.submit(_prepare, img, prepare, target)] = (number, target)
            if len(in_flight) >= threads * 2:   # לא מציירים הרבה יותר עמודים ממה שמספיקים להכין
                finished, _ = wait(list(in_flight), return_when=FIRST_COMPLETED)
                error = collect(finished)
    except Exception as e:
        error = e
    finally:
        with PDFIUM_LOCK:
            page_iter.close()   # סוגר את ה-PDF בתוך המנעול
        pool.shutdown(wait=True)
        error = collect(set(in_flight)) or error   # עמודים שהוכנו לפני שגיאה עדיין נכנסים לתור

    total = len(existing) + added
    if stopped is None and _stop_reason(upload_id) == "removed":   # הוסר בזמן שהעמודים האחרונים הוכנו
        stopped = "removed"
    if stopped == "removed":
        _cleanup_removed(upload_id, original)
        log.info("קובץ %s: הוסר באמצע הפיצול", upload_id)
        return
    if stopped == "paused":
        with db.connect() as conn:   # חוזר לתור, במקום שלו. "המשך" ממשיך מהעמוד הבא
            conn.execute("UPDATE uploads SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'splitting'",
                         (iso(utcnow()), upload_id))
        log.info("קובץ %s: נעצר באמצע הפיצול, אחרי %d עמודים", upload_id, total)
        events.upload_changed(upload_id)
        return
    if error is not None:
        log.warning("קובץ %s: הפיצול נכשל אחרי %d עמודים (%s)", upload_id, total, type(error).__name__)
        if total == 0:
            shutil.rmtree(pages_dir, ignore_errors=True)
        # הקובץ המקורי נשאר: ניסיון חוזר ממשיך מהעמוד שבו הפיצול נעצר
        _fail(upload_id, ERROR_UNREADABLE)
        return
    if total == 0:
        _fail(upload_id, ERROR_EMPTY)
        return

    with db.connect() as conn:
        cur = conn.execute("UPDATE uploads SET status = 'processing', page_count = ?, stored_path = NULL, error = NULL, "
                           "updated_at = ? WHERE id = ? AND status = 'splitting' AND removed_at IS NULL",
                           (total, iso(utcnow()), upload_id))
        if cur.rowcount == 0:   # הוסר ממש בסוף הפיצול
            _cleanup_removed(upload_id, original)
            return
        done = _finish_upload_if_done(conn, upload_id)   # אם כל העמודים כבר נקראו בזמן הפיצול
    original.unlink(missing_ok=True)   # הקובץ המקורי כבר לא נחוץ: מעכשיו עובדים רק עם תמונות העמודים
    log.info("קובץ %s: פוצל ל-%d עמודים (%.1f שנ')", upload_id, total, time.monotonic() - started)

    events.upload_changed(upload_id)
    events.queue_changed(skip=upload_id)   # עכשיו ידוע כמה עמודים יש בו
    if done:
        log.info("קובץ %s: הסתיים", upload_id)
