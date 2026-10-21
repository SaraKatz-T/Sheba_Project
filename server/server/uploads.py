"""קבצים (Upload): קליטה, שמירה בדיסק, ובניית האובייקט כפי שהחוזה מגדיר.

הקליטה משותפת להעלאה מהמחשב (POST /api/uploads) ולצילום מהטלפון (POST /api/capture/{token}/uploads).
"""

import hashlib
import os
import re
import secrets
from datetime import timedelta

from fastapi import UploadFile

from . import db, eta, events, filetypes, settings, thumbnails, worker
from .errors import ApiError
from .models import Upload
from .times import iso, utcnow

SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")


def _uploads_dir():
    return settings.STORAGE_DIR / "uploads"


def queue_position(conn, row) -> int | None:
    """כמה קבצים לפניו בתור הפיצול, כולל הוא עצמו (1 = הבא). רק בסטטוס queued."""
    if row["status"] != "queued":
        return None
    ahead = conn.execute(
        "SELECT COUNT(*) FROM uploads WHERE status = 'queued' AND (queued_at < ? OR (queued_at = ? AND id < ?))",
        (row["queued_at"], row["queued_at"], row["id"])).fetchone()[0]
    return ahead + 1


def load_upload(conn, upload_id: str) -> Upload | None:
    row = conn.execute("SELECT * FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None:
        return None
    form_ids = [r["id"] for r in conn.execute(
        "SELECT id FROM forms WHERE upload_id = ? ORDER BY page_number, position", (upload_id,))]
    # החוזה: form_count הוא null עד סוף הפיצול. אחרי הפיצול הוא יכול לגדול,
    # כשמתגלה בעמוד מספר התחייבות נוסף
    form_count = None if row["page_count"] is None else len(form_ids)
    return Upload(
        id=row["id"], file_name=row["file_name"], file_type=row["file_type"], file_size=row["file_size"],
        file_sha256=row["file_sha256"], source=row["source"], status=row["status"],
        received_at=row["received_at"], updated_at=row["updated_at"],
        page_count=row["page_count"], form_count=form_count, form_ids=form_ids,
        queue_position=queue_position(conn, row), eta_at=eta.eta_at(conn, row),
        thumbnail_url=f"/api/uploads/{upload_id}/thumbnail" if row["thumbnail_path"] else None,
        error=row["error"],
    )


def list_uploads(conn) -> list[Upload]:
    """כל הקבצים מ-24 השעות האחרונות, מהחדש לישן."""
    since = iso(utcnow() - timedelta(hours=24))
    ids = [r["id"] for r in conn.execute(
        "SELECT id FROM uploads WHERE received_at >= ? ORDER BY received_at DESC, queued_at DESC", (since,))]
    return [load_upload(conn, upload_id) for upload_id in ids]


def _save_file(upload_id: str, ext: str, data: bytes) -> str:
    """שומר את הקובץ בתיקייה משלו (מחוץ לכל תיקייה ציבורית). מחזיר נתיב יחסי ל-storage."""
    folder = _uploads_dir() / upload_id
    folder.mkdir(parents=True)
    target = folder / f"original{ext}"
    partial = folder / f"original{ext}.part"
    partial.write_bytes(data)
    os.replace(partial, target)   # הקובץ מופיע בשמו הסופי רק כשהוא שלם
    return target.relative_to(settings.STORAGE_DIR).as_posix()


def _save_thumbnail(upload_id: str, stored_path: str, file_type: str) -> str | None:
    data = thumbnails.make(settings.STORAGE_DIR / stored_path, file_type)
    if data is None:
        return None
    target = _uploads_dir() / upload_id / "thumbnail.jpg"
    target.write_bytes(data)
    return target.relative_to(settings.STORAGE_DIR).as_posix()


def receive(file: UploadFile, sha256: str, source: str, force: bool) -> Upload:
    """בודק את הקובץ, שומר אותו ויוצר Upload בסטטוס queued."""
    data = file.file.read(settings.MAX_UPLOAD_BYTES + 1)
    if not data:
        raise ApiError(400, "empty_file", "הקובץ ריק.")
    if len(data) > settings.MAX_UPLOAD_BYTES:
        raise ApiError(413, "file_too_large", "הקובץ גדול מ-25MB.")
    file_type = filetypes.detect(data[:32])
    if file_type is None:
        raise ApiError(415, "unsupported_type", "סוג הקובץ לא נתמך. אפשר לשלוח PDF, JPEG, PNG, TIFF, HEIC או WEBP.")
    if not SHA256_RE.match(sha256):
        raise ApiError(400, "bad_sha256", "טביעת האצבע של הקובץ לא תקינה.")
    actual = hashlib.sha256(data).hexdigest()
    if actual != sha256.lower():
        raise ApiError(400, "sha256_mismatch", "הקובץ לא הגיע בשלמותו. נסו לשלוח שוב.")

    with db.connect() as conn:
        if not force:
            existing = conn.execute(
                "SELECT id, file_name, received_at FROM uploads WHERE file_sha256 = ? "
                "ORDER BY received_at DESC LIMIT 1", (actual,)).fetchone()
            if existing:
                raise ApiError(409, "duplicate_file", "הקובץ הזה כבר נקלט.",
                               extra={"existing_upload": dict(existing)})

    upload_id = "u_" + secrets.token_hex(6)
    stored_path = _save_file(upload_id, filetypes.EXTENSIONS[file_type], data)
    thumbnail_path = _save_thumbnail(upload_id, stored_path, file_type)   # לפני התור, כדי שתוצג כבר בהמתנה
    now = utcnow()
    file_name = (file.filename or "ללא שם")[:255]
    with db.connect() as conn:
        conn.execute(
            "INSERT INTO uploads (id, file_name, file_type, file_size, file_sha256, source, status, "
            "received_at, updated_at, stored_path, queued_at, thumbnail_path) "
            "VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)",
            (upload_id, file_name, file_type, len(data), actual, source,
             iso(now), iso(now), stored_path, now.isoformat(), thumbnail_path))
        upload = load_upload(conn, upload_id)
    events.upload_changed(upload_id)
    worker.wake()   # עובד הפיצול לוקח אותו מהתור
    return upload
