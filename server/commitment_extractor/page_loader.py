"""פיצול קובץ קלט לעמודים: כל עמוד הופך לתמונת PNG שנשלחת למודל בנפרד."""

import io
from dataclasses import dataclass
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

from . import config

try:
    import pillow_heif
    pillow_heif.register_heif_opener()  # מאפשר ל-Pillow לפתוח HEIC/HEIF (צילומי אייפון)
except ImportError:
    pass

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp", ".heic", ".heif"}
SUPPORTED_SUFFIXES = IMAGE_SUFFIXES | {".pdf"}


@dataclass
class PageImage:
    source_file: str
    page_number: int  # מתחיל מ-1
    png_bytes: bytes


def _to_png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def load_pages(path: Path):
    """מחזיר את כל העמודים בקובץ (PDF או תמונה) כתמונות PNG."""
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        pdf = pdfium.PdfDocument(str(path))
        try:
            for i in range(len(pdf)):
                img = pdf[i].render(scale=config.PDF_RENDER_DPI / 72).to_pil()
                yield PageImage(path.name, i + 1, _to_png(img))
        finally:
            pdf.close()
    elif suffix in IMAGE_SUFFIXES:
        with Image.open(path) as img:
            n_frames = getattr(img, "n_frames", 1)  # TIFF יכול להכיל כמה עמודים
            for i in range(n_frames):
                img.seek(i)
                yield PageImage(path.name, i + 1, _to_png(img))
    else:
        raise ValueError(f"סוג קובץ לא נתמך: {path.name}")
