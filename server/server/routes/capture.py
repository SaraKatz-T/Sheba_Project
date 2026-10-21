"""צילום מהטלפון: POST /api/capture-sessions, GET /api/capture/{token}, POST /api/capture/{token}/uploads."""

from fastapi import APIRouter, Depends, File, Form, UploadFile

from .. import capture
from ..auth import require_session
from ..models import CaptureSession, CaptureStatus, CaptureUploadResult
from ..uploads import receive

router = APIRouter(prefix="/api", tags=["capture"])


@router.post("/capture-sessions", status_code=201, response_model=CaptureSession,
             dependencies=[Depends(require_session)])
def create_capture_session():
    return capture.create_session()


@router.get("/capture/{token}", response_model=CaptureStatus)
def capture_status(token: str):
    return CaptureStatus(expires_at=capture.check(token))


@router.post("/capture/{token}/uploads", status_code=202, response_model=CaptureUploadResult)
def capture_upload(token: str, file: UploadFile = File(...), sha256: str = Form(...)):
    # בלי עוגייה: הקוד הוא ההרשאה
    capture.reserve_slot(token)
    try:
        # force=True: בטלפון אין בדיקת כפילות. החוזה לא כולל כאן 409, ותשובת הכפילות
        # הייתה חושפת שם של קובץ אחר למי שלא נכנס בסיסמה
        upload = receive(file, sha256, "phone", force=True)
    except Exception:
        capture.release_slot(token)
        raise
    return CaptureUploadResult(id=upload.id, status=upload.status)
