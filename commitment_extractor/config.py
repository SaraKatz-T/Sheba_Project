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
INPUT_DIR = PROJECT_ROOT / "data" / "input"
OUTPUT_DIR = PROJECT_ROOT / "data" / "output"

# --- המרת PDF לתמונות ---
PDF_RENDER_DPI = 200

# --- ניסיונות חוזרים כשהשרת עמוס או נחסמים על מכסה (429) ---
MAX_RETRIES = 4
