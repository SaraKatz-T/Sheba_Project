"""מחיקת תמונות: תמונת עמוד 24 שעות אחרי שאושרה השורה האחרונה בעמוד, ותמונה מוקטנת 24 שעות אחרי הקליטה.

עמוד עם 2 מספרי התחייבות נמחק רק כששתי השורות אושרו. הפרטים שנקראו (שם, ת"ז וכו') נשארים;
רק התמונה נמחקת, ו-image_path מתאפס.
"""

import logging
from datetime import timedelta

from .. import db, settings
from ..times import iso, utcnow

log = logging.getLogger("server.worker")


def delete_old_images() -> int:
    """מוחק את התמונות שהגיע זמנן. מחזיר כמה נמחקו."""
    cutoff = iso(utcnow() - timedelta(hours=settings.IMAGE_KEEP_HOURS))
    with db.connect() as conn:
        pages = conn.execute(
            "SELECT p.upload_id, p.number, p.image_path FROM pages p "
            "JOIN forms f ON f.upload_id = p.upload_id AND f.page_number = p.number "
            "WHERE p.image_path IS NOT NULL "
            "GROUP BY p.upload_id, p.number "
            "HAVING SUM(f.status != 'approved') = 0 AND MAX(f.reviewed_at) <= ?", (cutoff,)).fetchall()
    for page in pages:
        (settings.STORAGE_DIR / page["image_path"]).unlink(missing_ok=True)
        with db.connect() as conn:
            conn.execute("UPDATE pages SET image_path = NULL WHERE upload_id = ? AND number = ?",
                         (page["upload_id"], page["number"]))
    if pages:
        log.info("נמחקו %d תמונות עמודים (%d שעות אחרי האישור)", len(pages), settings.IMAGE_KEEP_HOURS)
    return len(pages)


def delete_old_thumbnails() -> int:
    """התמונה המוקטנת נמחקת 24 שעות אחרי הקליטה: אחרי זה הקובץ כבר לא מוצג בתור הקליטה."""
    cutoff = iso(utcnow() - timedelta(hours=settings.THUMBNAIL_KEEP_HOURS))
    with db.connect() as conn:
        rows = conn.execute("SELECT id, thumbnail_path FROM uploads WHERE thumbnail_path IS NOT NULL "
                            "AND received_at <= ?", (cutoff,)).fetchall()
    for row in rows:
        (settings.STORAGE_DIR / row["thumbnail_path"]).unlink(missing_ok=True)
        with db.connect() as conn:
            conn.execute("UPDATE uploads SET thumbnail_path = NULL WHERE id = ?", (row["id"],))
    if rows:
        log.info("נמחקו %d תמונות מוקטנות (%d שעות אחרי הקליטה)", len(rows), settings.THUMBNAIL_KEEP_HOURS)
    return len(rows)
