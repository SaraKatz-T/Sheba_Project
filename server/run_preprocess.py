"""
שלב 1 - עיבוד מקדים: עובר על כל הקבצים בתיקייה data/input,
מפצל כל קובץ לעמודים (כל עמוד = טופס), מיישר, מתאים גודל
ושומר כל עמוד כתמונת PNG בתיקייה data/ready - מוכנה לשליחה ל-Gemini.

אחרי זה מריצים את run_extraction.py.
הרצה ב-PyCharm: לחיצה ימנית על הקובץ ← Run 'run_preprocess'
"""

import sys

from commitment_extractor import config
from commitment_extractor.page_loader import SUPPORTED_SUFFIXES
from commitment_extractor.preprocess import load_manifest, prepare_file, save_manifest


def main():
    files = sorted(p for p in config.INPUT_DIR.iterdir() if p.suffix.lower() in SUPPORTED_SUFFIXES)
    if not files:
        sys.exit(f"לא נמצאו קבצים בתיקייה {config.INPUT_DIR}. שימי שם PDF או תמונות.")

    config.READY_DIR.mkdir(parents=True, exist_ok=True)
    manifest = load_manifest()
    prepared = 0
    for path in files:
        try:
            prepared += prepare_file(path, manifest)
        except Exception as e:
            print(f"שגיאה בקובץ {path.name}: {e}")
        save_manifest(manifest)  # שומרים אחרי כל קובץ, כדי לא לאבד עבודה אם משהו נכשל

    print(f"\nסיום. הוכנו {prepared} עמודים חדשים. התמונות בתיקייה: {config.READY_DIR}")


if __name__ == "__main__":
    main()
