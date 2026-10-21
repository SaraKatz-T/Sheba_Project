"""שליחת עמוד אחד ל-Gemini עם אותן הגדרות כמו ב-AI Studio, וקבלת JSON לפי הסכימה.

תומך בכמה מפתחות: כשמפתח נחסם על מכסה (שגיאה 429), עוברים אוטומטית למפתח הבא.
"""

import json
import os
import re
import time

# שימוש באישורי האבטחה של Windows במקום אלה של פייתון.
# נדרש כשיש במחשב סינון אינטרנט / אנטי-וירוס שבודק תעבורה מוצפנת.
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from google import genai
from google.genai import types

from . import config


def load_api_keys() -> list[str]:
    """קורא מ-.env את GEMINI_API_KEY, GEMINI_API_KEY1, GEMINI_API_KEY2, ... לפי הסדר."""
    numbered = sorted(
        (int(m.group(1) or 0), value.strip())
        for name, value in os.environ.items()
        if (m := re.fullmatch(r"GEMINI_API_KEY(\d*)", name)) and value.strip()
    )
    keys = []
    for _, value in numbered:
        if value not in keys:
            keys.append(value)
    return keys


def _is_quota_error(e: Exception) -> bool:
    text = str(e)
    return "429" in text or "RESOURCE_EXHAUSTED" in text


def _is_daily_quota(e: Exception) -> bool:
    """מכסה יומית נגמרה (ולא רק מגבלת בקשות לדקה)."""
    return "PerDay" in str(e)


def _retry_delay(e: Exception):
    """כמה שניות Google מבקשת לחכות, אם כתוב בשגיאה."""
    m = re.search(r"retry in ([\d.]+)\s*s", str(e), re.I) or re.search(r"retryDelay\W+([\d.]+)s", str(e))
    return float(m.group(1)) if m else None


def _is_temporary_error(e: Exception) -> bool:
    text = str(e)
    return "500" in text or "503" in text or "UNAVAILABLE" in text


class GeminiExtractor:
    def __init__(self):
        keys = load_api_keys()
        if not keys:
            raise RuntimeError("לא נמצא אף מפתח. בקובץ .env צריך שורה כמו GEMINI_API_KEY1=...")
        self.clients = [genai.Client(api_key=k) for k in keys]
        self.current = 0
        self.last_request_time = 0.0
        print(f"נטענו {len(self.clients)} מפתחות Gemini")

        # שתי משימות: חילוץ עמוד מלא, וזיהוי שם מתוך חיתוך מוגדל
        self.task_configs = {
            "page": self._make_config(config.SYSTEM_INSTRUCTION_PATH, config.RESPONSE_SCHEMA_PATH),
            "name": self._make_config(config.NAME_INSTRUCTION_PATH, config.NAME_SCHEMA_PATH),
        }

    @staticmethod
    def _make_config(instruction_path, schema_path):
        return types.GenerateContentConfig(
            system_instruction=instruction_path.read_text(encoding="utf-8"),
            max_output_tokens=config.MAX_OUTPUT_TOKENS,
            response_mime_type="application/json",
            response_json_schema=json.loads(schema_path.read_text(encoding="utf-8")),
            thinking_config=types.ThinkingConfig(thinking_level=config.THINKING_LEVEL),
            media_resolution=getattr(types.MediaResolution, f"MEDIA_RESOLUTION_{config.MEDIA_RESOLUTION}"),
        )

    def _switch_key(self):
        self.current = (self.current + 1) % len(self.clients)
        print(f"\n  ↻ עוברים למפתח מספר {self.current + 1}", end=" ", flush=True)

    def _pace(self):
        """ריווח בין בקשות, כדי לא לחרוג ממגבלת הבקשות לדקה."""
        wait = config.SECONDS_BETWEEN_REQUESTS - (time.time() - self.last_request_time)
        if wait > 0:
            time.sleep(wait)
        self.last_request_time = time.time()

    def _try_current_key(self, image_part, generation_config):
        """מנסה את המפתח הנוכחי. מחזיר (תוצאה, "ok") או (None, "quota"/"temporary")."""
        for attempt in range(3):
            self._pace()
            try:
                response = self.clients[self.current].models.generate_content(
                    model=config.MODEL_NAME,
                    contents=[image_part],
                    config=generation_config,
                )
                return json.loads(response.text), "ok"
            except json.JSONDecodeError:
                raise
            except Exception as e:
                if _is_quota_error(e):
                    delay = _retry_delay(e)
                    # מגבלה לדקה עם המתנה קצרה - מחכים על אותו מפתח במקום להחליף
                    if (not _is_daily_quota(e) and delay is not None
                            and delay <= config.MAX_WAIT_SAME_KEY and attempt < 2):
                        print(f"\n  ⏳ מגבלת בקשות לדקה, ממתינים {delay:.0f} שניות", end=" ", flush=True)
                        time.sleep(delay + 1)
                        continue
                    return None, "quota"
                if _is_temporary_error(e):
                    return None, "temporary"
                raise  # שגיאה אחרת (מפתח שגוי וכד') - עוצרים
        return None, "quota"

    def extract_page(self, png_bytes: bytes, task: str = "page") -> dict:
        """מחזיר את ה-JSON שהמודל החזיר, כמילון פייתון.
        task="page" - חילוץ כל השדות מעמוד מלא; task="name" - זיהוי שם מחיתוך מוגדל."""
        image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
        generation_config = self.task_configs[task]
        # סבב בין המפתחות: כל בקשה במפתח אחר, כדי לחלק את העומס
        if config.ROTATE_KEYS_EVERY_REQUEST and len(self.clients) > 1:
            self.current = (self.current + 1) % len(self.clients)
        for round_no in range(config.MAX_RETRIES + 1):
            for _ in range(len(self.clients)):
                result, status = self._try_current_key(image_part, generation_config)
                if status == "ok":
                    return result
                if status == "temporary":
                    break             # עומס זמני בשרת - מחכים ומנסים שוב
                self._switch_key()    # המכסה של המפתח הזה נגמרה - עוברים לבא
            if round_no < config.MAX_RETRIES:
                wait = 15 * 2 ** round_no
                print(f"\n  ⏳ ממתינים {wait} שניות ומנסים שוב", end=" ", flush=True)
                time.sleep(wait)
        raise RuntimeError("כל המפתחות נחסמו על מכסה גם אחרי המתנה. כנראה שהמכסה היומית נגמרה.")
