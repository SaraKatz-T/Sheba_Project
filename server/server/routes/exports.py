"""ייצוא: POST /api/exports. הלקוח בונה את קובץ האקסל ושולח אותו לכאן, והשרת מעביר אותו למעבדה."""

import re

from fastapi import APIRouter, Depends, File, Form, UploadFile

from .. import lab_export, settings
from ..auth import require_session
from ..errors import ApiError
from ..models import ExportResult

router = APIRouter(prefix="/api/exports", tags=["exports"], dependencies=[Depends(require_session)])

DEFAULT_NAME = "טפסי התחייבות.xlsx"


def _safe_name(name: str) -> str:
    # השם מגיע כשדה טקסט נפרד: שם בעברית לא תמיד עובר שלם בשם הקובץ של multipart
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "", name).strip()[:120]
    return name if name.lower().endswith(".xlsx") and len(name) > 5 else DEFAULT_NAME


@router.post("", response_model=ExportResult)
def send_export(file: UploadFile = File(...),
                form_count: int = Form(..., ge=1),
                file_name: str = Form(DEFAULT_NAME, max_length=200)):
    content = file.file.read(settings.MAX_UPLOAD_BYTES + 1)
    if len(content) > settings.MAX_UPLOAD_BYTES:
        raise ApiError(413, message="הקובץ גדול מ-25MB.")
    if not content.startswith(b"PK"):   # קובץ xlsx הוא קובץ zip
        raise ApiError(415, message="אפשר לשלוח רק קובץ אקסל (.xlsx).")

    sent_to = lab_export.send(content, _safe_name(file_name), form_count)
    return ExportResult(sent_to=sent_to, form_count=form_count)
