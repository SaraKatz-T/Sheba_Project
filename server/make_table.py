"""
טבלת תוצאות זמנית: קוראת את כל קובצי ה-JSON בתיקייה data/output
ויוצרת דף HTML אחד עם טבלה - שורה לכל רשומה (מטופל).
שדה שהמודל לא בטוח בו (medium / low) צבוע בכתום; שדה שלא נמצא - באפור.
עמידה עם העכבר על תא מציגה את ההערה של המודל ואת הטקסט המקורי שראה.

לא שולח כלום ל-Gemini. הרצה ב-PyCharm: לחיצה ימנית על הקובץ ← Run 'make_table'
"""

import html
import json

from commitment_extractor import config
from commitment_extractor.preprocess import load_manifest

TABLE_FILE = config.OUTPUT_DIR / "results_table.html"

# (כותרת העמודה, מאיפה לקחת את השדה, שם השדה)
FIELD_COLUMNS = [
    ("שם פרטי", "record", "first_name"),
    ("שם משפחה", "record", "last_name"),
    ("שם פרטי (הגדלה)", "zoom", "first_name"),
    ("שם משפחה (הגדלה)", "zoom", "last_name"),
    ("ת.ז.", "record", "id_number"),
    ("מספר מרכזי", "record", "central_numbers"),
    ("תאריך קבלה", "record", "received_date"),
    ("שולח", "record", "sender"),
    ("מספר התחייבות", "record", "commitment_numbers"),
]

CONFIDENCE_RANK = {"high": 0, "good": 0, "medium": 1, "low": 2}


def esc(text) -> str:
    return html.escape(str(text if text is not None else ""))


def field_cell(field) -> str:
    """תא אחד. שדה יכול להיות אובייקט אחד או רשימה (למשל כמה מספרים מרכזיים)."""
    if field is None:
        return '<td class="none">—</td>'
    items = field if isinstance(field, list) else [field]
    found = [f for f in items if isinstance(f, dict) and f.get("found")]
    if not found:
        notes = [f.get("issue", "") for f in items if isinstance(f, dict) and f.get("issue")]
        title = f' title="{esc(" | ".join(notes))}"' if notes else ""
        return f'<td class="missing"{title}>לא נמצא</td>'

    worst = max(CONFIDENCE_RANK.get(f.get("confidence"), 2) for f in found)
    css = "" if worst == 0 else ' class="unsure"'
    tips = []
    for f in found:
        tip = f"ביטחון: {f.get('confidence', '?')}"
        if f.get("raw_text") and f.get("raw_text") != f.get("value"):
            tip += f" | טקסט מקורי: {f['raw_text']}"
        if f.get("issue"):
            tip += f" | הערה: {f['issue']}"
        tips.append(tip)
    values = "<br>".join(esc(f.get("value", "")) for f in found)
    return f'<td{css} title="{esc(chr(10).join(tips))}">{values}</td>'


def build_rows(manifest: dict) -> list[str]:
    rows = []
    for json_file in sorted(config.OUTPUT_DIR.glob("*_p[0-9][0-9][0-9].json")):
        name = json_file.stem
        result = json.loads(json_file.read_text(encoding="utf-8"))
        info = manifest.get(name, {})
        source = info.get("source_file", name)
        page = info.get("page", "")
        image_link = f'<a href="../ready/{esc(name)}.png" target="_blank"><bdi>{esc(source)}</bdi></a>'
        rotated = info.get("rotated_degrees") or result.get("auto_rotated_degrees") or ""
        rotated = f"{rotated}°" if rotated else ""

        if "error" in result:
            rows.append(f'<tr><td>{image_link}</td><td>{esc(page)}</td>'
                        f'<td class="error" colspan="{len(FIELD_COLUMNS) + 3}">שגיאה: {esc(result["error"])}</td></tr>')
            continue

        records = result.get("records") or [{}]
        for i, record in enumerate(records, start=1):
            zoom = record.get("name_zoom") if isinstance(record.get("name_zoom"), dict) else {}
            cells = [image_link, esc(page), str(i) if len(records) > 1 else "",
                     esc(result.get("form_source", ""))]
            row = "".join(f"<td>{c}</td>" for c in cells)
            for _, where, key in FIELD_COLUMNS:
                row += field_cell((zoom if where == "zoom" else record).get(key))
            row += f"<td>{rotated}</td>"
            rows.append(f"<tr>{row}</tr>")
    return rows


PAGE = """<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>טבלת תוצאות</title>
<style>
  body {{ font-family: Arial, sans-serif; margin: 16px; background: #fff; color: #222; }}
  h1 {{ font-size: 20px; margin: 0 0 6px; }}
  .legend span {{ display: inline-block; padding: 2px 8px; margin-left: 8px; border: 1px solid #ccc; }}
  table {{ border-collapse: collapse; margin-top: 12px; font-size: 14px; }}
  th, td {{ border: 1px solid #ccc; padding: 5px 8px; vertical-align: top; text-align: right; }}
  th {{ background: #eef2f6; position: sticky; top: 0; }}
  tr:nth-child(even) td:not(.unsure):not(.missing) {{ background: #fafafa; }}
  .unsure {{ background: #ffd59e; }}
  .missing {{ background: #e4e4e4; color: #777; }}
  .none {{ color: #bbb; }}
  .error {{ background: #f8c9c9; }}
  td[title] {{ cursor: help; }}
</style>
</head>
<body>
<h1>טבלת תוצאות - {count} רשומות</h1>
<div class="legend">
  <span class="unsure">המודל לא בטוח</span>
  <span class="missing">לא נמצא</span>
  <span>עמידה עם העכבר על תא - הערת המודל. לחיצה על שם הקובץ - התמונה שנשלחה</span>
</div>
<table>
<thead><tr>{headers}</tr></thead>
<tbody>
{rows}
</tbody>
</table>
</body>
</html>
"""


def main():
    rows = build_rows(load_manifest())
    headers = ["קובץ", "עמוד", "רשומה", "מקור הטופס"] + [c[0] for c in FIELD_COLUMNS] + ["סובב"]
    TABLE_FILE.write_text(PAGE.format(count=len(rows), headers="".join(f"<th>{h}</th>" for h in headers),
                                      rows="\n".join(rows)), encoding="utf-8")
    print(f"נוצרה טבלה עם {len(rows)} שורות: {TABLE_FILE}")


if __name__ == "__main__":
    main()
