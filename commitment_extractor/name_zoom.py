"""חיתוך והגדלה של אזור שם המטופל, לשליחה חוזרת ל-Gemini.

המיקום מגיע מהשלב הראשון (name_box) בפורמט של Gemini:
[ymin, xmin, ymax, xmax] במספרים 0-1000 יחסית לגודל התמונה.
"""

import io

from PIL import Image

from . import config

MAX_SIDE = 3000  # תקרה לגודל התמונה אחרי ההגדלה


def crop_name_region(png_bytes: bytes, box) -> bytes | None:
    """מחזיר PNG של אזור השם, עם מרווח נדיב ובהגדלה. None אם המיקום לא תקין."""
    if not isinstance(box, list) or len(box) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    ymin, ymax = sorted((ymin, ymax))
    xmin, xmax = sorted((xmin, xmax))
    if not (0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000):
        return None

    img = Image.open(io.BytesIO(png_bytes))
    width, height = img.size

    # המרה מ-0-1000 לפיקסלים
    left, right = xmin / 1000 * width, xmax / 1000 * width
    top, bottom = ymin / 1000 * height, ymax / 1000 * height

    # מרווח נדיב: אחוז מגודל המלבן, ולפחות אחוז קטן מהעמוד - כדי לא לחתוך אותיות ולשמור את התווית
    pad_x = max((right - left) * config.NAME_CROP_PADDING, width * config.NAME_CROP_MIN_PADDING)
    pad_y = max((bottom - top) * config.NAME_CROP_PADDING, height * config.NAME_CROP_MIN_PADDING)
    left, right = max(0, left - pad_x), min(width, right + pad_x)
    top, bottom = max(0, top - pad_y), min(height, bottom + pad_y)

    crop = img.crop((int(left), int(top), int(right), int(bottom)))

    # הגדלה
    scale = min(config.NAME_CROP_UPSCALE, MAX_SIDE / max(crop.size))
    if scale > 1:
        crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)

    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()
