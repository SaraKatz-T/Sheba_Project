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
    cropped = crop_name_region_with_box(png_bytes, box)
    return cropped[0] if cropped else None


def crop_name_region_with_box(png_bytes: bytes, box):
    """כמו crop_name_region, ומחזיר גם איפה החיתוך יושב בעמוד: (PNG, [ymin, xmin, ymax, xmax] 0-1000).
    המיקום של החיתוך מאפשר להחזיר לעמוד את המיקום של כל שם שהקריאה המוגדלת מצאה בתוכו."""
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
    pad_y = max((bottom - top) * config.NAME_CROP_PADDING_Y, height * config.NAME_CROP_MIN_PADDING)
    left, right, top, bottom = left - pad_x, right + pad_x, top - pad_y, bottom + pad_y

    # הגדלת החיתוך סביב אותו מרכז (פי NAME_CROP_GROW בכל ממד), כדי שהשם לא ייחתך גם כשהמיקום לא מדויק
    cx, cy = (left + right) / 2, (top + bottom) / 2
    half_w, half_h = (right - left) / 2 * config.NAME_CROP_GROW, (bottom - top) / 2 * config.NAME_CROP_GROW
    left, right = int(max(0, cx - half_w)), int(min(width, cx + half_w))
    top, bottom = int(max(0, cy - half_h)), int(min(height, cy + half_h))

    crop_box = [top / height * 1000, left / width * 1000, bottom / height * 1000, right / width * 1000]
    scale = min(config.NAME_CROP_UPSCALE, MAX_SIDE / max(right - left, bottom - top, 1))
    return _render(img, (left, top, right, bottom), scale), crop_box


def _render(img: Image.Image, pixels, scale: float) -> bytes:
    """חותך את האזור בפיקסלים ומגדיל. משותף לחיתוך שנשלח למודל ולהצגה שלו במסך, כך ששניהם זהים."""
    crop = img.crop(pixels)
    if scale > 1:
        crop = crop.resize((int(crop.width * scale), int(crop.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    crop.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def crop_scale(png_bytes: bytes, crop_box) -> float:
    """פי כמה הוגדל חיתוך באזור הזה (נשמר עם התוצאה, כדי לשחזר אותו בדיוק גם אם ההגדרות ישתנו)."""
    with Image.open(io.BytesIO(png_bytes)) as img:
        width, height = img.size
    ymin, xmin, ymax, xmax = crop_box
    w = round(xmax / 1000 * width) - round(xmin / 1000 * width)
    h = round(ymax / 1000 * height) - round(ymin / 1000 * height)
    return min(config.NAME_CROP_UPSCALE, MAX_SIDE / max(w, h, 1))


def render_name_crop(png_bytes: bytes, crop_box, scale) -> bytes | None:
    """משחזר בדיוק את התמונה שנשלחה למודל בקריאה המוגדלת, מתוך האזור והגודל שנשמרו בזמן הקריאה."""
    try:
        ymin, xmin, ymax, xmax = (float(v) for v in crop_box)
        scale = float(scale)
    except (TypeError, ValueError):
        return None
    img = Image.open(io.BytesIO(png_bytes))
    width, height = img.size
    pixels = (round(xmin / 1000 * width), round(ymin / 1000 * height),
              round(xmax / 1000 * width), round(ymax / 1000 * height))
    if pixels[2] <= pixels[0] or pixels[3] <= pixels[1]:
        return None
    return _render(img, pixels, scale)


def box_on_page(box_in_crop, crop_box):
    """מיקום שהקריאה המוגדלת החזירה (0-1000 יחסית לחיתוך) ← מיקום בעמוד (0-1000). None אם לא תקין."""
    if not isinstance(box_in_crop, list) or len(box_in_crop) != 4 or not isinstance(crop_box, list) or len(crop_box) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = (float(v) for v in box_in_crop)
        c_ymin, c_xmin, c_ymax, c_xmax = (float(v) for v in crop_box)
    except (TypeError, ValueError):
        return None
    ymin, ymax = sorted((ymin, ymax))
    xmin, xmax = sorted((xmin, xmax))
    if not (0 <= ymin < ymax <= 1000 and 0 <= xmin < xmax <= 1000):
        return None
    h, w = c_ymax - c_ymin, c_xmax - c_xmin
    return [round(c_ymin + ymin / 1000 * h), round(c_xmin + xmin / 1000 * w),
            round(c_ymin + ymax / 1000 * h), round(c_xmin + xmax / 1000 * w)]
