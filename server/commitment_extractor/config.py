"""הגדרות המנוע - זהות להגדרות שנבדקו ב-AI Studio."""

from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")  # טוען את GEMINI_API_KEY מקובץ .env

# --- המודל (כמו ב-AI Studio) ---
MODEL_NAME = "gemini-3.8-flash"
# מודל גיבוי: רק כשהמודל הראשי לא זמין לגמרי - אחרי שכל המפתחות וכל ההמתנות נכשלו, או כשהוא לא קיים.
# None = בלי גיבוי
FALLBACK_MODEL_NAME = "gemini-3.6-flash"
THINKING_LEVEL = "low"          # Thinking level: Low
NAME_THINKING_LEVEL = "high"    # לקריאה המוגדלת של השם בלבד: תמונה קטנה, וחשיבה גבוהה מונעת "השלמה" לשם נפוץ
MEDIA_RESOLUTION = "HIGH"       # Media resolution: High  (LOW / MEDIUM / HIGH)
MAX_OUTPUT_TOKENS = 65536       # כמו בקוד שיוצא מ-AI Studio

# --- קבצים ---
SYSTEM_INSTRUCTION_PATH = PROJECT_ROOT / "prompts" / "system_instruction.md"
RESPONSE_SCHEMA_PATH = PROJECT_ROOT / "schemas" / "extraction_schema.json"
NAME_INSTRUCTION_PATH = PROJECT_ROOT / "prompts" / "name_instruction.md"
NAME_SCHEMA_PATH = PROJECT_ROOT / "schemas" / "name_schema.json"
INPUT_DIR = PROJECT_ROOT / "data" / "input"
READY_DIR = PROJECT_ROOT / "data" / "ready"     # תמונות אחרי עיבוד מקדים, מוכנות לשליחה
OUTPUT_DIR = PROJECT_ROOT / "data" / "output"

# --- עיבוד מקדים (run_preprocess.py) ---
PDF_RENDER_DPI = 200
AUTO_ROTATE = True              # יישור עמודים מסובבים בעזרת Tesseract
MIN_ROTATION_CONFIDENCE = 1.0   # מתחת לזה לא מסובבים (בבדיקה על הדוגמאות, גם ביטחון 1.7 היה נכון)
MAX_IMAGE_SIDE = 2400           # תקרה לצלע הארוכה בפיקסלים; תמונה גדולה יותר מוקטנת

# --- ניסיונות חוזרים כשהשרת עמוס או נחסמים על מכסה (429) ---
MAX_RETRIES = 4
SECONDS_BETWEEN_REQUESTS = 0   # בלי ריווח - שולחים מיד
MAX_WAIT_SAME_KEY = 0          # כשמפתח נחסם - עוברים מיד לבא, בלי לחכות
ROTATE_KEYS_EVERY_REQUEST = True   # כל בקשה נשלחת במפתח הבא בתור

# --- חסימה של NetFree או ניתוק של החיבור: הבקשה לא הגיעה ל-Google, אז מחכים ומנסים שוב ---
NETWORK_RETRIES = 5            # כמה ניסיונות חוזרים לפני שהעמוד נכשל
NETWORK_RETRY_SECONDS = 20     # כמה לחכות בין ניסיון לניסיון

# --- זיהוי שם בהגדלה ---
NAME_ZOOM_ENABLED = True
NAME_CROP_PADDING = 0.5       # מרווח לצדדים: 50% מרוחב המלבן לכל צד
NAME_CROP_PADDING_Y = 1.5     # מרווח למעלה ולמטה: פי 1.5 מגובה המלבן, כי המלבן שמגיע מ-Gemini נמוך וחותך אותיות
NAME_CROP_MIN_PADDING = 0.05  # ולפחות 5% מגודל העמוד לכל כיוון (היה 3%)
NAME_CROP_GROW = 2            # אחרי המרווחים: החיתוך גדל פי 2 בגובה וברוחב, סביב אותו מרכז
NAME_CROP_UPSCALE = 2        # פי כמה להגדיל את החיתוך
SAVE_NAME_CROPS = True        # לשמור את החיתוכים כתמונות, כדי לבדוק בעין שהם נכונים
