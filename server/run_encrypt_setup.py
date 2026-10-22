"""הגדרה חד-פעמית של הצפנת הנתונים, והצפנה של כל מה שכבר שמור.

הרצה (כשהשרת כבוי), מתוך התיקייה server:
    venv\\Scripts\\python.exe run_encrypt_setup.py

מה הסקריפט עושה:
1. אם חסר: יוצר מפתח־על (DATA_KEY) וסיסמה לקובץ האקסל שנשלח (EXPORT_FILE_PASSWORD), ושומר אותם ב-.env.
2. מצפין במסד הנתונים את העמודות עם פרטים אישיים שעוד לא מוצפנות.
3. מצפין את הקבצים בתיקייה storage/uploads שעוד לא מוצפנים (תמונות עמודים, תמונות מוקטנות, קבצים מקוריים).
4. דוחס את מסד הנתונים, כך שהעותקים הישנים והגלויים של הערכים לא נשארים בקובץ.

אפשר להריץ שוב בבטחה: מה שכבר מוצפן לא מוצפן פעמיים. אם ההרצה נקטעה באמצע, מריצים שוב.

החלפת מפתח־העל (למשל אם נחשף, או במעבר לענן אחר):
    venv\\Scripts\\python.exe run_encrypt_setup.py --rotate
הנתונים עצמם לא מוצפנים מחדש: רק מפתחות הנתונים נעטפים במפתח החדש.
"""

import argparse
import base64
import os
import re
import secrets
import socket
import sqlite3
import sys
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parent
ENV_PATH = ROOT / ".env"

# העמודות במסד שמכילות פרטים אישיים (זהה לכתיבה בקוד השרת: crypto.seal)
COLUMNS = {
    "uploads": ["file_name"],
    "pages": ["raw_result"],
    "fields": ["value", "original_value", "reason", "readings"],
    "field_history": ["old_value", "new_value"],
    "forms": ["reject_reason"],
}

PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # בלי תווים שמתבלבלים (0/O, 1/l)


def say(text=""):
    print(text, flush=True)


def new_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip("=")


def new_password() -> str:
    groups = ["".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(4)) for _ in range(4)]
    return "-".join(groups)   # למשל kP7q-Xm3d-9TzR-bW4n: קל להקריא בטלפון


