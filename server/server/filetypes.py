"""זיהוי סוג קובץ לפי התוכן (magic bytes) ולא לפי הסיומת."""

HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis"}
HEIF_BRANDS = {b"mif1", b"msf1"}

# סוג (MIME) ← הסיומת שבה הקובץ נשמר בדיסק
EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/tiff": ".tif",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "image/webp": ".webp",
}


def detect(head: bytes) -> str | None:
    """מחזיר את סוג הקובץ לפי הבתים הראשונים שלו, או None אם הסוג לא נתמך."""
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp":
        if head[8:12] in HEIC_BRANDS:
            return "image/heic"
        if head[8:12] in HEIF_BRANDS:
            return "image/heif"
    return None
