"""סל המחזור: מחיקה ושחזור של רשומות (POST /api/forms/delete, .../restore, GET /api/forms/trash).

- מחיקה מעבירה רשומות לסל המחזור (deleted_at). הן לא מופיעות ברשימת הרשומות, בייצוא ובזיהוי כפילויות.
- שחזור מחזיר אותן בדיוק כמו שהיו.
- אחרי TRASH_KEEP_DAYS ימים הן נמחקות לתמיד, עם התמונות שלהן (purge, מעובד הניקוי).
- רשומה שעוד בעיבוד (received / processing) לא נמחקת כאן: עוצרים אותה דרך "הסר" בתור הקליטה.
"""

import logging
import shutil
from datetime import timedelta

from . import db, live, settings, upload_control
from .errors import ApiError
from .times import iso, utcnow

log = logging.getLogger("server.trash")

IN_PROGRESS = ("received", "processing")


def _in(values) -> str:
    return ",".join("?" * len(values))


def delete(conn, form_ids: list[str]) -> list[str]:
    """מעביר לסל המחזור. מחזיר את השורות שנמחקו עכשיו (שורה שכבר בסל לא נספרת שוב)."""
    ids = sorted(set(form_ids))
    conn.execute("BEGIN IMMEDIATE")
    rows = conn.execute(f"SELECT id, status, deleted_at FROM forms WHERE id IN ({_in(ids)})", ids).fetchall()
    if len(rows) != len(ids):
        raise ApiError(404, message="אחד הטפסים לא קיים.")
    if any(r["status"] in IN_PROGRESS for r in rows):
        raise ApiError(409, "in_progress", "אי אפשר למחוק טופס שעוד בעיבוד. אפשר לעצור את הקובץ בתור הקליטה.")
    fresh = [r["id"] for r in rows if not r["deleted_at"]]
    if fresh:
        conn.execute(f"UPDATE forms SET deleted_at = ?, updated_at = ? WHERE id IN ({_in(fresh)})",
                     (iso(utcnow()), iso(utcnow()), *fresh))
    return fresh


def restore(conn, form_ids: list[str]) -> list[str]:
    ids = sorted(set(form_ids))
    conn.execute("BEGIN IMMEDIATE")
    found = conn.execute(f"SELECT COUNT(*) FROM forms WHERE id IN ({_in(ids)})", ids).fetchone()[0]
    if found != len(ids):
        raise ApiError(404, message="אחד הטפסים כבר נמחק לתמיד.")
    conn.execute(f"UPDATE forms SET deleted_at = NULL, updated_at = ? WHERE id IN ({_in(ids)}) "
                 "AND deleted_at IS NOT NULL", (iso(utcnow()), *ids))
    return ids


def publish_deleted(form_ids: list[str]):
    if form_ids:
        live.publish({"type": "form.deleted", "form_ids": form_ids})


def purge() -> int:
    """מוחק לתמיד את מה שבסל המחזור יותר מ-TRASH_KEEP_DAYS ימים. קובץ שלא נשארה בו אף רשומה נמחק גם הוא."""
    cutoff = iso(utcnow() - timedelta(days=settings.TRASH_KEEP_DAYS))
    with db.connect() as conn:
        conn.execute("BEGIN IMMEDIATE")
        old = conn.execute("SELECT id, upload_id FROM forms WHERE deleted_at IS NOT NULL AND deleted_at <= ?",
                           (cutoff,)).fetchall()
        by_upload: dict[str, list[str]] = {}
        for r in old:
            by_upload.setdefault(r["upload_id"], []).append(r["id"])
        images, folders = [], []
        for upload_id, ids in by_upload.items():
            images += upload_control._delete_forms(conn, upload_id, ids)
            if not conn.execute("SELECT 1 FROM forms WHERE upload_id = ?", (upload_id,)).fetchone():
                upload = conn.execute("SELECT status FROM uploads WHERE id = ?", (upload_id,)).fetchone()
                if upload and upload["status"] not in upload_control.ACTIVE:
                    conn.execute("DELETE FROM pages WHERE upload_id = ?", (upload_id,))
                    conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
                    folders.append(settings.STORAGE_DIR / "uploads" / upload_id)
    for path in images:
        (settings.STORAGE_DIR / path).unlink(missing_ok=True)
    for folder in folders:
        shutil.rmtree(folder, ignore_errors=True)
    if old:
        log.info("סל המחזור: %d רשומות נמחקו לתמיד (%d ימים אחרי המחיקה)", len(old), settings.TRASH_KEEP_DAYS)
    return len(old)
