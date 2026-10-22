"""טפסים (שורות): בניית FormSummary ו-FormDetail מהטבלאות.

פרטי המטופל (שם, ת"ז, תאריך) נלקחים מהשדות של המטופל (records), ומספר ההתחייבות מהשדה של השורה עצמה.
שם הקובץ, המקור ותאריך הקליטה נלקחים מהקובץ (uploads).
"""

import json
import re
from datetime import date

from .models import Field, FormDetail, FormSummary, Page, Progress

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
ISRAELI_DATE = re.compile(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$")   # 19.10.2026, גם 19/10/2026


def _iso_date(value: str | None) -> str | None:
    """תאריך השדה (כפי שהלקוח מציג, DD.MM.YYYY, או כפי שהלבורנטית הקלידה) ← form_date בפורמט ISO."""
    if not value:
        return None
    if ISO_DATE.match(value):
        return value
    m = ISRAELI_DATE.match(value.strip())
    if not m:
        return None
    day, month, year = (int(g) for g in m.groups())
    try:
        return date(year, month, day).isoformat()
    except ValueError:   # למשל 31.02.2026
        return None

FORM_SQL = ("SELECT f.*, u.file_name, u.source, u.received_at FROM forms f "
            "JOIN uploads u ON u.id = f.upload_id")


def _fields_by_form(conn, form_id: str | None = None) -> dict[str, list]:
    """השדות של כל שורה: השדות של המטופל שלה, ועוד השדה של השורה עצמה. מסודרים לפי position."""
    where, args = ("WHERE f.id = ?", (form_id,)) if form_id else ("", ())
    rows = conn.execute(
        f"SELECT f.id AS fid, fl.* FROM forms f JOIN fields fl ON fl.form_id = f.id {where} "
        f"UNION ALL "
        f"SELECT f.id AS fid, fl.* FROM forms f JOIN fields fl ON fl.record_id = f.record_id {where} "
        f"ORDER BY position", args * 2).fetchall()
    result = {}
    for row in rows:
        result.setdefault(row["fid"], []).append(row)
    return result


def _summary(row, fields) -> FormSummary:
    by_key = {f["key"]: f for f in fields}

    def value(key):
        field = by_key.get(key)
        return field["value"] if field is not None and field["value"] else None

    names = [n for n in (value("first_name"), value("last_name")) if n]
    return FormSummary(
        id=row["id"], upload_id=row["upload_id"], upload_pages=[row["page_number"]],
        file_name=row["file_name"], source=row["source"], status=row["status"],
        received_at=row["received_at"], updated_at=row["updated_at"], reviewed_at=row["reviewed_at"],
        commitment_number=value("commitment_number"),
        person_name=" ".join(names) or None,
        first_name=value("first_name"), last_name=value("last_name"),
        id_number=value("id_number"),
        central_number=value("central_numbers"), sender=value("sender"),
        form_date=_iso_date(value("received_date")),
        page_count=1,   # טופס הוא תמיד עמוד אחד
        uncertain_count=sum(1 for f in fields if f["uncertain"]),
        uncertain_keys=[f["key"] for f in fields if f["uncertain"]],   # לסימון התאים הצהובים בטבלה
        corrected_count=sum(1 for f in fields if f["corrected"]),
        progress=Progress(**json.loads(row["progress"])) if row["progress"] else None,
        error=row["error"], merged_into=row["merged_into"], deleted_at=row["deleted_at"],
    )


def field_from_row(row) -> Field:
    return Field(
        key=row["key"], label=row["label"], type=row["type"], value=row["value"],
        confidence=row["confidence"], uncertain=bool(row["uncertain"]),
        reason_code=row["reason_code"], reason=row["reason"],
        readings=json.loads(row["readings"]) if row["readings"] else None,
        box=json.loads(row["box"]) if row["box"] else None,
        corrected=bool(row["corrected"]), original_value=row["original_value"],
    )


def list_forms(conn) -> list[FormSummary]:
    """כל השורות שלא נמחקו, מהחדש לישן. בתוך קובץ: לפי סדר העמודים."""
    fields = _fields_by_form(conn)
    rows = conn.execute(f"{FORM_SQL} WHERE f.deleted_at IS NULL "
                        "ORDER BY u.received_at DESC, u.queued_at DESC, f.page_number, f.position")
    return [_summary(row, fields.get(row["id"], [])) for row in rows]


def list_trash(conn) -> list[FormSummary]:
    """סל המחזור: מה שנמחק לאחרונה ראשון."""
    fields = _fields_by_form(conn)
    rows = conn.execute(f"{FORM_SQL} WHERE f.deleted_at IS NOT NULL "
                        "ORDER BY f.deleted_at DESC, f.page_number, f.position")
    return [_summary(row, fields.get(row["id"], [])) for row in rows]


def load_form(conn, form_id: str) -> FormSummary | None:
    row = conn.execute(f"{FORM_SQL} WHERE f.id = ?", (form_id,)).fetchone()
    if row is None:
        return None
    return _summary(row, _fields_by_form(conn, form_id).get(form_id, []))


def load_form_detail(conn, form_id: str) -> FormDetail | None:
    row = conn.execute(f"{FORM_SQL} WHERE f.id = ?", (form_id,)).fetchone()
    if row is None:
        return None
    fields = _fields_by_form(conn, form_id).get(form_id, [])
    page = conn.execute("SELECT width, height, image_path FROM pages WHERE upload_id = ? AND number = ?",
                        (row["upload_id"], row["page_number"])).fetchone()
    # העמודים ממוספרים בתוך הטופס, והטופס הוא עמוד אחד. תמונה שנמחקה (24 שעות אחרי אישור) לא מוצגת
    pages = [Page(number=1, width=page["width"], height=page["height"],
                  image_url=f"/api/forms/{form_id}/pages/1/image")] if page and page["image_path"] else []
    return FormDetail(**_summary(row, fields).model_dump(), pages=pages, fields=[field_from_row(f) for f in fields])
