"""עדכונים חיים ללקוח: upload.updated / form.updated, תמיד עם האובייקט המלא.

כל מקום בקוד שמשנה קובץ או טופס (בקשות, עובדים) קורא לפונקציות כאן. הן קוראות את המצב העדכני
ממסד הנתונים ושולחות לכל המחוברים. אפשר לקרוא להן מכל חוט. כשאין מחוברים, הן לא עושות כלום.
"""

from . import db, live


def upload_changed(upload_id: str):
    if not live.has_clients():
        return
    from .uploads import load_upload
    with db.connect() as conn:
        upload = load_upload(conn, upload_id)
    if upload is not None:
        live.publish({"type": "upload.updated", "upload": upload.model_dump()})


def form_changed(form_id: str):
    if not live.has_clients():
        return
    from .forms import load_form
    with db.connect() as conn:
        form = load_form(conn, form_id)
    if form is not None:
        live.publish({"type": "form.updated", "form": form.model_dump()})


def queue_changed(skip: str | None = None):
    """התור זז: המקום בתור והזמן המשוער של כל הקבצים הפעילים השתנו."""
    if not live.has_clients():
        return
    with db.connect() as conn:
        ids = [r["id"] for r in conn.execute(
            "SELECT id FROM uploads WHERE status IN ('queued', 'splitting', 'processing') ORDER BY queued_at")]
    for upload_id in ids:
        if upload_id != skip:
            upload_changed(upload_id)
