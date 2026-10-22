"""הגשת הלקוח (dist/ של sheba-forms) מאותה כתובת של ה-API, אחרי האיחוד.

כך הדפדפן רואה כתובת אחת: העוגייה עובדת בלי CORS, ובדיקת ה-Origin של ה-WebSocket פשוטה.
כל נתיב שאינו /api/... ואינו קובץ קיים (למשל /capture/abc מקוד ה-QR, או /records?open=f_12)
מחזיר את index.html, והלקוח מציג את המסך הנכון בעצמו. בלי זה הקישור מהטלפון ייתן 404.
"""

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from .errors import ApiError

log = logging.getLogger("server")


def install(app: FastAPI, dist: Path):
    dist = dist.resolve()
    index = dist / "index.html"
    if not index.is_file():
        log.warning("CLIENT_DIST מוגדר, אבל אין בו index.html (%s). צריך להריץ npm run build בלקוח", dist)
        return

    # HEAD: בדיקות "האם האתר חי" של שירות הענן ושל ניטור חיצוני שולחות HEAD, לא GET
    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def client(path: str):
        if path == "api" or path.startswith("api/"):
            raise ApiError(404)   # בקשת API שלא קיימת: JSON כמו בחוזה, ולא index.html
        target = (dist / path).resolve()
        if path and target.is_file() and target.is_relative_to(dist):   # בלי יציאה מהתיקייה (../)
            return FileResponse(target)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    log.info("הלקוח מוגש מ-%s", dist)
