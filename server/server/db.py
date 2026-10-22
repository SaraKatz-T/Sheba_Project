"""מסד הנתונים (SQLite). מקור האמת למצב של כל קובץ וכל טופס.

    קובץ אחד  →  עמודים  →  מטופלים  →  שורות במסך
    uploads       pages      records       forms
                                └── fields: הערכים של כל אחד ──┘

טופס הוא תמיד עמוד אחד. בעמוד יכולים להיות כמה מספרי התחייבות, וכל אחד הוא שורה נפרדת (forms).
פרטי המטופל נשמרים פעם אחת (records), כך שתיקון שלהם מופיע מיד בכל השורות של אותו עמוד.

עמודות שמסומנות "פנימי" לא נשלחות ללקוח. ערכים שאפשר לחשב (form_ids, form_count, queue_position,
eta_at, שם הקובץ בטופס, person_name, uncertain_count וכו') לא נשמרים פעמיים: הם מחושבים בכל שליפה,
כך שהם תמיד נכונים.

בזמן פיתוח, אם המבנה כאן משתנה: מוחקים את storage/app.db והוא נוצר מחדש.
"""

import sqlite3
from contextlib import contextmanager

from . import crypto, settings

SCHEMA = """
-- כניסה למערכת
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,   -- רק הגיבוב של ה-token נשמר, לא ה-token עצמו
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

-- הקובץ: מה הועלה?
CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    file_sha256 TEXT NOT NULL,
    source TEXT NOT NULL,          -- upload (מחשב) / phone (טלפון) / demo
    status TEXT NOT NULL,          -- queued / splitting / processing / done / failed
    received_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    page_count INTEGER,            -- NULL עד שהקובץ פוצל לעמודים
    error TEXT,
    stored_path TEXT,              -- פנימי: מיקום הקובץ, יחסי ל-storage. NULL אחרי שנמחק (מיד אחרי הפיצול)
    queued_at TEXT NOT NULL,       -- פנימי: סדר התור (מתעדכן ב-retry)
    thumbnail_path TEXT,           -- פנימי: התמונה המוקטנת (thumbnail_url). NULL אם לא נוצרה או נמחקה
    paused INTEGER NOT NULL DEFAULT 0,   -- 1 = המשתמש עצר את העיבוד ("עצור"); עמודים לא נשלחים עד "המשך"
    removed_at TEXT                -- פנימי: הוסר מתור הקליטה, והטפסים שכבר נקראו נשמרו. NULL = לא הוסר
);
CREATE INDEX IF NOT EXISTS uploads_sha256 ON uploads(file_sha256);
CREATE INDEX IF NOT EXISTS uploads_queue ON uploads(status, queued_at);

-- העמוד: מה נשלח ל-Gemini?
CREATE TABLE IF NOT EXISTS pages (
    upload_id TEXT NOT NULL REFERENCES uploads(id),
    number INTEGER NOT NULL,       -- מספר העמוד בקובץ, מתחיל ב-1
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    image_path TEXT,               -- התמונה המוכנה, יחסי ל-storage. NULL אחרי שנמחקה
                                   -- (24 שעות אחרי אישור השורה האחרונה בעמוד; הפרטים עצמם נשארים)
    raw_result TEXT,               -- פנימי: התשובה של Gemini כפי שהיא (JSON)
    attempts INTEGER NOT NULL DEFAULT 0,   -- פנימי: כמה פעמים ניסינו לקרוא את העמוד
    retry_at TEXT,                 -- פנימי: אחרי כישלון, מתי מותר לנסות שוב
    started_at TEXT,               -- פנימי: תחילת הקריאה וסופה,
    finished_at TEXT,              --        לחישוב זמן ממוצע לעמוד (eta_at)
    claim_id TEXT,                 -- פנימי: מזהה הקריאה הנוכחית. "עצור" מאפס אותו, ותשובה שמגיעה אחר כך נזרקת
    PRIMARY KEY (upload_id, number)
);

-- המטופל: על מי מדובר? (פרטיו נשמרים ב-fields)
CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    upload_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    position INTEGER NOT NULL,     -- הסדר בעמוד (בדרך כלל מטופל אחד)
    FOREIGN KEY (upload_id, page_number) REFERENCES pages(upload_id, number)
);
CREATE INDEX IF NOT EXISTS records_page ON records(upload_id, page_number);

-- השורה: מה הלבורנטית בודקת ומאשרת? (שורה לכל מספר התחייבות)
CREATE TABLE IF NOT EXISTS forms (
    id TEXT PRIMARY KEY,
    upload_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,  -- ללקוח נשלח upload_pages: [page_number]
    record_id TEXT REFERENCES records(id),   -- NULL עד ש-Gemini קרא את העמוד
    position INTEGER NOT NULL,     -- הסדר בתוך העמוד
    status TEXT NOT NULL,          -- received / processing / pending_review / approved / failed / rejected
    updated_at TEXT NOT NULL,
    reviewed_at TEXT,
    progress TEXT,                 -- JSON {percent, step} או NULL
    error TEXT,
    merged_into TEXT REFERENCES forms(id),
    reject_reason TEXT,            -- פנימי: הסיבה שנשלחה בדחייה
    deleted_at TEXT,               -- בסל המחזור מאז. NULL = לא נמחק. נמחק לתמיד אחרי TRASH_KEEP_DAYS
    FOREIGN KEY (upload_id, page_number) REFERENCES pages(upload_id, number)
);
CREATE INDEX IF NOT EXISTS forms_upload ON forms(upload_id, page_number, position);
CREATE INDEX IF NOT EXISTS forms_record ON forms(record_id);
CREATE INDEX IF NOT EXISTS forms_status ON forms(status);

-- הערכים: מה כתוב בטופס, ועד כמה בטוחים בזה?
-- כל שדה שייך למטופל (record_id, משותף לכל השורות שלו) או לשורה אחת (form_id, מספר ההתחייבות).
CREATE TABLE IF NOT EXISTS fields (
    id INTEGER PRIMARY KEY,
    record_id TEXT REFERENCES records(id),
    form_id TEXT REFERENCES forms(id),
    key TEXT NOT NULL,
    position INTEGER NOT NULL,     -- הסדר שבו השדות מוצגים
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL,
    uncertain INTEGER NOT NULL,    -- 0 / 1
    reason_code TEXT,
    reason TEXT,
    readings TEXT,                 -- JSON או NULL
    box TEXT,                      -- JSON או NULL
    corrected INTEGER NOT NULL DEFAULT 0,
    original_value TEXT,
    CHECK ((record_id IS NULL) <> (form_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS fields_record_key ON fields(record_id, key);
CREATE UNIQUE INDEX IF NOT EXISTS fields_form_key ON fields(form_id, key);

-- היסטוריית תיקונים: כל שינוי בשדה, מה היה ומה נהיה
CREATE TABLE IF NOT EXISTS field_history (
    id INTEGER PRIMARY KEY,
    field_id INTEGER NOT NULL REFERENCES fields(id),
    form_id TEXT NOT NULL REFERENCES forms(id),   -- מאיזו שורה נעשה השינוי
    old_value TEXT,
    new_value TEXT NOT NULL,
    source TEXT NOT NULL,          -- manual / gemini / qwen / confirmed
    changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS field_history_field ON field_history(field_id);

-- החלטות "להשאיר את כולם" על קבוצת כפילויות
CREATE TABLE IF NOT EXISTS duplicate_dismissals (
    id INTEGER PRIMARY KEY,
    form_ids TEXT NOT NULL UNIQUE, -- JSON ממוין, בלי כפולים: אותה קבוצה נשמרת פעם אחת
    dismissed_at TEXT NOT NULL
);

-- סשן צילום מהטלפון
CREATE TABLE IF NOT EXISTS capture_sessions (
    token_hash TEXT PRIMARY KEY,   -- רק הגיבוב של הקוד נשמר, לא הקוד עצמו
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,      -- נשמר גם אחרי שפג, כדי להחזיר 410 ולא 404
    upload_count INTEGER NOT NULL DEFAULT 0   -- כמה צילומים נשלחו עם הקוד (עד CAPTURE_MAX_UPLOADS)
);
"""


