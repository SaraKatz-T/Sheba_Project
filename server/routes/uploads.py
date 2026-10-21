"""קבצים: POST /api/uploads (קליטה), GET /api/uploads, GET /api/uploads/{id},
GET /api/uploads/{id}/thumbnail, POST /api/uploads/{id}/retry."""

from typing import Literal

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import FileResponse

from .. import db, events, review, settings
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


@router.get("/{upload_id}/thumbnail", response_class=FileResponse)
def get_thumbnail(upload_id: str):
    with db.connect() as conn:
        row = conn.execute("SELECT thumbnail_path FROM uploads WHERE id = ?", (upload_id,)).fetchone()
    if row is None or not row["thumbnail_path"]:
        raise ApiError(404)
    return FileResponse(settings.STORAGE_DIR / row["thumbnail_path"], media_type="image/jpeg")


@router.get("/{upload_id}", response_model=Upload)
def get_upload(upload_id: str):
    with db.connect() as conn:
        upload = load_upload(conn, upload_id)
    if upload is None:
        raise ApiError(404)
    return upload
