"""
הפעלת שרת ה-API.

הרצה ב-PyCharm: לחיצה ימנית על הקובץ ← Run 'run_server'
תיעוד חי ובדיקה ידנית: http://localhost:8000/docs
"""

import uvicorn

from server import settings

if __name__ == "__main__":
    # תהליך אחד בלבד (בלי workers): הגבלת ניסיונות הכניסה ו-WebSocket נשמרים בזיכרון של התהליך
    uvicorn.run("server.app:app", host=settings.SERVER_HOST, port=settings.SERVER_PORT)
