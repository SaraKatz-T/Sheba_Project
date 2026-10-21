"""בדיקה ואישור: תיקון שדה, אישור, דחייה, ניסיון חוזר ומיזוג.

תיקון של שדה משותף (שם, ת"ז, מספר מרכזי וכו') נשמר פעם אחת אצל המטופל, ולכן מופיע מיד בכל השורות
של אותו עמוד. רק מספר ההתחייבות שייך לשורה עצמה. כל שינוי נרשם בהיסטוריה (field_history).
כל פונקציה מחזירה את מזהי השורות שהשתנו, כדי לשלוח עליהן form.updated.
"""

from . import worker
from .errors import ApiError
from .times import iso, utcnow


def _form(conn, form_id: str):
    row = conn.execute("SELECT * FROM forms WHERE id = ?", (form_id,)).fetchone()
    if row is None:
        raise ApiError(404)
    return row


def _require_status(row, *statuses: str, message: str):
    if row["status"] not in statuses:
        raise ApiError(409, "wrong_status", message)


def update_field(conn, form_id: str, key: str, value: str, source: str):
    """PATCH /api/forms/{id}/fields/{key}. מחזיר (השדה המעודכן, מזהי השורות שהשתנו)."""
    form = _form(conn, form_id)
    _require_status(form, "pending_review", message="אפשר לתקן רק טופס שממתין לבדיקה.")
    field = conn.execute("SELECT * FROM fields WHERE key = ? AND (form_id = ? OR record_id = ?)",
                         (key, form_id, form["record_id"])).fetchone()
    if field is None:
        raise ApiError(404, message="השדה לא קיים בטופס הזה.")

    old = field["value"]
    if source == "confirmed":   # הערך הנוכחי נכון: רק מאשרים, בלי לשנות
        new, original = old, field["original_value"]
    else:
        new = value.strip()
        original = field["original_value"] if field["original_value"] is not None else old   # נשמר בתיקון הראשון
    corrected = original is not None and new != original
    if not corrected:
        original = None   # חזרו לערך המקורי: השדה כבר לא נחשב מתוקן
    conn.execute("UPDATE fields SET value = ?, uncertain = 0, corrected = ?, original_value = ? WHERE id = ?",
                 (new, int(corrected), original, field["id"]))
    now = iso(utcnow())
    conn.execute("INSERT INTO field_history (field_id, form_id, old_value, new_value, source, changed_at) "
                 "VALUES (?, ?, ?, ?, ?, ?)", (field["id"], form_id, old, new, source, now))

    if field["record_id"]:   # שדה משותף: כל השורות של המטופל השתנו
        changed = [r["id"] for r in conn.execute("SELECT id FROM forms WHERE record_id = ?", (field["record_id"],))]
    else:
        changed = [form_id]
    conn.executemany("UPDATE forms SET updated_at = ? WHERE id = ?", [(now, f) for f in changed])
    updated = conn.execute("SELECT * FROM fields WHERE id = ?", (field["id"],)).fetchone()
    return updated, changed


def approve(conn, form_id: str) -> list[str]:
    """שדות צהובים שנשארו פתוחים נחשבים מאושרים כפי שהם: הסימון הצהוב יורד.
    שדות משותפים (שם, ת"ז...) יורדים מהצהוב גם בשורות האחרות של אותו מטופל, כי אלה אותם ערכים בדיוק."""
    form = _form(conn, form_id)
    _require_status(form, "pending_review", message="אפשר לאשר רק טופס שממתין לבדיקה.")
    now = iso(utcnow())
    conn.execute("UPDATE forms SET status = 'approved', reviewed_at = ?, updated_at = ? WHERE id = ?",
                 (now, now, form_id))
    conn.execute("UPDATE fields SET uncertain = 0 WHERE form_id = ? OR record_id = ?", (form_id, form["record_id"]))
    if not form["record_id"]:
        return [form_id]
    siblings = [r["id"] for r in conn.execute("SELECT id FROM forms WHERE record_id = ?", (form["record_id"],))]
    conn.executemany("UPDATE forms SET updated_at = ? WHERE id = ?", [(now, f) for f in siblings])
    return siblings


