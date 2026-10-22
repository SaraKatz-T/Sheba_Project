"""מעדכן את האתר ב-Render לגרסה האחרונה שב-GitHub, בלי להתחבר לאתר של Render.

משתמש בקישור העדכון (Deploy Hook) שבקובץ .env: RENDER_DEPLOY_HOOK=...
Render בונה מחדש מהגרסה האחרונה בענף main, ולכן קודם צריך להעלות את השינויים ל-GitHub (push).

הרצה, מתוך התיקייה server:
    venv\\Scripts\\python.exe run_deploy_render.py
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

try:   # תעודות האבטחה של Windows (למשל מסנן אינטרנט עם תעודה משלו)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

load_dotenv(Path(__file__).resolve().parent / ".env")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    hook = os.getenv("RENDER_DEPLOY_HOOK", "").strip()
    if not hook.startswith("https://api.render.com/deploy/"):
        print("חסר קישור עדכון. בקובץ .env צריך שורה RENDER_DEPLOY_HOOK=https://api.render.com/deploy/...")
        sys.exit(1)
    request = urllib.request.Request(hook, method="POST", headers={"User-Agent": "sheba-forms"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        print(f"Render סירב לבקשה ({e.code}). ייתכן שהקישור הוחלף ב-Render: צריך להעתיק אותו מחדש ל-.env.")
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"אין חיבור ל-Render ({e.reason}). כדאי לנסות שוב בעוד רגע.")
        sys.exit(1)
    deploy_id = ""
    try:
        deploy_id = json.loads(body).get("deploy", {}).get("id", "")
    except (ValueError, AttributeError):
        pass
    print("העדכון התחיל" + (f" ({deploy_id})" if deploy_id else "") +
          ". בעוד כ-2 דקות האתר יעלה בגרסה החדשה. שימו לב: בתוכנית החינמית הנתונים באתר בענן נמחקים בכל עדכון.")


if __name__ == "__main__":
    main()
