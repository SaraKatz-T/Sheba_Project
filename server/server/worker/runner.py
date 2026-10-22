"""הפעלה ועצירה של העובדים בתוך תהליך השרת, והתאוששות אחרי כיבוי באמצע."""

import logging
import threading

from .. import crypto, db, settings, trash
from ..times import iso, utcnow
from . import cleanup, is_paused, reader, resume_if_due, splitter, wait_for_work, wake

log = logging.getLogger("server.worker")

IDLE_SECONDS = 2   # כמה זמן עובד ממתין כשאין עבודה, לפני שהוא בודק שוב (wake() מעיר אותו מיד)

_stop = threading.Event()
_threads: list[threading.Thread] = []


def recover():
    """אחרי כיבוי באמצע: מה שהיה בעבודה חוזר לתור. מה שהסתיים נשאר כמו שהוא."""
    now = iso(utcnow())
    with db.connect() as conn:
        uploads = conn.execute("UPDATE uploads SET status = 'queued', updated_at = ? WHERE status = 'splitting'",
                               (now,)).rowcount
        forms = conn.execute("UPDATE forms SET status = 'received', progress = NULL, updated_at = ? "
                             "WHERE status = 'processing'", (now,)).rowcount
        conn.execute("UPDATE forms SET progress = NULL WHERE status = 'received'")   # הודעות עצירה מהרצה קודמת
    if uploads or forms:
        log.info("התאוששות: %d קבצים ו-%d שורות חזרו לתור", uploads, forms)


def _split_loop():
    while not _stop.is_set():
        try:
            upload_id = splitter.claim_upload()
            if upload_id:
                splitter.split_upload(upload_id)
                continue
        except Exception as e:
            log.error("עובד הפיצול: שגיאה לא צפויה (%s)", type(e).__name__)
        wait_for_work(IDLE_SECONDS)


def _read_loop(number: int):
    try:
        extractor = reader.make_extractor()
    except Exception as e:   # למשל: אין מפתחות Gemini ב-.env
        log.error("עובד קריאה %d לא הופעל: %s", number, e)
        return
    while not _stop.is_set():
        try:
            if resume_if_due():
                reader.clear_pause_message()
            if not is_paused():
                claimed = reader.claim_page()
                if claimed:
                    reader.read_page(extractor, *claimed)
                    continue
        except Exception as e:
            log.error("עובד קריאה %d: שגיאה לא צפויה (%s)", number, type(e).__name__)
        wait_for_work(IDLE_SECONDS)


def _cleanup_loop():
    while not _stop.is_set():
        try:
            cleanup.delete_old_images()
            cleanup.delete_old_thumbnails()
            trash.purge()
            crypto.sweep_file_keys()   # המפתחות של הקבצים שנמחקו: בלעדיהם שאריות בדיסק לא ניתנות לפענוח
        except Exception as e:
            log.error("מחיקת תמונות: שגיאה לא צפויה (%s)", type(e).__name__)
        _stop.wait(settings.CLEANUP_INTERVAL_SECONDS)


def start():
    recover()
    _stop.clear()
    _threads.clear()
    _threads.append(threading.Thread(target=_split_loop, name="splitter", daemon=True))
    _threads.append(threading.Thread(target=_cleanup_loop, name="cleanup", daemon=True))
    for n in range(1, settings.READ_WORKERS + 1):
        _threads.append(threading.Thread(target=_read_loop, args=(n,), name=f"reader-{n}", daemon=True))
    for thread in _threads:
        thread.start()
    log.info("העובדים הופעלו: פיצול 1, קריאה %d", settings.READ_WORKERS)


def stop(timeout: float = 5):
    """עצירה מסודרת. עובד שבאמצע קריאה ל-Gemini לא מחכים לו: בהפעלה הבאה העמוד חוזר לתור."""
    _stop.set()
    wake()
    for thread in _threads:
        thread.join(timeout / max(len(_threads), 1))
