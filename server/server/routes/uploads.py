"""קבצים: POST /api/uploads (קליטה), GET /api/uploads, GET /api/uploads/{id},
GET /api/uploads/{id}/thumbnail, POST /api/uploads/{id}/retry,
POST /api/uploads/{id}/pause, POST /api/uploads/{id}/resume, DELETE /api/uploads/{id}."""

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile

from .. import crypto, db, events, review, settings, upload_control
from ..auth import require_session
from ..errors import ApiError
from ..models import Upload, UploadList
from ..uploads import list_uploads, load_upload, receive

router = APIRouter(prefix="/api/uploads", tags=["uploads"], dependencies=[Depends(require_session)])


@router.post("", status_code=202, response_model=Upload)
def create_upload(file: UploadFile = File(...),
                  sha256: str = Form(...),
                  source: Literal["upload", "demo"] = Form("upload"),
                  force: bool = Form(False)):
    return receive(file, sha256, source, force)


@router.get("", response_model=UploadList)
def get_uploads():
    with db.connect() as conn:
        return UploadList(items=list_uploads(conn))


@router.post("/{upload_id}/retry", status_code=202, response_model=Upload)
def retry_upload(upload_id: str):
    with db.connect() as conn:
        review.retry_upload(conn, upload_id)
        upload = load_upload(conn, upload_id)
    events.upload_changed(upload_id)
    events.queue_changed(skip=upload_id)
    return upload


def _changed(upload_id: str) -> Upload:
    with db.connect() as conn:
        upload = load_upload(conn, upload_id)
    events.upload_changed(upload_id)
    events.queue_changed(skip=upload_id)   # קובץ שנעצר לא נספר בזמן המשוער של אחרים
    return upload


@router.post("/{upload_id}/pause", response_model=Upload)
def pause_upload(upload_id: str):
    with db.connect() as conn:
        reset = upload_control.pause(conn, upload_id)
    for form_id in reset:
        events.form_changed(form_id)
    return _changed(upload_id)


@router.post("/{upload_id}/resume", response_model=Upload)
def resume_upload(upload_id: str):
    with db.connect() as conn:
        upload_control.resume(conn, upload_id)
    return _changed(upload_id)


@router.delete("/{upload_id}", status_code=204)
def remove_upload(upload_id: str, keep_read: bool = False):
    with db.connect() as conn:
        form_ids, files = upload_control.remove(conn, upload_id, keep_read)
    upload_control.delete_files(files)
    upload_control.publish_removed(upload_id, form_ids)
    events.queue_changed()
    return Response(status_code=204)


@router.get("/{upload_id}/thumbnail", response_class=Response)
def get_thumbnail(upload_id: str):
    with db.connect() as conn:
        row = conn.execute("SELECT thumbnail_path FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None or not row["thumbnail_path"]:
        raise ApiError(404)
    try:
        data = crypto.read_file(settings.STORAGE_DIR / row["thumbnail_path"])   # מפוענח בזיכרון בלבד
    except (OSError, crypto.CryptoError):
        raise ApiError(404)
    return Response(data, media_type="image/jpeg")


@router.get("/{upload_id}", response_model=Upload)
def get_upload(upload_id: str):
    with db.connect() as conn:
        upload = load_upload(conn, upload_id)
    if upload is None:
        raise ApiError(404)
    return upload
