"""עצירה, המשך והסרה של קובץ בעיבוד: POST /api/uploads/{id}/pause, .../resume, DELETE /api/uploads/{id}.

- "עצור": נעצר מיד. עמודים חדשים לא נשלחים לקריאה, והפיצול נעצר אחרי העמוד הנוכחי. עמוד שכבר
  נשלח ל-Gemini חוזר לתור: התשובה שלו נזרקת כשהיא מגיעה, והוא נקרא מחדש ב"המשך".
- "המשך": הקובץ חוזר לעבודה מאיפה שעצר.
- "הסר": העיבוד נפסק והקובץ יוצא מתור הקליטה (גם קובץ שהסתיים). keep_read=true שומר את הטפסים שכבר
  נקראו (ממתינים לבדיקה, אושרו או נדחו); keep_read=false מעביר אותם לסל המחזור. טפסים שעוד לא נקראו נמחקים.
"""

import logging
import shutil

from . import live, settings, worker
from .errors import ApiError
from .times import iso, utcnow

log = logging.getLogger("server.uploads")

ACTIVE = ("queued", "splitting", "processing")
UNREAD = ("received", "processing", "failed")   # טפסים שעוד אין בהם תוצאה לבדיקה


def _row(conn, upload_id: str):
    # כל פעולה כאן נועלת את המסד מההתחלה: עובד לא יכול להוסיף עמוד או לשמור תשובה באמצע
    conn.execute("BEGIN IMMEDIATE")
    row = conn.execute("SELECT * FROM uploads WHERE id = ? AND removed_at IS NULL", (upload_id,)).fetchone()
    if row is None:
        raise ApiError(404)
    return row


def pause(conn, upload_id: str) -> list[str]:
    """מחזיר את השורות שחזרו לתור (היו באמצע קריאה)."""
    row = _row(conn, upload_id)
    if row["status"] not in ACTIVE:
        raise ApiError(409, "wrong_status", "אפשר לעצור רק קובץ שבעיבוד.")
    now = iso(utcnow())
    conn.execute("UPDATE uploads SET paused = 1, updated_at = ? WHERE id = ?", (now, upload_id))
    # עמודים באמצע קריאה חוזרים לתור. הניסיון לא נספר, והתשובה שתגיע תיזרק (claim_id התאפס)
    conn.execute("UPDATE pages SET claim_id = NULL, started_at = NULL, attempts = MAX(attempts - 1, 0) "
                 "WHERE upload_id = ? AND number IN (SELECT page_number FROM forms "
                 "  WHERE upload_id = ? AND status = 'processing')", (upload_id, upload_id))
    return [r["id"] for r in conn.execute(
        "UPDATE forms SET status = 'received', progress = NULL, updated_at = ? "
        "WHERE upload_id = ? AND status = 'processing' RETURNING id", (now, upload_id))]


def resume(conn, upload_id: str):
    _row(conn, upload_id)
    conn.execute("UPDATE uploads SET paused = 0, updated_at = ? WHERE id = ?", (iso(utcnow()), upload_id))
    worker.wake()


def _in(values) -> str:
    return ",".join("?" * len(values))