def server_running(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def set_env(name: str, value: str, comment: str | None = None):
    """מוסיף שורה ל-.env, או מחליף את הערך אם השורה כבר קיימת."""
    text = ENV_PATH.read_text(encoding="utf-8") if ENV_PATH.exists() else ""
    line = f"{name}={value}"
    pattern = re.compile(rf"^{re.escape(name)}=.*$", re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(line, text, count=1)
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += (f"\n# {comment}\n" if comment else "") + line + "\n"
    ENV_PATH.write_text(text, encoding="utf-8")


def remove_env(name: str):
    text = ENV_PATH.read_text(encoding="utf-8")
    ENV_PATH.write_text(re.sub(rf"^{re.escape(name)}=.*\n?", "", text, flags=re.MULTILINE), encoding="utf-8")


def encrypt_columns(crypto, db_path: Path) -> int:
    conn = sqlite3.connect(db_path, timeout=30)   # חיבור רגיל, בלי פענוח אוטומטי: רואים את הערכים כפי שנשמרו
    count = 0
    try:
        with conn:
            for table, columns in COLUMNS.items():
                for column in columns:
                    rows = conn.execute(f"SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL "
                                        f"AND {column} NOT LIKE ?", (crypto.TEXT_PREFIX + "%",)).fetchall()
                    conn.executemany(f"UPDATE {table} SET {column} = ? WHERE rowid = ?",
                                     [(crypto.seal(value), rowid) for rowid, value in rows])
                    count += len(rows)
    finally:
        conn.close()
    return count


def encrypt_files(crypto, storage: Path) -> tuple[int, int]:
    folder = storage / "uploads"
    encrypted = removed = 0
    if not folder.exists():
        return 0, 0
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        if path.name.endswith(".part"):   # שארית של כתיבה שנקטעה, לא מוצפנת
            path.unlink()
            removed += 1
            continue
        if not crypto.is_encrypted_file(path):
            crypto.write_file(path, path.read_bytes())
            encrypted += 1
    return encrypted, removed


def compact(db_path: Path):
    conn = sqlite3.connect(db_path, timeout=30)
    try:
        conn.execute("PRAGMA secure_delete=ON")
        conn.execute("VACUUM")   # בונה את הקובץ מחדש: עותקים ישנים של ערכים גלויים לא נשארים בו
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()


def leftovers(root: Path) -> list[Path]:
    """תיקיות עם פרטים אישיים שהסקריפט לא מצפין (גיבויים ישנים, תוצאות של הרצות בדיקה)."""
    found = sorted(root.glob("storage.backup-*"))
    for name in ("data/input", "data/output", "data/ready"):
        folder = root / name
        if folder.exists() and any(p.is_file() and p.name != ".gitkeep" for p in folder.rglob("*")):
            found.append(folder)
    return found


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="הצפנת הנתונים של השרת")
    parser.add_argument("--rotate", action="store_true", help="החלפת מפתח־העל")
    args = parser.parse_args()

    env = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    port = int(env.get("SERVER_PORT") or 8000)
    if server_running(port):
        say(f"השרת פועל (פורט {port}). צריך לסגור את חלון השרת ולהריץ שוב.")
        sys.exit(1)

    created_key = created_password = None
    if args.rotate:
        if not env.get("DATA_KEY"):
            say("אין עדיין DATA_KEY ב-.env, ולכן אין מה להחליף. מריצים בלי --rotate.")
            sys.exit(1)
        set_env("DATA_KEY_PREVIOUS", env["DATA_KEY"])
        created_key = new_key()
        set_env("DATA_KEY", created_key)
    else:
        if not env.get("DATA_KEY"):
            created_key = new_key()
            set_env("DATA_KEY", created_key,
                    "מפתח־העל של הצפנת הנתונים. בלעדיו אי אפשר לקרוא שום נתון: לשמור עותק במקום בטוח")
        if not env.get("EXPORT_FILE_PASSWORD"):
            created_password = new_password()
            set_env("EXPORT_FILE_PASSWORD", created_password,
                    "הסיסמה של קובץ האקסל שנשלח למעבדה. מוסרים אותה בטלפון, לא במייל")

    load_dotenv(ENV_PATH, override=True)
    sys.path.insert(0, str(ROOT))
    from server import crypto, db, settings   # רק עכשיו: ההגדרות נקראות מה-.env המעודכן

    db.init_db()
    if args.rotate:
        count = crypto.rewrap_all()
        remove_env("DATA_KEY_PREVIOUS")
        say(f"מפתח־העל הוחלף. {count} מפתחות נתונים נעטפו במפתח החדש.")
    else:
        say("מצפין את מסד הנתונים…")
        columns = encrypt_columns(crypto, settings.DB_PATH)
        say("מצפין את הקבצים…")
        files, partials = encrypt_files(crypto, settings.STORAGE_DIR)
        crypto.sweep_file_keys()
        say("דוחס את מסד הנתונים…")
        compact(settings.DB_PATH)
        say()
        say(f"הסתיים: הוצפנו {columns} ערכים במסד ו-{files} קבצים.")
        if partials:
            say(f"נמחקו {partials} שאריות של קבצים שהכתיבה שלהם נקטעה.")

    say()
    if created_key:
        say("חשוב: נוצר מפתח־על חדש (DATA_KEY) בקובץ .env.")
        say("  בלעדיו אי אפשר לקרוא שום נתון, גם לא מגיבוי.")
        say("  מעתיקים את השורה DATA_KEY=... מתוך .env למקום בטוח (מנהל סיסמאות), בנפרד מהגיבויים.")
        say()
    if created_password:
        say(f"הסיסמה של קובץ האקסל שנשלח למעבדה: {created_password}")
        say("  מוסרים אותה למעבדה בטלפון, פעם אחת. היא שמורה גם ב-.env (EXPORT_FILE_PASSWORD).")
        say()
    left = leftovers(ROOT)
    if left:
        say("נשארו תיקיות עם פרטים אישיים שלא מוצפנים (הסקריפט לא נוגע בהן):")
        for path in left:
            say(f"  {path.relative_to(ROOT)}")
        say("  אם הן לא נחוצות, כדאי למחוק אותן.")


if __name__ == "__main__":
    main()
