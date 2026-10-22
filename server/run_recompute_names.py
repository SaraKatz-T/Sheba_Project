"""מחיל את כלל השמות הנוכחי (mapping._name) על טפסים שכבר נקראו.

אחרי שינוי בכלל: עובר על כל העמודים שנקראו, מחשב מחדש את שם פרטי ושם משפחה מהתשובה המקורית של Gemini
(שתי הקריאות שמורות בה), ומעדכן את השדות שהתוצאה שלהם השתנתה: הערך, הצהוב וההסבר.

לא נוגעים ב:
- שדה שאדם תיקן או אישר (corrected, או היסטוריה שלא נוצרה אוטומטית).
- טופס שאדם אישר או דחה, או טופס בסל המחזור.
טופס שאושר אוטומטית (בלי שדות צהובים, ברגע הקריאה) וקיבל עכשיו שדה צהוב: חוזר ל"ממתין לבדיקה".
טופס שממתין לבדיקה ונשאר בלי אף שדה צהוב: מאושר, כמו שהיה קורה בקריאה (אם אף אחד לא נגע בו).

הרצה, מתוך התיקייה server:
    venv\\Scripts\\python.exe run_recompute_names.py           תצוגה מקדימה, בלי לשנות כלום
    venv\\Scripts\\python.exe run_recompute_names.py --apply   ביצוע
"""

import argparse
import json
import sys
from datetime import datetime, timedelta

from server import crypto, db
from server.times import iso, utcnow
from server.worker import mapping

AUTO_APPROVE_WINDOW = timedelta(seconds=30)   # אישור אוטומטי קורה באותו רגע שהעמוד נשמר
AUTOMATIC_SOURCES = ("gemini",)               # היסטוריה שנוצרה בתיקונים אוטומטיים, לא על ידי אדם
LABELS = {"first_name": "שם פרטי", "last_name": "שם משפחה"}


def _when(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00")) if text else None


def _human_touched(conn, field_id) -> bool:
    marks = ",".join("?" * len(AUTOMATIC_SOURCES))
    return conn.execute(f"SELECT 1 FROM field_history WHERE field_id = ? AND source NOT IN ({marks})",
                        (field_id, *AUTOMATIC_SOURCES)).fetchone() is not None


def _yellow_left(conn, form_id, record_id) -> int:
    return conn.execute("SELECT COUNT(*) FROM fields WHERE uncertain = 1 AND (form_id = ? OR record_id = ?)",
                        (form_id, record_id)).fetchone()[0]


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="לבצע (בלי זה: רק תצוגה מקדימה)")
    args = parser.parse_args()

    db.init_db()
    changes, reopened, approved, skipped = [], set(), set(), 0
    with db.connect() as conn:
        if args.apply:
            conn.execute("BEGIN IMMEDIATE")
        pages = conn.execute("SELECT upload_id, number, raw_result, finished_at FROM pages "
                             "WHERE raw_result IS NOT NULL").fetchall()
        for page in pages:
            try:
                records = [r for r in (json.loads(page["raw_result"]).get("records") or []) if isinstance(r, dict)]
            except (TypeError, ValueError, AttributeError):
                continue
            finished = _when(page["finished_at"])
            for position, record in enumerate(records, start=1):
                rec = conn.execute("SELECT id FROM records WHERE upload_id = ? AND page_number = ? AND position = ?",
                                   (page["upload_id"], page["number"], position)).fetchone()
                if rec is None:
                    continue
                forms = conn.execute("SELECT id, status, reviewed_at, deleted_at FROM forms WHERE record_id = ?",
                                     (rec["id"],)).fetchall()
                if not forms or any(f["deleted_at"] or f["status"] == "rejected" for f in forms):
                    continue
                if any(f["status"] == "approved" and not (finished and f["reviewed_at"] and
                       abs(_when(f["reviewed_at"]) - finished) <= AUTO_APPROVE_WINDOW) for f in forms):
                    continue   # אדם אישר: לא נוגעים
                changed_here = False
                for key in mapping.NAME_KEYS:
                    new = mapping._name(record, key)
                    field = conn.execute("SELECT * FROM fields WHERE record_id = ? AND key = ?",
                                         (rec["id"], key)).fetchone()
                    if field is None:
                        continue
                    same = (field["value"] == new["value"] and bool(field["uncertain"]) == new["uncertain"])
                    if same:
                        continue
                    if field["corrected"] or _human_touched(conn, field["id"]):
                        skipped += 1
                        continue
                    changes.append((page["upload_id"], page["number"], key, field["value"], bool(field["uncertain"]),
                                    new["value"], new["uncertain"]))
                    changed_here = True
                    if not args.apply:
                        continue
                    now = iso(utcnow())
                    conn.execute("UPDATE fields SET value = ?, uncertain = ?, reason_code = ?, reason = ? WHERE id = ?",
                                 (crypto.seal(new["value"]), int(new["uncertain"]), new["reason_code"],
                                  crypto.seal(new["reason"]), field["id"]))
                    if field["value"] != new["value"]:
                        conn.execute("INSERT INTO field_history (field_id, form_id, old_value, new_value, source, "
                                     "changed_at) VALUES (?, ?, ?, ?, 'gemini', ?)",
                                     (field["id"], forms[0]["id"], crypto.seal(field["value"]),
                                      crypto.seal(new["value"]), now))
                if not (args.apply and changed_here):
                    continue
                now = iso(utcnow())
                for f in forms:
                    left = _yellow_left(conn, f["id"], rec["id"])
                    if f["status"] == "approved" and left:   # אושר אוטומטית ועכשיו יש צהוב: חוזר לבדיקה
                        conn.execute("UPDATE forms SET status = 'pending_review', reviewed_at = NULL, updated_at = ? "
                                     "WHERE id = ?", (now, f["id"]))
                        reopened.add(f["id"])
                    elif f["status"] == "pending_review" and not left:   # כמו האישור האוטומטי בקריאה
                        conn.execute("UPDATE forms SET status = 'approved', reviewed_at = ?, updated_at = ? "
                                     "WHERE id = ?", (now, now, f["id"]))
                        approved.add(f["id"])
                    else:
                        conn.execute("UPDATE forms SET updated_at = ? WHERE id = ?", (now, f["id"]))

    def show(value, yellow):
        return f"\"{value}\"" + (" (צהוב)" if yellow else "")

    for upload_id, number, key, old, old_y, new, new_y in changes:
        print(f"{upload_id} עמוד {number}, {LABELS[key]}: {show(old, old_y)} ← {show(new, new_y)}")
    print(f"\n{'עודכנו' if args.apply else 'יעודכנו'} {len(changes)} שדות.", end=" ")
    if args.apply:
        print(f"{len(reopened)} טפסים חזרו ל\"ממתין לבדיקה\", {len(approved)} טפסים אושרו (אין בהם יותר צהוב).",
              end=" ")
    print(f"דילוג על {skipped} שדות שאדם תיקן או אישר.")
    if not args.apply and changes:
        print("זו תצוגה מקדימה. לביצוע: להריץ שוב עם --apply")


if __name__ == "__main__":
    main()
