"""הצפנת הנתונים ששמורים בדיסק (AES-256-GCM).

שתי שכבות מפתחות:
- מפתח־על (DATA_KEY ב-.env; בענן: בכספת המפתחות של הענן). לא נשמר ליד הנתונים ולא ב-git.
- מפתחות נתונים: אחד למסד הנתונים, ואחד לכל קובץ בדיסק. הם נשמרים בטבלה keys, מוצפנים במפתח־העל.

למה כך:
- החלפת מפתח־העל, או מעבר לענן אחר, מצפינים מחדש רק את מפתחות הנתונים, לא את כל הנתונים.
- כשקובץ נמחק, גם המפתח שלו נמחק (sweep_file_keys), כך ששאריות של הקובץ בדיסק לא ניתנות לפענוח.
- מסד הנתונים לבדו, או תיקיית הקבצים לבדה, או שניהם יחד בלי מפתח־העל: לא ניתנים לקריאה.

מה מוצפן במסד: רק העמודות עם פרטים אישיים (ערכי השדות, ההיסטוריה, התשובה של Gemini, שם הקובץ,
סיבת הדחייה). סטטוסים, תאריכים ומזהים נשארים גלויים, כדי שהתור והסינון יעבדו כרגיל.
קריאה מפענחת אוטומטית (db.connect), וכתיבה מצפינה במפורש (seal) בכל מקום שכותב עמודות כאלה.
"""

import base64
import os
import sqlite3
import threading
from datetime import timedelta
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from . import settings
from .times import iso, utcnow

TEXT_PREFIX = "enc1:"       # ערך מוצפן במסד: enc1:<base64 של nonce + הצופן>
FILE_MAGIC = b"SHBENC1"     # תחילת קובץ מוצפן בדיסק
WRAP_VERSION = b"\x01"
NONCE = 12
DB_KEY_NAME = "db"
FILE_KEY_PREFIX = "file:"
KEY_SWEEP_GRACE = timedelta(hours=1)   # מפתח חדש שהקובץ שלו עוד נכתב לא נמחק בטעות

KEYS_SCHEMA = """
CREATE TABLE IF NOT EXISTS keys (
    name TEXT PRIMARY KEY,         -- db, או file:<נתיב הקובץ יחסי ל-storage>
    wrapped BLOB NOT NULL,         -- המפתח, מוצפן במפתח־העל
    created_at TEXT NOT NULL
);
"""

MISSING_KEY_MESSAGE = ("חסר מפתח הצפנה. צריך להריץ פעם אחת את run_encrypt_setup.py, "
                       "שיוצר אותו בקובץ .env ומצפין את הנתונים הקיימים.")


class CryptoError(Exception):
    pass


_lock = threading.Lock()
_db_key: bytes | None = None


def _parse_key(text: str, name: str) -> bytes:
    try:
        key = base64.urlsafe_b64decode(text.strip() + "=" * (-len(text.strip()) % 4))
    except ValueError:
        raise CryptoError(f"{name} לא תקין: צריך להיות מחרוזת base64 של 32 בתים.")
    if len(key) != 32:
        raise CryptoError(f"{name} לא תקין: צריך להיות 32 בתים (AES-256).")
    return key


def _master_keys() -> list[bytes]:
    """מפתח־העל הנוכחי, ואחריו הקודם (אם הוגדר DATA_KEY_PREVIOUS בזמן החלפת מפתח)."""
    if not settings.DATA_KEY:
        raise CryptoError(MISSING_KEY_MESSAGE)
    keys = [_parse_key(settings.DATA_KEY, "DATA_KEY")]
    if settings.DATA_KEY_PREVIOUS:
        keys.append(_parse_key(settings.DATA_KEY_PREVIOUS, "DATA_KEY_PREVIOUS"))
    return keys


def new_master_key() -> str:
    return base64.urlsafe_b64encode(AESGCM.generate_key(bit_length=256)).decode().rstrip("=")


def check_ready():
    """בהפעלת השרת: מפתח־העל קיים ותקין. אחרת השרת לא עולה."""
    _master_keys()


# --- עטיפת מפתחות נתונים במפתח־העל ---

def wrap(data_key: bytes) -> bytes:
    nonce = os.urandom(NONCE)
    return WRAP_VERSION + nonce + AESGCM(_master_keys()[0]).encrypt(nonce, data_key, b"sheba-data-key")


def unwrap(blob: bytes) -> bytes:
    if not blob or blob[:1] != WRAP_VERSION:
        raise CryptoError("מפתח נתונים בפורמט לא מוכר.")
    nonce, body = blob[1:1 + NONCE], blob[1 + NONCE:]
    for master in _master_keys():
        try:
            return AESGCM(master).decrypt(nonce, body, b"sheba-data-key")
        except InvalidTag:
            continue
    raise CryptoError("מפתח־העל לא מתאים לנתונים. ייתכן ש-DATA_KEY הוחלף או הועתק לא נכון.")


# --- גישה לטבלת המפתחות (חיבור משלה, בלי פענוח שורות, כדי למנוע תלות מעגלית עם db) ---

def _keys_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.DB_PATH, timeout=10)
    conn.execute("PRAGMA secure_delete=ON")
    conn.executescript(KEYS_SCHEMA)
    return conn


