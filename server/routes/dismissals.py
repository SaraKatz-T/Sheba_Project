"""החלטות על כפילויות: GET ו-POST /api/duplicate-dismissals.

הלקוח מזהה כפילויות בעצמו. כשמשתמש מחליט "להשאיר את כולם", ההחלטה נשמרת כאן לכולם.
קבוצה נשמרת ממוינת ובלי כפולים, כך שאותה קבוצה בכל סדר היא אותה החלטה.
"""

import json

from fastapi import APIRouter, Depends

from .. import db, live
from ..auth import require_session
from ..errors import ApiError
from ..models import DismissalList, DismissalRequest, DuplicateDismissal
from ..times import iso, utcnow

router = APIRouter(prefix="/api/duplicate-dismissals", tags=["duplicates"], dependencies=[Depends(require_session)])


def _dismissal(row) -> DuplicateDismissal:
    return DuplicateDismissal(form_ids=json.loads(row["form_ids"]), dismissed_at=row["dismissed_at"])


@router.get("", response_model=DismissalList)
def list_dismissals():
    with db.connect() as conn:
        rows = conn.execute("SELECT form_ids, dismissed_at FROM duplicate_dismissals ORDER BY id").fetchall()
    return DismissalList(items=[_dismissal(r) for r in rows])


@router.post("", status_code=201, response_model=DuplicateDismissal)
def create_dismissal(body: DismissalRequest):
    form_ids = sorted(set(body.form_ids))
    if len(form_ids) < 2:
        raise ApiError(400, message="צריך לפחות שני טפסים.")
    key = json.dumps(form_ids)
    with db.connect() as conn:
        placeholders = ",".join("?" * len(form_ids))
        found = conn.execute(f"SELECT COUNT(*) FROM forms WHERE id IN ({placeholders})", form_ids).fetchone()[0]
        if found != len(form_ids):
            raise ApiError(400, message="אחד הטפסים לא קיים.")
        existing = conn.execute("SELECT form_ids, dismissed_at FROM duplicate_dismissals WHERE form_ids = ?",
                                (key,)).fetchone()
        if existing:   # אותה קבוצה כבר נשמרה: מחזירים אותה, בלי הודעה חיה נוספת
            return _dismissal(existing)
        now = iso(utcnow())
        conn.execute("INSERT INTO duplicate_dismissals (form_ids, dismissed_at) VALUES (?, ?)", (key, now))
    dismissal = DuplicateDismissal(form_ids=form_ids, dismissed_at=now)
    live.publish({"type": "duplicate_dismissal.created", "dismissal": dismissal.model_dump()})
    return dismissal
