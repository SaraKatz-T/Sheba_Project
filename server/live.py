"""החיבורים הפתוחים של WebSocket /api/live, ושליחת הודעות לכולם.

לכל חיבור יש תור הודעות משלו, כך שמסך איטי לא מעכב את השאר.
publish ו-close_session בטוחות לקריאה מכל חוט (בקשות, עובדים): הן מעבירות את העבודה ללולאת השרת.
"""

import asyncio
import json
import logging

from fastapi import WebSocket
from starlette.concurrency import run_in_threadpool

from . import settings
from .auth import session_expiry

log = logging.getLogger("server.live")

MAX_QUEUE = 1000           # חיבור שלא מצליח לקבל 1000 הודעות ברצף נחשב תקוע ומנותק
CLOSE_UNAUTHORIZED = 4401  # החוזה: הכניסה פגה או אחרי יציאה. הלקוח עובר למסך הכניסה
_CLOSE = object()          # סימן בתור: לסגור את החיבור עם 4401

_loop: asyncio.AbstractEventLoop | None = None
_clients: set["_Client"] = set()


class _Client:
    def __init__(self, ws: WebSocket, token: str, token_hash: str):
        self.ws = ws
        self.token = token
        self.token_hash = token_hash
        self.queue: asyncio.Queue = asyncio.Queue(MAX_QUEUE)


def bind_loop(loop: asyncio.AbstractEventLoop | None):
    """נקרא בהפעלת השרת: הלולאה שאליה מועברות ההודעות מכל החוטים."""
    global _loop
    _loop = loop


def has_clients() -> bool:
    return bool(_clients)


def publish(message: dict):
    """שולח הודעה לכל המחוברים (אין משתמשים נפרדים: כולם רואים הכל)."""
    if _loop is None or not _clients:
        return
    text = json.dumps(message, ensure_ascii=False)
    _loop.call_soon_threadsafe(_fanout, text)


def _fanout(text: str):
    for client in list(_clients):
        try:
            client.queue.put_nowait(text)
        except asyncio.QueueFull:
            _clients.discard(client)
            asyncio.ensure_future(client.ws.close(code=1013))   # 1013: נסו שוב מאוחר יותר


def close_session(token_hash: str):
    """אחרי יציאה: סוגרים עם 4401 את כל החיבורים של הסשן."""
    if _loop is not None:
        _loop.call_soon_threadsafe(_close_matching, token_hash)


def _close_matching(token_hash: str):
    for client in list(_clients):
        if client.token_hash == token_hash:
            _force_close(client)


def _force_close(client: _Client):
    try:
        client.queue.put_nowait(_CLOSE)
    except asyncio.QueueFull:
        asyncio.ensure_future(client.ws.close(code=CLOSE_UNAUTHORIZED))


async def _send_loop(client: _Client):
    while True:
        item = await client.queue.get()
        if item is _CLOSE:
            await client.ws.close(code=CLOSE_UNAUTHORIZED)
            return
        await client.ws.send_text(item)


async def _receive_loop(client: _Client):
    # הלקוח לא שולח כלום; קוראים רק כדי לזהות שהחיבור נסגר
    while True:
        message = await client.ws.receive()
        if message["type"] == "websocket.disconnect":
            return


async def _session_check(client: _Client):
    while True:
        await asyncio.sleep(settings.LIVE_SESSION_CHECK_SECONDS)
        if await run_in_threadpool(session_expiry, client.token) is None:
            _force_close(client)   # הכניסה פגה (8 שעות)
            return


async def serve(ws: WebSocket, token: str, token_hash: str):
    """מחזיק חיבור פתוח עד שהוא נסגר: מצד הלקוח, ביציאה, או כשהכניסה פגה."""
    client = _Client(ws, token, token_hash)
    _clients.add(client)
    log.info("חיבור חי נפתח (%d מחוברים)", len(_clients))
    tasks = {asyncio.create_task(_send_loop(client)), asyncio.create_task(_receive_loop(client)),
             asyncio.create_task(_session_check(client))}
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in done:
            task.exception()   # שגיאת שליחה לחיבור שנסגר: לא מעניין, רק לא להשאיר אותה תלויה
    finally:
        _clients.discard(client)
        log.info("חיבור חי נסגר (%d מחוברים)", len(_clients))
