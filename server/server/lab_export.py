"""שליחת קובץ הייצוא למעבדה.

כרגע הקובץ נשלח במייל דרך Resend. כשיהיה API של המעבדה, משנים רק את send().
"""

import base64
import io
import json
import logging
import urllib.error
import urllib.request

from . import settings
from .errors import ApiError

try:   # תעודות האבטחה של Windows (למשל מסנן אינטרנט עם תעודה משלו), כמו בקריאה ל-Gemini
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

log = logging.getLogger("server")

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 60
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _protect(content: bytes) -> bytes:
    """מצפין את קובץ האקסל בסיסמה (ההצפנה המובנית של אקסל, AES-256). אקסל מבקש את הסיסמה בפתיחה."""
    from msoffcrypto.format.ooxml import OOXMLFile
    out = io.BytesIO()
    OOXMLFile(io.BytesIO(content)).encrypt(settings.EXPORT_FILE_PASSWORD, out)
    return out.getvalue()


def send(content: bytes, filename: str, form_count: int) -> str:
    """שולח את הקובץ, מוצפן בסיסמה, ומחזיר לאן הוא נשלח. נכשל ב-ApiError עם הודעה בעברית."""
    if not settings.RESEND_API_KEY or not settings.EXPORT_EMAIL_TO:
        raise ApiError(503, "export_not_configured",
                       "השליחה לא מוגדרת בשרת: בקובץ .env חסר RESEND_API_KEY או EXPORT_EMAIL_TO.")
    if not settings.EXPORT_FILE_PASSWORD:   # בלי סיסמה לא שולחים: הקובץ מכיל פרטים אישיים
        raise ApiError(503, "export_not_configured",
                       "השליחה לא מוגדרת בשרת: בקובץ .env חסרה EXPORT_FILE_PASSWORD (הסיסמה של קובץ האקסל).")
    try:
        content = _protect(content)
    except Exception:
        raise ApiError(400, "bad_file", "קובץ האקסל לא תקין, ולכן אי אפשר להצפין אותו.")

    body = {
        "from": settings.EXPORT_EMAIL_FROM,
        "to": [settings.EXPORT_EMAIL_TO],
        "subject": f"טפסי התחייבות: {form_count} טפסים",
        "text": f"מצורף קובץ אקסל עם {form_count} טפסי התחייבות.\n"
                "הקובץ מוגן בסיסמה. את הסיסמה מקבלים בטלפון, היא לא נשלחת במייל.",
        "attachments": [{
            "filename": filename,
            "content": base64.b64encode(content).decode("ascii"),
            "content_type": XLSX_TYPE,
        }],
    }
    request = urllib.request.Request(
        RESEND_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {settings.RESEND_API_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "sheba-forms",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS):
            pass
    except urllib.error.HTTPError as e:
        # בלוג רק הסטטוס וההודעה של Resend, בלי תוכן הקובץ
        detail = e.read(500).decode("utf-8", "replace")
        log.warning("שליחת הייצוא נכשלה: Resend החזיר %s %s", e.code, detail)
        message = ("השירות דחה את מפתח השליחה. כדאי לבדוק את RESEND_API_KEY."
                   if e.code in (401, 403) else "שליחת המייל נכשלה. כדאי לנסות שוב בעוד רגע.")
        raise ApiError(502, "export_failed", message)
    except (urllib.error.URLError, TimeoutError) as e:
        log.warning("שליחת הייצוא נכשלה: אין חיבור לשירות המייל (%s)", e)
        raise ApiError(502, "export_failed", "אין חיבור לשירות המייל. כדאי לנסות שוב בעוד רגע.")

    log.info("ייצוא נשלח במייל: %d טפסים", form_count)
    return settings.EXPORT_EMAIL_TO
