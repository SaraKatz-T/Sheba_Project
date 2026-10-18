"""
נקודת ההרצה: עוברת על כל הקבצים בתיקייה data/input,
שולחת כל עמוד ל-Gemini ושומרת את התוצאות בתיקייה data/output.

הרצה ב-PyCharm: לחיצה ימנית על הקובץ ← Run 'run_extraction'
"""

import json
import sys

from commitment_extractor import config
from commitment_extractor.gemini_extractor import GeminiExtractor
from commitment_extractor.page_loader import SUPPORTED_SUFFIXES, load_pages


def main():
    files = sorted(p for p in config.INPUT_DIR.iterdir() if p.suffix.lower() in SUPPORTED_SUFFIXES)
    if not files:
        sys.exit(f"לא נמצאו קבצים בתיקייה {config.INPUT_DIR}. שימי שם PDF או תמונות.")

    extractor = GeminiExtractor()
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_results = []

    for path in files:
        for page in load_pages(path):
            label = f"{page.source_file} - עמוד {page.page_number}"
            out_file = config.OUTPUT_DIR / f"{path.stem}_p{page.page_number:03d}.json"
            if out_file.exists():  # כבר חולץ בהרצה קודמת - לא שולחים שוב
                result = json.loads(out_file.read_text(encoding="utf-8"))
                print(f"דילוג (קיים): {label}")
            else:
                print(f"מחלץ: {label} ...", end=" ", flush=True)
                try:
                    result = extractor.extract_page(page.png_bytes)
                    out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                    print(f"{len(result.get('records', []))} רשומות")
                except Exception as e:
                    print(f"שגיאה: {e}")
                    result = {"error": str(e)}
            all_results.append({"source_file": page.source_file, "page": page.page_number, "result": result})

    combined = config.OUTPUT_DIR / "all_results.json"
    combined.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nסיום. כל התוצאות: {combined}")


if __name__ == "__main__":
    main()
