"""תמונה מוקטנת של העמוד הראשון (thumbnail_url), שהלקוח מציג בתור הקליטה.

נוצרת מיד בקליטה, לפני התור, כדי שתוצג כבר בזמן ההמתנה. PDF: מציירים רק את העמוד הראשון.
תמונה (כולל HEIC ו-TIFF): מקטינים. החוזה: ברוחב של בערך 240 פיקסלים, עד 40KB.
"""

import io

import pypdfium2 as pdfium
from PIL import Image

import commitment_extractor.page_loader  # noqa: F401  רושם את פתיחת HEIC ב-Pillow

from .worker import PDFIUM_LOCK

WIDTH = 240
MAX_BYTES = 40 * 1024


def _first_page(path, file_type: str) -> Image.Image:
    if file_type == "application/pdf":
        with PDFIUM_LOCK:
            pdf = pdfium.PdfDocument(str(path))
            try:
                page = pdf[0]
                scale = WIDTH * 2 / page.get_width()   # פי 2 מהרוחב הסופי, להקטנה חדה
                image = page.render(scale=scale).to_pil().convert("RGB")
                page.close()
                return image
            finally:
                pdf.close()
    with Image.open(path) as img:
        img.draft("RGB", (WIDTH * 2, WIDTH * 4))   # ב-JPEG: קורא ישר בגודל קטן, מהר יותר
        img.seek(0)                                 # TIFF: העמוד הראשון
        return img.convert("RGB")


def make(path, file_type: str) -> bytes | None:
    """JPEG קטן של העמוד הראשון, או None אם אי אפשר (קובץ פגום וכד'). כשל לא מכשיל את הקליטה."""
    try:
        img = _first_page(path, file_type)
    except Exception:
        return None
    img.thumbnail((WIDTH, WIDTH * 4), Image.LANCZOS)
    data = b""
    for quality in (80, 65, 50, 35):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        data = buf.getvalue()
        if len(data) <= MAX_BYTES:
            break
    return data