# עמודות שנוספו אחרי שכבר נוצרו מסדי נתונים: מוסיפים אותן למסד קיים בלי למחוק אותו
ADDED_COLUMNS = [("uploads", "thumbnail_path", "TEXT"),
                 ("uploads", "paused", "INTEGER NOT NULL DEFAULT 0"),
                 ("uploads", "removed_at", "TEXT"),
                 ("pages", "claim_id", "TEXT"),
                 ("forms", "deleted_at", "TEXT")]


def init_db():
    settings.STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.execute("PRAGMA journal_mode=WAL")   # ה-API והעובדים כותבים במקביל
        conn.executescript(SCHEMA + crypto.KEYS_SCHEMA)
        for table, column, column_type in ADDED_COLUMNS:
            existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if column not in existing:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}")
    crypto.seal("")   # יוצר את מפתח הנתונים של המסד כבר בהפעלה, ובודק שמפתח־העל מתאים לו


def _row(cursor, values):
    """שורה רגילה של sqlite3, אחרי פענוח העמודות המוצפנות (crypto.TEXT_PREFIX)."""
    return sqlite3.Row(cursor, tuple(crypto.open_value(v) for v in values))


@contextmanager
def connect():
    """חיבור לפעולה אחת: commit בסוף, rollback בשגיאה, ותמיד סגירה."""
    conn = sqlite3.connect(settings.DB_PATH, timeout=10)
    conn.row_factory = _row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA secure_delete=ON")   # מה שנמחק נדרס באפסים, ולא נשאר בקובץ המסד
    try:
        with conn:
            yield conn
    finally:
        conn.close()
