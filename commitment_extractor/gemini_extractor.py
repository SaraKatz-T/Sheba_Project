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
        print(f"נטענו {len(self.clients)} מפתחות Gemini")

        self.system_instruction = config.SYSTEM_INSTRUCTION_PATH.read_text(encoding="utf-8")
        self.response_schema = json.loads(config.RESPONSE_SCHEMA_PATH.read_text(encoding="utf-8"))
        self.generation_config = types.GenerateContentConfig(
            system_instruction=self.system_instruction,
            max_output_tokens=config.MAX_OUTPUT_TOKENS,
            response_mime_type="application/json",
            response_json_schema=self.response_schema,
            thinking_config=types.ThinkingConfig(thinking_level=config.THINKING_LEVEL),
            media_resolution=getattr(types.MediaResolution, f"MEDIA_RESOLUTION_{config.MEDIA_RESOLUTION}"),
        )

    def _switch_key(self):
        self.current = (self.current + 1) % len(self.clients)
        print(f"\n  ↻ עוברים למפתח מספר {self.current + 1}", end=" ", flush=True)

    def extract_page(self, png_bytes: bytes) -> dict:
        """מחזיר את ה-JSON שהמודל החזיר עבור העמוד, כמילון פייתון."""
        image_part = types.Part.from_bytes(data=png_bytes, mime_type="image/png")
        for round_no in range(config.MAX_RETRIES + 1):
            # סבב על כל המפתחות, החל מהמפתח הנוכחי
            for _ in range(len(self.clients)):
                try:
                    response = self.clients[self.current].models.generate_content(
                        model=config.MODEL_NAME,
                        contents=[image_part],
                        config=self.generation_config,
                    )
                    return json.loads(response.text)
                except json.JSONDecodeError:
                    raise
                except Exception as e:
                    if _is_quota_error(e):
                        self._switch_key()      # המפתח הזה נחסם - מנסים את הבא
                        continue
                    if _is_temporary_error(e):
                        break                   # עומס זמני בשרת - מחכים ומנסים שוב
                    raise                       # שגיאה אחרת (מפתח שגוי וכד') - עוצרים
            if round_no < config.MAX_RETRIES:
                wait = 15 * 2 ** round_no       # כל המפתחות חסומים כרגע - מחכים
                print(f"\n  ⏳ כל המפתחות חסומים כרגע, ממתינים {wait} שניות", end=" ", flush=True)
                time.sleep(wait)
        raise RuntimeError("כל המפתחות נחסמו על מכסה גם אחרי המתנה. כנראה שהמכסה היומית נגמרה.")