def _delete_forms(conn, upload_id: str, form_ids: list[str]) -> list[str]:
    """מוחק את השורות, ואת העמודים שלא נשארה בהם אף שורה. מחזיר את נתיבי התמונות של העמודים שנמחקו."""
    if not form_ids:
        return []
    conn.execute(f"UPDATE forms SET merged_into = NULL WHERE merged_into IN ({_in(form_ids)})", form_ids)
    pages = [r["page_number"] for r in conn.execute(
        f"SELECT DISTINCT page_number FROM forms WHERE id IN ({_in(form_ids)})", form_ids)]
    empty_pages = [n for n in pages if not conn.execute(
        f"SELECT 1 FROM forms WHERE upload_id = ? AND page_number = ? AND id NOT IN ({_in(form_ids)})",
        (upload_id, n, *form_ids)).fetchone()]
    records = [r["id"] for r in conn.execute(
        f"SELECT id FROM records WHERE upload_id = ? AND page_number IN ({_in(empty_pages)})",
        (upload_id, *empty_pages))] if empty_pages else []

    fields = [r["id"] for r in conn.execute(
        f"SELECT id FROM fields WHERE form_id IN ({_in(form_ids)})"
        + (f" OR record_id IN ({_in(records)})" if records else ""), (*form_ids, *records))]
    if fields:
        conn.execute(f"DELETE FROM field_history WHERE field_id IN ({_in(fields)})", fields)
    conn.execute(f"DELETE FROM field_history WHERE form_id IN ({_in(form_ids)})", form_ids)
    if fields:
        conn.execute(f"DELETE FROM fields WHERE id IN ({_in(fields)})", fields)
    conn.execute(f"DELETE FROM forms WHERE id IN ({_in(form_ids)})", form_ids)
    if records:
        conn.execute(f"DELETE FROM records WHERE id IN ({_in(records)})", records)
    images = []
    if empty_pages:
        images = [r["image_path"] for r in conn.execute(
            f"SELECT image_path FROM pages WHERE upload_id = ? AND number IN ({_in(empty_pages)}) "
            "AND image_path IS NOT NULL", (upload_id, *empty_pages))]
        conn.execute(f"DELETE FROM pages WHERE upload_id = ? AND number IN ({_in(empty_pages)})",
                     (upload_id, *empty_pages))
    return images


def remove(conn, upload_id: str, keep_read: bool) -> tuple[list[str], list]:
    """"הסר": הקובץ יוצא מתור הקליטה. שורות שעוד לא נקראו נמחקות (אין בהן מידע). שורות שכבר נקראו
    נשארות (keep_read) או עוברות לסל המחזור, כך שאפשר לשחזר אותן עד TRASH_KEEP_DAYS ימים.
    מחזיר את השורות שיצאו מרשימת הרשומות, ואת הקבצים שצריך למחוק מהדיסק אחרי שהשינוי נשמר."""
    row = _row(conn, upload_id)
    now = iso(utcnow())
    rows = conn.execute("SELECT id, status, deleted_at FROM forms WHERE upload_id = ?", (upload_id,)).fetchall()
    unread = [r["id"] for r in rows if r["status"] in UNREAD]
    read = [r["id"] for r in rows if r["status"] not in UNREAD]
    folder = settings.STORAGE_DIR / "uploads" / upload_id

    if not read:   # אין מה לשמור: הקובץ נמחק לגמרי
        _delete_forms(conn, upload_id, unread)
        conn.execute("DELETE FROM pages WHERE upload_id = ?", (upload_id,))   # עמודים שעוד אין להם שורה
        conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
        log.info("קובץ %s: הוסר ונמחק לגמרי", upload_id)
        return unread, [folder]

    images = _delete_forms(conn, upload_id, unread)
    trashed = []
    if not keep_read:
        trashed = [r["id"] for r in rows if r["id"] in read and not r["deleted_at"]]
        if trashed:
            conn.execute(f"UPDATE forms SET deleted_at = ?, updated_at = ? WHERE id IN ({_in(trashed)})",
                         (now, now, *trashed))
    pages_left = conn.execute("SELECT COUNT(*) FROM pages WHERE upload_id = ?", (upload_id,)).fetchone()[0]
    # הקובץ יוצא מתור הקליטה; השורה שלו נשארת, כי הרשומות שנשארו (או שבסל) מציגות את שם הקובץ
    conn.execute("UPDATE uploads SET status = 'done', paused = 0, removed_at = ?, page_count = ?, "
                 "stored_path = NULL, error = NULL, updated_at = ? WHERE id = ?",
                 (now, pages_left, now, upload_id))
    to_delete = [settings.STORAGE_DIR / p for p in images]
    if row["stored_path"]:
        to_delete.append(settings.STORAGE_DIR / row["stored_path"])
    log.info("קובץ %s: הוסר; %d רשומות לסל המחזור, %d נשמרו", upload_id, len(trashed),
             len(read) - len(trashed))
    return unread + trashed, to_delete


def delete_files(paths: list):
    for path in paths:
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)   # אם הפיצול עדיין מחזיק קובץ, הוא ימחק את התיקייה בעצמו
        else:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass   # קובץ נעול (הפיצול באמצע): הפיצול מוחק אותו כשהוא נעצר


def publish_removed(upload_id: str, form_ids: list[str]):
    live.publish({"type": "upload.removed", "upload_id": upload_id, "form_ids": form_ids})
