"""הגדרות המנוע - זהות להגדרות שנבדקו ב-AI Studio."""

from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")  # טוען את GEMINI_API_KEY מקובץ .env

# --- המודל (כמו ב-AI Studio) ---
MODEL_NAME = "gemini-3.8-flash"
THINKING_LEVEL = "low"          # Thinking level: Low
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

# --- זיהוי שם בהגדלה ---
NAME_ZOOM_ENABLED = True
NAME_CROP_PADDING = 0.5       # מרווח סביב אזור השם: 50% מגודל המלבן לכל כיוון
NAME_CROP_MIN_PADDING = 0.03  # ולפחות 3% מגודל העמוד
NAME_CROP_UPSCALE = 2         # פי כמה להגדיל את החיתוך
SAVE_NAME_CROPS = True        # לשמור את החיתוכים כתמונות, כדי לבדוק בעין שהם נכונים
