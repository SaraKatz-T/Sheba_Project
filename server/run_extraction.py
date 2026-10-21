"""
שלב 2 - חילוץ: עובר על התמונות המוכנות בתיקייה data/ready (שנוצרו ב-run_preprocess.py),
שולח כל תמונה ל-Gemini ושומר את התוצאות בתיקייה data/output.

הרצה ב-PyCharm: לחיצה ימנית על הקובץ ← Run 'run_extraction'
"""

import json
import sys
import time

from commitment_extractor import config
from commitment_extractor.gemini_extractor import GeminiExtractor
from commitment_extractor.name_zoom import crop_name_region
from commitment_extractor.preprocess import load_manifest


def zoom_names(extractor, result, page_png, crop_base_name):
    """שלב שני: לכל רשומה - חותכים את אזור השם, מגדילים ושולחים שוב ל-Gemini.
    התוצאה נשמרת ברשומה תחת name_zoom, לצד מה שזוהה בעמוד המלא."""
    for i, record in enumerate(result.get("records", []), start=1):
        crop = crop_name_region(page_png, record.get("name_box"))
        if crop is None:
            record["name_zoom"] = {"skipped": "no valid name_box", "name_box": record.get("name_box")}
            print(f"\n  ⚠ רשומה {i}: לא התקבל מיקום שם תקין ({record.get('name_box')}), החיתוך דולג", end=" ")
            continue
        if config.SAVE_NAME_CROPS:
            crops_dir = config.OUTPUT_DIR / "name_crops"
            crops_dir.mkdir(exist_ok=True)
            (crops_dir / f"{crop_base_name}_r{i}.png").write_bytes(crop)
        try:
            record["name_zoom"] = extractor.extract_page(crop, task="name")
        except Exception as e:
            record["name_zoom"] = {"error": str(e)}


def main():
    manifest = load_manifest()
    if not manifest:
        sys.exit(f"לא נמצאו תמונות מוכנות בתיקייה {config.READY_DIR}. הריצי קודם את run_preprocess.py.")

    extractor = GeminiExtractor()
    config.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_results = []
    run_start = time.time()
    processed = 0

    for name, info in sorted(manifest.items()):
        label = f"{info['source_file']} - עמוד {info['page']}"
        out_file = config.OUTPUT_DIR / f"{name}.json"
        if out_file.exists():  # כבר חולץ בהרצה קודמת - לא שולחים שוב
            result = json.loads(out_file.read_text(encoding="utf-8"))
            print(f"דילוג (קיים): {label}")
        else:
            print(f"מחלץ: {label} ...", end=" ", flush=True)
            try:
                page_png = (config.READY_DIR / f"{name}.png").read_bytes()
                page_start = time.time()
                result = extractor.extract_page(page_png)
                page_seconds = time.time() - page_start
                if info.get("rotated_degrees"):
                    result["auto_rotated_degrees"] = info["rotated_degrees"]
                zoom_seconds = 0.0
                if config.NAME_ZOOM_ENABLED:
                    zoom_start = time.time()
                    zoom_names(extractor, result, page_png, name)
                    zoom_seconds = time.time() - zoom_start
                result["timing_seconds"] = {"page": round(page_seconds, 1), "name_zoom": round(zoom_seconds, 1)}
                out_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
                processed += 1
                print(f"{len(result.get('records', []))} רשומות | עמוד: {page_seconds:.1f} | "
                      f"שם: {zoom_seconds:.1f} | סה\"כ: {page_seconds + zoom_seconds:.1f} שנ'")
            except Exception as e:
                print(f"שגיאה: {e}")
                result = {"error": str(e)}
        all_results.append({"source_file": info["source_file"], "page": info["page"], "result": result})

    combined = config.OUTPUT_DIR / "all_results.json"
    combined.write_text(json.dumps(all_results, ensure_ascii=False, indent=2), encoding="utf-8")
    total = time.time() - run_start
    print(f"\nסיום. עובדו {processed} עמודים ב-{total:.1f} שניות", end="")
    print(f" (ממוצע {total / processed:.1f} שניות לעמוד)" if processed else "")
    print(f"כל התוצאות: {combined}")


if __name__ == "__main__":
    main()
