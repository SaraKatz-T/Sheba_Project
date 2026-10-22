"""הגדרות השרת. ערכים רגישים (הסיסמה) נטענים מקובץ .env ולא נכתבים בקוד."""

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")


def _flag(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes")


# --- כניסה ---
APP_PASSWORD = os.getenv("APP_PASSWORD", "")
SESSION_HOURS = 8
COOKIE_NAME = "session"
COOKIE_SECURE = _flag("COOKIE_SECURE", True)   # בפיתוח על http צריך COOKIE_SECURE=false ב-.env
LOGIN_MAX_FAILURES = 5           # ניסיונות שגויים מאותה כתובת...
LOGIN_WINDOW_SECONDS = 15 * 60   # ...בתוך חלון הזמן הזה, ואז 429

# --- עדכונים חיים (WebSocket /api/live) ---
# כתובות הלקוח שמותר להן להתחבר (בדיקת Origin). בפיתוח הלקוח רץ ב-Vite על 5173;
# אחרי האיחוד השרת מגיש את הלקוח בעצמו על 8000. אפשר לשנות ב-.env, מופרד בפסיקים
ALLOWED_ORIGINS = {o.strip() for o in os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000,http://127.0.0.1:8000").split(",") if o.strip()}
LIVE_SESSION_CHECK_SECONDS = 60   # כל כמה זמן בודקים שהכניסה של חיבור פתוח עדיין בתוקף

# --- הגשת הלקוח (אחרי האיחוד) ---
# תיקיית dist/ של הלקוח (אחרי npm run build). כשמוגדרת, השרת מגיש גם את הלקוח מאותה כתובת.
# ריקה = בזמן פיתוח, כשהלקוח רץ ב-Vite
CLIENT_DIST = Path(os.getenv("CLIENT_DIST")) if os.getenv("CLIENT_DIST") else None

# --- הפעלה ---
SERVER_HOST = os.getenv("SERVER_HOST", "127.0.0.1")   # 0.0.0.0 כדי שהלקוח ממחשב אחר יגיע
SERVER_PORT = int(os.getenv("SERVER_PORT", "8000"))

# --- קליטת קבצים ---
MAX_UPLOAD_BYTES = 25 * 1024 * 1024

# --- שליחת הייצוא למעבדה ---
# עד שיהיה API של המעבדה, קובץ האקסל נשלח במייל דרך Resend (resend.com).
# בלי דומיין מאומת, Resend שולח רק לכתובת שאיתה נרשמו אליו
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
EXPORT_EMAIL_TO = os.getenv("EXPORT_EMAIL_TO", "")
EXPORT_EMAIL_FROM = os.getenv("EXPORT_EMAIL_FROM", "Sheba Forms <onboarding@resend.dev>")
# קובץ האקסל שנשלח מוצפן בסיסמה הזו (ההצפנה המובנית של אקסל). את הסיסמה מוסרים למעבדה בטלפון, לא במייל
EXPORT_FILE_PASSWORD = os.getenv("EXPORT_FILE_PASSWORD", "")

# --- הצפנת הנתונים בדיסק (crypto.py) ---
# מפתח־העל: base64 של 32 בתים. נוצר ב-run_encrypt_setup.py. בלעדיו אי אפשר לקרוא שום נתון,
# ולכן צריך לשמור עותק שלו במקום בטוח (מנהל סיסמאות), נפרד מהגיבויים של הנתונים.
# בענן: לשמור אותו בכספת המפתחות של הענן, לא בקובץ
DATA_KEY = os.getenv("DATA_KEY", "")
DATA_KEY_PREVIOUS = os.getenv("DATA_KEY_PREVIOUS", "")   # רק בזמן החלפת מפתח־העל

# --- תור ועובדים ---
WORKERS_ENABLED = _flag("WORKERS_ENABLED", True)   # false = השרת רק קולט, בלי לעבד (לבדיקות)
READ_WORKERS = int(os.getenv("READ_WORKERS", "4"))   # עמודים שנקראים במקביל. 4 = אחד לכל מפתח Gemini
SPLIT_THREADS = int(os.getenv("SPLIT_THREADS", "4"))   # עמודים שמיושרים ומוקטנים במקביל בזמן הפיצול
MAX_PAGE_ATTEMPTS = 3                  # אחרי כמה ניסיונות כושלים עמוד עובר ל-failed
RETRY_DELAYS_SECONDS = (30, 120)       # המתנה לפני הניסיון השני והשלישי
QUOTA_PAUSE_MINUTES = 30               # כשהמכסה של Gemini נגמרת, כל התור נעצר לזמן הזה
DEFAULT_SECONDS_PER_PAGE = 60          # הנחה לזמן משוער עד שיש נתונים אמיתיים (בפועל נמדדו 35-150 שניות לעמוד)
ETA_SAMPLE_PAGES = 20                  # הזמן הממוצע לעמוד מחושב על העמודים האחרונים האלה

# --- מחיקת תמונות ---
IMAGE_KEEP_HOURS = 24            # תמונת עמוד נמחקת כך וכך שעות אחרי שהשורה האחרונה בעמוד אושרה
THUMBNAIL_KEEP_HOURS = 24        # התמונה המוקטנת נמחקת כך וכך שעות אחרי הקליטה (תור הקליטה מציג 24 שעות)
CLEANUP_INTERVAL_SECONDS = 600   # כל כמה זמן בודקים אם יש תמונות למחיקה
TRASH_KEEP_DAYS = 30            # רשומה בסל המחזור נמחקת לתמיד אחרי כך וכך ימים

# --- צילום מהטלפון ---
CAPTURE_SESSION_MINUTES = 10    # תוקף הקוד שבברקוד
CAPTURE_MAX_UPLOADS = 100       # צילומים לכל קוד, ואז 429

# --- אחסון (מכיל פרטים אישיים, לא עולה ל-Git) ---
STORAGE_DIR = Path(os.getenv("STORAGE_DIR") or PROJECT_ROOT / "storage")   # הקבצים: storage/uploads/{id}/
DB_PATH = STORAGE_DIR / "app.db"
