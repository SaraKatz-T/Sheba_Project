"""מבני הבקשות והתשובות, בשמות השדות של החוזה (api-contract.md גרסה 2.3 / src/api/types.ts)."""

from typing import Literal

from pydantic import BaseModel
from pydantic import Field as PydanticField

FormSource = Literal["upload", "phone", "demo"]
UploadStatus = Literal["queued", "splitting", "processing", "done", "failed"]
FormStatus = Literal["received", "processing", "pending_review", "approved", "failed", "rejected"]
FieldType = Literal["text", "id_number", "date", "phone", "number", "checkbox", "signature"]
ReasonCode = Literal["models_disagree", "checksum_failed", "illegible", "missing", "low_confidence", "other"]


class LoginRequest(BaseModel):
    password: str = PydanticField(max_length=1024)


class Session(BaseModel):
    authenticated: bool


class Upload(BaseModel):
    id: str
    file_name: str
    file_type: str
    file_size: int
    file_sha256: str
    source: FormSource
    status: UploadStatus
    received_at: str
    updated_at: str
    page_count: int | None
    form_count: int | None
    form_ids: list[str]
    queue_position: int | None   # רק ב-queued: 1 = הבא בתור
    eta_at: str | None
    thumbnail_url: str | None    # התמונה המוקטנת של העמוד הראשון. null אם לא נוצרה
    error: str | None


class UploadList(BaseModel):
    items: list[Upload]


class Progress(BaseModel):
    percent: int
    step: str


class FormSummary(BaseModel):
    id: str
    upload_id: str
    upload_pages: list[int]
    file_name: str
    source: FormSource
    status: FormStatus
    received_at: str
    updated_at: str
    reviewed_at: str | None
    commitment_number: str | None
    person_name: str | None
    id_number: str | None
    form_date: str | None
    page_count: int
    uncertain_count: int
    uncertain_keys: list[str]
    corrected_count: int
    progress: Progress | None
    error: str | None
    merged_into: str | None


class FormList(BaseModel):
    items: list[FormSummary]


class Box(BaseModel):
    """חלק יחסי (0-1) מגודל העמוד; x/y הם הפינה העליונה השמאלית. page מתחיל ב-1."""
    page: int
    x: float
    y: float
    w: float
    h: float


class Field(BaseModel):
    key: str
    label: str
    type: FieldType
    value: str
    confidence: float | None
    uncertain: bool
    reason_code: ReasonCode | None
    reason: str | None
    readings: dict[str, str | None] | None
    box: Box | None
    corrected: bool
    original_value: str | None


class Page(BaseModel):
    number: int
    width: int
    height: int
    image_url: str


class FormDetail(FormSummary):
    pages: list[Page]
    fields: list[Field]


class FieldUpdate(BaseModel):
    value: str = PydanticField(max_length=1000)
    source: Literal["manual", "gemini", "qwen", "confirmed"]


class RejectRequest(BaseModel):
    reason: str | None = PydanticField(default=None, max_length=1000)


class MergeRequest(BaseModel):
    into: str
    values: dict[str, str] = {}


class DuplicateDismissal(BaseModel):
    """"הטפסים האלה תקינים כמו שהם": קבוצת כפילויות שהמשתמש בחר להשאיר."""
    form_ids: list[str]
    dismissed_at: str


class DismissalList(BaseModel):
    items: list[DuplicateDismissal]


class DismissalRequest(BaseModel):
    form_ids: list[str] = PydanticField(max_length=1000)


class CaptureSession(BaseModel):
    token: str
    expires_at: str


class CaptureStatus(BaseModel):
    expires_at: str


class CaptureUploadResult(BaseModel):
    """בכוונה בלי נתונים אישיים: הטלפון לא נכנס בסיסמה."""
    id: str
    status: UploadStatus
