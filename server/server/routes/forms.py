"""טפסים (שורות): קריאה, תמונת עמוד, תיקון שדה, אישור, דחייה, ניסיון חוזר ומיזוג."""

from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse

from .. import db, events, review, settings
from ..auth import require_session
from ..errors import ApiError
from ..forms import field_from_row, list_forms, load_form, load_form_detail
from ..models import Field, FieldUpdate, FormDetail, FormList, FormSummary, MergeRequest, RejectRequest

router = APIRouter(prefix="/api/forms", tags=["forms"], dependencies=[Depends(require_session)])


def _publish(form_ids):
    for form_id in form_ids:
        events.form_changed(form_id)


@router.get("", response_model=FormList)
def get_forms():
    with db.connect() as conn:
        return FormList(items=list_forms(conn))


@router.get("/{form_id}", response_model=FormDetail)
def get_form(form_id: str):
    with db.connect() as conn:
        form = load_form_detail(conn, form_id)
    if form is None:
        raise ApiError(404)
    return form


@router.get("/{form_id}/pages/{number}/image", response_class=FileResponse)
def get_page_image(form_id: str, number: int):
    with db.connect() as conn:
        row = conn.execute("SELECT p.image_path FROM forms f JOIN pages p "
                           "ON p.upload_id = f.upload_id AND p.number = f.page_number WHERE f.id = ?",
                           (form_id,)).fetchone()
    if row is None or number != 1:   # הטופס הוא תמיד עמוד אחד
        raise ApiError(404)
    if not row["image_path"]:
        raise ApiError(404, "image_deleted", "התמונה נמחקה 24 שעות אחרי האישור.")
    return FileResponse(settings.STORAGE_DIR / row["image_path"], media_type="image/png")


@router.patch("/{form_id}/fields/{key}", response_model=Field)
def patch_field(form_id: str, key: str, body: FieldUpdate):
    with db.connect() as conn:
        field, changed = review.update_field(conn, form_id, key, body.value, body.source)
    _publish(changed)   # שדה משותף: כל השורות של אותו מטופל
    return field_from_row(field)


def _act(form_id: str, action) -> FormSummary:
    with db.connect() as conn:
        changed = action(conn)
    _publish(changed)
    with db.connect() as conn:
        return load_form(conn, form_id)


@router.post("/{form_id}/approve", response_model=FormSummary)
def approve(form_id: str):
    return _act(form_id, lambda conn: review.approve(conn, form_id))


@router.post("/{form_id}/reject", response_model=FormSummary)
def reject(form_id: str, body: RejectRequest | None = None):
    return _act(form_id, lambda conn: review.reject(conn, form_id, body.reason if body else None))


@router.post("/{form_id}/retry", response_model=FormSummary)
def retry(form_id: str):
    summary = _act(form_id, lambda conn: review.retry_form(conn, form_id))
    events.upload_changed(summary.upload_id)   # הקובץ חזר ל-processing
    return summary


@router.post("/{form_id}/merge", response_model=FormSummary)
def merge(form_id: str, body: MergeRequest):
    _act(form_id, lambda conn: review.merge(conn, form_id, body.into, body.values))
    with db.connect() as conn:
        return load_form(conn, body.into)   # החוזה: מחזירים את טופס היעד
