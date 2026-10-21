"""המרת התשובה של Gemini לשורות ולשדות, במבנה של החוזה (Field).

עמוד → מטופל אחד או יותר (records) → שורה לכל מספר התחייבות (forms).
פרטי המטופל נשמרים פעם אחת (שדות עם record_id), ומספר ההתחייבות שייך לשורה (שדה עם form_id).

כללים:
- שדה שלא נמצא: צהוב, reason_code = missing.
- ביטחון high / good: לא צהוב. medium / low: צהוב, reason_code = low_confidence. ההערה של Gemini (באנגלית) בסוגריים.
- כמה מספרים מרכזיים: ערך אחד, מופרד בפסיק.
- תאריך בשדה: DD.MM.YYYY, כמו שהלקוח מציג. form_date בשורה מחושב ממנו בפורמט ISO (forms.py).
- שם: הערך מהקריאה המוגדלת. אם היא שונה מקריאת העמוד המלא: צהוב, עם שתי הקריאות בהסבר.
- confidence נשאר null: Gemini מחזיר high/good/medium/low ולא מספר, ולא ממציאים דיוק שאין.
- מיקום (box): שם פרטי ושם משפחה מקבלים את name_box. שאר השדות - את ה-box של השדה עצמו;
  כמה מספרים מרכזיים - מלבן אחד שמכסה את כולם. הלקוח מציג ממנו חיתוך מוגדל לשדות לבדיקה.
"""

import json
import secrets
from datetime import datetime

from ..times import iso, utcnow

COMMITMENT_FIELD = ("commitment_number", "מספר התחייבות", "number")
SHARED_FIELDS = [   # (key, label, type), לפי סדר התצוגה אחרי מספר ההתחייבות
    ("last_name", "שם משפחה", "text"),
    ("first_name", "שם פרטי", "text"),
    ("id_number", "תעודת זהות", "id_number"),
    ("central_numbers", "מספר מרכזי", "text"),
    ("received_date", "תאריך קבלה", "date"),
    ("sender", "שולח", "text"),
]
NAME_KEYS = ("first_name", "last_name")
SURE_LEVELS = ("high", "good")   # רמות ביטחון שלא צריכות בדיקה


def _note(text: str, issue) -> str:
    return f"{text} ({issue})" if issue else text


def _missing(issue=None) -> dict:
    return dict(value="", uncertain=True, reason_code="missing", reason=_note("לא נמצא בטופס", issue))


def _found(item) -> bool:
    return isinstance(item, dict) and bool(item.get("found")) and bool(str(item.get("value") or "").strip())


def _single(item) -> dict:
    """שדה אחד כפי ש-Gemini החזיר: {value, raw_text, found, confidence, issue}."""
    if not _found(item):
        return _missing(item.get("issue") if isinstance(item, dict) else None)
    value = str(item["value"]).strip()
    if item.get("confidence") in SURE_LEVELS:
        return dict(value=value, uncertain=False, reason_code=None, reason=None)
    return dict(value=value, uncertain=True, reason_code="low_confidence",
                reason=_note("המודל לא בטוח בקריאה", item.get("issue")))


def _many(items) -> dict:
    """כמה ערכים (למשל כמה מספרים מרכזיים) במשבצת אחת."""
    items = items if isinstance(items, list) else []
    found = [i for i in items if _found(i)]
    issues = "; ".join(i["issue"] for i in items if isinstance(i, dict) and i.get("issue"))
    if not found:
        return _missing(issues or None)
    value = ", ".join(str(i["value"]).strip() for i in found)
    if all(i.get("confidence") in SURE_LEVELS for i in found):
        return dict(value=value, uncertain=False, reason_code=None, reason=None)
    return dict(value=value, uncertain=True, reason_code="low_confidence",
                reason=_note("המודל לא בטוח בקריאה", issues or None))


def _date(item) -> dict:
    field = _single(item)
    if field["value"]:
        try:
            field["value"] = datetime.strptime(field["value"], "%d/%m/%Y").strftime("%d.%m.%Y")
        except ValueError:
            field.update(uncertain=True, reason_code="illegible",
                         reason=_note("התאריך לא ברור", item.get("issue") or None))
    return field


def _name(record: dict, key: str) -> dict:
    page = _single(record.get(key))
    zoom_result = record.get("name_zoom")
    if not isinstance(zoom_result, dict) or "error" in zoom_result or "skipped" in zoom_result:
        return page   # ההגדלה לא רצה או נכשלה: נשארים עם קריאת העמוד המלא
    zoom = _single(zoom_result.get(key))
    if zoom["reason_code"] == "missing":
        return page
    if page["reason_code"] != "missing" and page["value"] != zoom["value"]:
        return dict(value=zoom["value"], uncertain=True, reason_code="models_disagree",
                    reason=f'בקריאת העמוד המלא נקרא "{page["value"]}", ובקריאה המוגדלת "{zoom["value"]}"')
    return zoom


