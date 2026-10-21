"""התור והעובדים. מצב התור עצמו נשמר במסד הנתונים; כאן רק האותות בין העובדים.

    עובד פיצול (1)  ← splitter.py: קובץ ← עמודים
    עובדי קריאה (N) ← reader.py:   עמוד ← Gemini ← שורות ושדות (mapping.py)
    הפעלה ועצירה    ← runner.py
"""

import threading
from datetime import datetime

from ..times import utcnow

# pypdfium2 לא מאפשר עבודה במקביל, גם לא על מסמכים שונים. כל קריאה אליו (פיצול, תמונה מוקטנת)
# עוברת דרך המנעול הזה, לכל ציור עמוד בנפרד, כך שההמתנה היא לשבריר שנייה ולא לכל הפיצול
PDFIUM_LOCK = threading.Lock()

_work = threading.Event()
_pause_lock = threading.Lock()
paused_until: datetime | None = None   # כשהמכסה של Gemini נגמרה, אף עמוד לא נשלח עד הזמן הזה


def wake():
    """יש עבודה חדשה בתור: מעיר את העובדים מיד, בלי לחכות לבדיקה הבאה."""
    _work.set()


def wait_for_work(timeout: float):
    _work.wait(timeout)
    _work.clear()


def pause(until: datetime):
    global paused_until
    with _pause_lock:
        paused_until = until


def is_paused() -> bool:
    return paused_until is not None and utcnow() < paused_until


def resume_if_due() -> bool:
    """אם זמן העצירה עבר: מבטל אותה. מחזיר True פעם אחת בלבד, לעובד שביטל."""
    global paused_until
    with _pause_lock:
        if paused_until is not None and utcnow() >= paused_until:
            paused_until = None
            return True
    return False
