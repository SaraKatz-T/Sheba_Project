"""עיבוד מקדים: הופך כל קובץ קלט לתמונות מוכנות לשליחה ל-Gemini.

כל עמוד = טופס אחד. לכל עמוד: יישור (אם הוא מסובב), התאמת גודל ושמירה כ-PNG בתיקייה data/ready.
"""

import io
import json
import os

from PIL import Image

from . import config
from .page_loader import load_pages

MANIFEST_NAME = "manifest.json"

# --- יישור עמודים מסובבים, במחשב שלכם, לפני השליחה ל-Gemini ---
# משתמשים ב-Tesseract (חינמי, רץ מקומית) רק כדי לזהות את כיוון העמוד.
# אם Tesseract לא מותקן - העמוד נשמר כמו שהוא, בלי שגיאה.
WINDOWS_TESSERACT_PATH = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

_tesseract_ready = None


def _init_tesseract() -> bool:
    global _tesseract_ready
    if _tesseract_ready is None:
        try:
            import pytesseract
            if os.name == "nt" and os.path.exists(WINDOWS_TESSERACT_PATH):
                pytesseract.pytesseract.tesseract_cmd = WINDOWS_TESSERACT_PATH
            pytesseract.get_tesseract_version()
            _tesseract_ready = True
        except Exception:
            print("⚠ Tesseract לא מותקן - עמודים מסובבים יישמרו בלי יישור")
            _tesseract_ready = False
    return _tesseract_ready


def straighten(img: Image.Image) -> tuple[Image.Image, int]:
    """מזהה את כיוון העמוד ומסובב אותו ישר. מחזיר (תמונה, בכמה מעלות סובבה)."""
    if not config.AUTO_ROTATE or not _init_tesseract():
        return img, 0
    import pytesseract
    small = img.copy()
    small.thumbnail((1600, 1600))  # הקטנה - מספיק לזיהוי כיוון, ומהיר יותר
    try:
        osd = pytesseract.image_to_osd(small, output_type=pytesseract.Output.DICT)
    except Exception:
        return img, 0  # עמוד בלי מספיק טקסט לזיהוי - נשמר כמו שהוא
    degrees = int(osd.get("rotate", 0)) % 360
    if degrees == 0 or osd.get("orientation_conf", 0) < config.MIN_ROTATION_CONFIDENCE:
        return img, 0
    return img.rotate(-degrees, expand=True), degrees  # סיבוב בכיוון השעון


def fit_size(img: Image.Image) -> Image.Image:
    """מקטין תמונה שהצלע הארוכה שלה גדולה מ-MAX_IMAGE_SIDE. תמונה קטנה לא מוגדלת."""
    if max(img.size) <= config.MAX_IMAGE_SIDE:
        return img
    img = img.copy()
    img.thumbnail((config.MAX_IMAGE_SIDE, config.MAX_IMAGE_SIDE), Image.LANCZOS)
    return img


def load_manifest() -> dict:
    path = config.READY_DIR / MANIFEST_NAME
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def save_manifest(manifest: dict):
    path = config.READY_DIR / MANIFEST_NAME
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def prepare_file(path, manifest: dict) -> int:
    """מכין את כל העמודים של קובץ אחד. מחזיר כמה עמודים הוכנו (בלי אלה שכבר קיימים)."""
    prepared = 0
    for page in load_pages(path):
        name = f"{path.stem}_p{page.page_number:03d}"
        out_file = config.READY_DIR / f"{name}.png"
        label = f"{page.source_file} - עמוד {page.page_number}"
        if out_file.exists() and name in manifest:  # כבר הוכן בהרצה קודמת
            print(f"דילוג (קיים): {label}")
            continue
        with Image.open(io.BytesIO(page.png_bytes)) as img:
            img, rotated = straighten(img.convert("RGB"))
            original_size = img.size
            img = fit_size(img)
            img.save(out_file, format="PNG")
        manifest[name] = {"source_file": page.source_file, "page": page.page_number,
                          "rotated_degrees": rotated, "size": list(img.size)}
        notes = []
        if rotated:
            notes.append(f"יושר {rotated}°")
        if img.size != original_size:
            notes.append(f"הוקטן מ-{original_size[0]}x{original_size[1]}")
        print(f"הוכן: {label} → {out_file.name}" + (f" ({', '.join(notes)})" if notes else ""))
        prepared += 1
    return prepared
