"""עובד הפיצול: מפרק קובץ לעמודים, מכין כל עמוד כתמונה ויוצר שורה (טופס) לכל עמוד.

רץ בחוט אחד בלבד: pypdfium2 לא מאפשר עבודה במקביל.
משתמש בקוד הקיים כמו שהוא: load_pages (פירוק), straighten (יישור), fit_size (הקטנה).
"""

import io
import logging
import secrets
import shutil
import time

from PIL import Image

from commitment_extractor.page_loader import load_pages
from commitment_extractor.preprocess import fit_size, straighten

from .. import db, events, settings
from ..times import iso, utcnow
from . import PDFIUM_LOCK, wake

log = logging.getLogger("server.worker")

ERROR_UNREADABLE = "לא הצלחנו לקרוא את הקובץ. ייתכן שהוא פגום או מוצפן."
ERROR_EMPTY = "הקובץ ריק: לא נמצאו בו עמודים."


def claim_upload() -> str | None:
    """לוקח את הקובץ הוותיק ביותר שממתין בתור ומעביר אותו ל-splitting."""
    with db.connect() as conn:
        row = conn.execute(
            "UPDATE uploads SET status = 'splitting', updated_at = ? WHERE id = "
            "(SELECT id FROM uploads WHERE status = 'queued' ORDER BY queued_at, id LIMIT 1) RETURNING id",
            (iso(utcnow()),)).fetchone()
    return row["id"] if row else None


def _fail(upload_id: str, error: str):
    with db.connect() as conn:
        conn.execute("UPDATE uploads SET status = 'failed', error = ?, updated_at = ? WHERE id = ?",
                     (error, iso(utcnow()), upload_id))
    events.upload_changed(upload_id)


def split_upload(upload_id: str):
    events.upload_changed(upload_id)
    events.queue_changed()   # התור זז: המקום בתור של כל השאר השתנה
    with db.connect() as conn:
        row = conn.execute("SELECT source, stored_path FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    original = settings.STORAGE_DIR / row["stored_path"]
    pages_dir = settings.STORAGE_DIR / "uploads" / upload_id / "pages"
    shutil.rmtree(pages_dir, ignore_errors=True)   # שאריות מפיצול שנקטע באמצע
    pages_dir.mkdir(parents=True)
    prepare = row["source"] != "phone"   # צילום מהטלפון כבר מיושר, חתוך ומוקטן
    started = time.monotonic()

    pages = []
    page_iter = load_pages(original)
    try:
        while True:
            with PDFIUM_LOCK:   # רק ציור העמוד עצמו; היישור וההקטנה רצים בלי המנעול
                page = next(page_iter, None)
            if page is None:
                break
            with Image.open(io.BytesIO(page.png_bytes)) as img:
                img = img.convert("RGB")
                if prepare:
                    img, _ = straighten(img)
                    img = fit_size(img)
                target = pages_dir / f"p{page.page_number:03d}.png"
                img.save(target, format="PNG")
                pages.append((page.page_number, img.width, img.height,
                              target.relative_to(settings.STORAGE_DIR).as_posix()))
    except Exception as e:
        with PDFIUM_LOCK:
            page_iter.close()   # סוגר את ה-PDF בתוך המנעול
        log.warning("קובץ %s: הפיצול נכשל (%s)", upload_id, type(e).__name__)
        shutil.rmtree(pages_dir, ignore_errors=True)
        _fail(upload_id, ERROR_UNREADABLE)
        return
    if not pages:
        _fail(upload_id, ERROR_EMPTY)
        return

    now = iso(utcnow())
    form_ids = []
    with db.connect() as conn:
        for number, width, height, image_path in pages:
            form_id = "f_" + secrets.token_hex(6)
            conn.execute("INSERT INTO pages (upload_id, number, width, height, image_path) VALUES (?, ?, ?, ?, ?)",
                         (upload_id, number, width, height, image_path))
            conn.execute("INSERT INTO forms (id, upload_id, page_number, position, status, updated_at) "
                         "VALUES (?, ?, ?, 1, 'received', ?)", (form_id, upload_id, number, now))
            form_ids.append(form_id)
        conn.execute("UPDATE uploads SET status = 'processing', page_count = ?, stored_path = NULL, error = NULL, "
                     "updated_at = ? WHERE id = ?", (len(pages), now, upload_id))
    original.unlink(missing_ok=True)   # הקובץ המקורי כבר לא נחוץ: מעכשיו עובדים רק עם תמונות העמודים
    log.info("קובץ %s: פוצל ל-%d עמודים (%.1f שנ')", upload_id, len(pages), time.monotonic() - started)

    events.upload_changed(upload_id)
    for form_id in form_ids:
        events.form_changed(form_id)
    events.queue_changed(skip=upload_id)   # עכשיו ידוע כמה עמודים יש בו: הזמן המשוער של הבאים אחריו השתנה
    wake()   # עובדי הקריאה לוקחים את העמודים