def _db_data_key() -> bytes:
    global _db_key
    if _db_key is not None:
        return _db_key
    with _lock:
        if _db_key is None:
            conn = _keys_conn()
            try:
                with conn:
                    row = conn.execute("SELECT wrapped FROM keys WHERE name = ?", (DB_KEY_NAME,)).fetchone()
                    if row is None:
                        key = AESGCM.generate_key(bit_length=256)
                        conn.execute("INSERT INTO keys (name, wrapped, created_at) VALUES (?, ?, ?)",
                                     (DB_KEY_NAME, wrap(key), iso(utcnow())))
                    else:
                        key = unwrap(row[0])
            finally:
                conn.close()
            _db_key = key
    return _db_key


def reset_cache():
    """אחרי החלפת מפתח־העל או בבדיקות."""
    global _db_key
    with _lock:
        _db_key = None


# --- ערכים במסד הנתונים ---

def seal(value):
    """מצפין טקסט לפני שמירה במסד. None נשאר None; ערך שכבר מוצפן לא מוצפן פעמיים."""
    if value is None:
        return None
    text = str(value)
    if text.startswith(TEXT_PREFIX):
        return text
    nonce = os.urandom(NONCE)
    body = AESGCM(_db_data_key()).encrypt(nonce, text.encode("utf-8"), b"sheba-db")
    return TEXT_PREFIX + base64.b64encode(nonce + body).decode("ascii")


def open_value(value):
    """מפענח ערך שנקרא מהמסד. ערך לא מוצפן (מלפני ההצפנה) חוזר כמו שהוא."""
    if not isinstance(value, str) or not value.startswith(TEXT_PREFIX):
        return value
    raw = base64.b64decode(value[len(TEXT_PREFIX):])
    try:
        return AESGCM(_db_data_key()).decrypt(raw[:NONCE], raw[NONCE:], b"sheba-db").decode("utf-8")
    except InvalidTag:
        raise CryptoError("ערך במסד הנתונים לא מתפענח: הוא שונה או שהמפתח לא מתאים.")


# --- קבצים בדיסק ---

def _rel(path: Path) -> str:
    return Path(path).resolve().relative_to(settings.STORAGE_DIR.resolve()).as_posix()


def write_file(path: Path, data: bytes):
    """שומר קובץ מוצפן במפתח חדש משלו. הקובץ מופיע בשמו הסופי רק כשהוא שלם."""
    path = Path(path)
    rel = _rel(path)
    key = AESGCM.generate_key(bit_length=256)
    conn = _keys_conn()
    try:
        with conn:   # המפתח נשמר לפני הקובץ: אין רגע שבו יש קובץ בלי מפתח
            conn.execute("INSERT OR REPLACE INTO keys (name, wrapped, created_at) VALUES (?, ?, ?)",
                         (FILE_KEY_PREFIX + rel, wrap(key), iso(utcnow())))
    finally:
        conn.close()
    nonce = os.urandom(NONCE)
    body = AESGCM(key).encrypt(nonce, data, rel.encode("utf-8"))   # קשור לנתיב: אי אפשר להחליף קבצים ביניהם
    partial = path.with_name(path.name + ".part")
    partial.write_bytes(FILE_MAGIC + nonce + body)
    os.replace(partial, path)


def is_encrypted_file(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(len(FILE_MAGIC)) == FILE_MAGIC


def read_file(path: Path) -> bytes:
    """קורא ומפענח קובץ, בזיכרון בלבד. קובץ לא מוצפן (מלפני ההצפנה) חוזר כמו שהוא."""
    path = Path(path)
    raw = path.read_bytes()
    if not raw.startswith(FILE_MAGIC):
        return raw
    rel = _rel(path)
    conn = _keys_conn()
    try:
        row = conn.execute("SELECT wrapped FROM keys WHERE name = ?", (FILE_KEY_PREFIX + rel,)).fetchone()
    finally:
        conn.close()
    if row is None:
        raise FileNotFoundError(f"המפתח של הקובץ לא קיים: {rel}")
    body = raw[len(FILE_MAGIC):]
    try:
        return AESGCM(unwrap(row[0])).decrypt(body[:NONCE], body[NONCE:], rel.encode("utf-8"))
    except InvalidTag:
        raise CryptoError(f"הקובץ לא מתפענח: הוא שונה או שהמפתח לא מתאים ({rel}).")


def sweep_file_keys() -> int:
    """מוחק מפתחות של קבצים שכבר לא קיימים (נמחקו בניקוי, בסל המחזור או בהסרה). מחזיר כמה נמחקו."""
    cutoff = iso(utcnow() - KEY_SWEEP_GRACE)
    conn = _keys_conn()
    try:
        rows = conn.execute("SELECT name FROM keys WHERE name LIKE ? AND created_at <= ?",
                            (FILE_KEY_PREFIX + "%", cutoff)).fetchall()
        gone = [name for (name,) in rows
                if not (settings.STORAGE_DIR / name[len(FILE_KEY_PREFIX):]).exists()]
        with conn:
            conn.executemany("DELETE FROM keys WHERE name = ?", [(n,) for n in gone])
    finally:
        conn.close()
    return len(gone)


def rewrap_all() -> int:
    """אחרי החלפת מפתח־העל: עוטף מחדש את כל מפתחות הנתונים במפתח החדש. הנתונים עצמם לא משתנים."""
    conn = _keys_conn()
    try:
        rows = conn.execute("SELECT name, wrapped FROM keys").fetchall()
        with conn:
            conn.executemany("UPDATE keys SET wrapped = ? WHERE name = ?",
                             [(wrap(unwrap(blob)), name) for name, blob in rows])
    finally:
        conn.close()
    reset_cache()
    return len(rows)