def _coords(raw):
    """[ymin, xmin, ymax, xmax] של Gemini בסקאלה 0-1000, או None אם לא תקין."""
    if not isinstance(raw, list) or len(raw) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = (float(v) for v in raw)
    except (TypeError, ValueError):
        return None
    if not (0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000):
        return None
    return ymin, xmin, ymax, xmax


def _box(raw) -> str | None:
    """מיקום של Gemini ← Box של החוזה (JSON)."""
    coords = _coords(raw)
    if coords is None:
        return None
    ymin, xmin, ymax, xmax = coords
    return json.dumps({"page": 1, "x": xmin / 1000, "y": ymin / 1000,
                       "w": (xmax - xmin) / 1000, "h": (ymax - ymin) / 1000})


def _field_box(item) -> str | None:
    """המיקום של שדה אחד, או מלבן שמכסה כמה ערכים (רשימה) - רק של ערכים שנמצאו."""
    items = item if isinstance(item, list) else [item]
    boxes = [c for i in items if _found(i) and (c := _coords(i.get("box")))]
    if not boxes:
        return None
    return _box([min(b[0] for b in boxes), min(b[1] for b in boxes),
                 max(b[2] for b in boxes), max(b[3] for b in boxes)])


def _shared_field(record: dict, key: str) -> dict:
    if key in NAME_KEYS:
        return _name(record, key)
    if key == "central_numbers":
        return _many(record.get(key))
    if key == "received_date":
        return _date(record.get(key))
    return _single(record.get(key))


def _insert_field(conn, owner_column: str, owner_id: str, position: int, spec: tuple, field: dict, box=None):
    key, label, field_type = spec
    conn.execute(
        f"INSERT INTO fields ({owner_column}, key, position, label, type, value, confidence, uncertain, "
        f"reason_code, reason, readings, box) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)",
        (owner_id, key, position, label, field_type, field["value"], int(field["uncertain"]),
         field["reason_code"], field["reason"], box))


def _clear_page(conn, upload_id: str, page_number: int):
    """עמוד שנקרא שוב: מוחקים מה שנבנה בקריאה קודמת, ומשאירים רק את השורה הראשונה."""
    forms = [r["id"] for r in conn.execute(
        "SELECT id FROM forms WHERE upload_id = ? AND page_number = ? ORDER BY position", (upload_id, page_number))]
    records = [r["id"] for r in conn.execute(
        "SELECT id FROM records WHERE upload_id = ? AND page_number = ?", (upload_id, page_number))]
    conn.executemany("DELETE FROM fields WHERE form_id = ?", [(f,) for f in forms])
    conn.executemany("DELETE FROM fields WHERE record_id = ?", [(r,) for r in records])
    conn.execute("UPDATE forms SET record_id = NULL WHERE id = ?", (forms[0],))
    conn.executemany("DELETE FROM forms WHERE id = ?", [(f,) for f in forms[1:]])
    conn.executemany("DELETE FROM records WHERE id = ?", [(r,) for r in records])
    return forms[0]


def apply(conn, upload_id: str, page_number: int, result: dict) -> list[str]:
    """שומר את התוצאה של עמוד אחד. מחזיר את מזהי השורות שנוצרו, לפי הסדר."""
    now = iso(utcnow())
    first_form = _clear_page(conn, upload_id, page_number)
    records = [r for r in (result.get("records") or []) if isinstance(r, dict)] or [{}]   # עמוד בלי מטופל: שורה ריקה
    form_ids = []
    for record_position, record in enumerate(records, start=1):
        record_id = "r_" + secrets.token_hex(6)
        conn.execute("INSERT INTO records (id, upload_id, page_number, position) VALUES (?, ?, ?, ?)",
                     (record_id, upload_id, page_number, record_position))
        name_box = _box(record.get("name_box"))
        for position, spec in enumerate(SHARED_FIELDS, start=2):
            box = name_box if spec[0] in NAME_KEYS else _field_box(record.get(spec[0]))
            _insert_field(conn, "record_id", record_id, position, spec, _shared_field(record, spec[0]), box)

        commitments = [c for c in (record.get("commitment_numbers") or []) if _found(c)] or [None]
        for commitment in commitments:
            form_id = first_form if not form_ids else "f_" + secrets.token_hex(6)
            if not form_ids:
                conn.execute("UPDATE forms SET record_id = ?, position = 1, status = 'pending_review', "
                             "progress = NULL, error = NULL, updated_at = ? WHERE id = ?", (record_id, now, form_id))
            else:
                conn.execute("INSERT INTO forms (id, upload_id, page_number, record_id, position, status, updated_at) "
                             "VALUES (?, ?, ?, ?, ?, 'pending_review', ?)",
                             (form_id, upload_id, page_number, record_id, len(form_ids) + 1, now))
            field = _single(commitment) if commitment else _many(record.get("commitment_numbers"))   # לא נמצא
            _insert_field(conn, "form_id", form_id, 1, COMMITMENT_FIELD, field, _field_box(commitment))
            form_ids.append(form_id)
    return form_ids