def reject(conn, form_id: str, reason: str | None) -> list[str]:
    form = _form(conn, form_id)
    _require_status(form, "pending_review", "failed", message="אפשר לדחות רק טופס שממתין לבדיקה או שנכשל.")
    now = iso(utcnow())
    conn.execute("UPDATE forms SET status = 'rejected', reviewed_at = ?, reject_reason = ?, updated_at = ? "
                 "WHERE id = ?", (now, reason, now, form_id))
    return [form_id]


def retry_form(conn, form_id: str) -> list[str]:
    """טופס שנכשל חוזר לתור הקריאה, בלי לפצל מחדש את הקובץ."""
    form = _form(conn, form_id)
    _require_status(form, "failed", message="אפשר לנסות שוב רק טופס שנכשל.")
    now = iso(utcnow())
    conn.execute("UPDATE forms SET status = 'received', error = NULL, progress = NULL, updated_at = ? "
                 "WHERE upload_id = ? AND page_number = ? AND status = 'failed'",
                 (now, form["upload_id"], form["page_number"]))
    conn.execute("UPDATE pages SET attempts = 0, retry_at = NULL WHERE upload_id = ? AND number = ?",
                 (form["upload_id"], form["page_number"]))
    # לקובץ יש שוב עבודה פתוחה
    conn.execute("UPDATE uploads SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'done'",
                 (now, form["upload_id"]))
    worker.wake()
    return [r["id"] for r in conn.execute("SELECT id FROM forms WHERE upload_id = ? AND page_number = ?",
                                          (form["upload_id"], form["page_number"]))]


def retry_upload(conn, upload_id: str):
    """קובץ שנכשל בפיצול חוזר לסוף תור הפיצול."""
    row = conn.execute("SELECT status, stored_path FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None:
        raise ApiError(404)
    if row["status"] != "failed":
        raise ApiError(409, "wrong_status", "אפשר לנסות שוב רק קובץ שנכשל.")
    if not row["stored_path"]:
        raise ApiError(409, "file_missing", "הקובץ המקורי כבר לא קיים. צריך להעלות אותו מחדש.")
    now = utcnow()
    conn.execute("UPDATE uploads SET status = 'queued', error = NULL, updated_at = ?, queued_at = ? WHERE id = ?",
                 (iso(now), now.isoformat(), upload_id))
    worker.wake()


def merge(conn, form_id: str, into: str, values: dict[str, str]) -> list[str]:
    """ממזג את form_id לתוך into: הערכים שנבחרו נשמרים ביעד כתיקון ידני, והמקור עובר ל-rejected."""
    if form_id == into:
        raise ApiError(400, message="אי אפשר למזג טופס לתוך עצמו.")
    source = _form(conn, form_id)
    _require_status(source, "pending_review", "failed", message="אפשר למזג רק טופס שממתין לבדיקה או שנכשל.")
    target = _form(conn, into)
    _require_status(target, "pending_review", message="אפשר למזג רק לתוך טופס שממתין לבדיקה.")
    changed = {form_id, into}
    for key, value in values.items():
        try:
            _, affected = update_field(conn, into, key, value, "manual")
        except ApiError as e:
            if e.status == 404:   # שדה שלא קיים ביעד: הבקשה לא תקינה (וכל המיזוג מבוטל)
                raise ApiError(400, message=f"השדה {key} לא קיים בטופס היעד.")
            raise
        changed.update(affected)
    now = iso(utcnow())
    conn.execute("UPDATE forms SET status = 'rejected', merged_into = ?, reviewed_at = ?, updated_at = ? "
                 "WHERE id = ?", (into, now, now, form_id))
    return list(changed)
