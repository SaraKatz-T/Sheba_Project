# חוזה API – לקוח קליטת טפסי התחייבות

המסמך מגדיר את כל הבקשות שהלקוח שולח לשרת הפייתון. הלקוח בנוי לפי המסמך הזה, והשרת המדומה (`src/mocks/`) מממש אותו אחד לאחד. כשהשרת האמיתי יממש את אותן בקשות, משנים בלקוח רק את הכתובת.

ההגדרות המדויקות של המבנים נמצאות גם ב-[`src/api/types.ts`](../src/api/types.ts).

## כללי

- כל הכתובות מתחילות ב-`/api`.
- גוף הבקשות והתשובות ב-JSON בקידוד UTF-8, חוץ מהעלאת קבצים (multipart) ותמונות.
- זמנים בפורמט ISO 8601 עם אזור זמן, למשל `2026-10-20T08:14:03Z`. תאריך בלבד: `2026-10-19`.
- מזהים הם מחרוזות.
- כל הבקשות דורשות עוגיית כניסה, חוץ מ-`POST /api/auth/login` ומבקשות הצילום מהטלפון (`/api/capture/...`).

### שגיאות

כל שגיאה מחזירה קוד HTTP מתאים וגוף בצורה הזו:

```json
{ "error": { "code": "bad_password", "message": "הסיסמה שגויה" } }
```

`message` לא חובה. אם הוא חסר, הלקוח מציג הודעה בעברית לפי קוד ה-HTTP.

| קוד | מתי |
|---|---|
| 400 | בקשה לא תקינה |
| 401 | אין עוגיית כניסה תקפה, או סיסמה שגויה |
| 404 | הטופס או הסשן לא קיימים |
| 409 | הפעולה לא מתאימה למצב הנוכחי (למשל אישור טופס שעדיין בעיבוד), או קובץ כפול |
| 410 | סשן הצילום פג |
| 413 | קובץ גדול מדי |
| 415 | סוג קובץ לא נתמך |
| 429 | יותר מדי ניסיונות כניסה |

## אבטחה – דרישות מהשרת

- **HTTPS בלבד** בסביבה אמיתית.
- **אותו מקור:** עדיף שהשרת יגיש גם את קבצי הלקוח (`dist/`) או שיעמוד מאחורי אותו reverse proxy, כך שאין צורך ב-CORS. בזמן פיתוח, Vite מעביר את `/api` לשרת.
  אם בכל זאת הלקוח והשרת בכתובות שונות: CORS עם כתובת מפורשת (לא `*`), `Access-Control-Allow-Credentials: true`, ועוגייה עם `SameSite=None; Secure`.
- **עוגיית כניסה:** `HttpOnly; Secure; SameSite=Strict; Path=/api`, תוקף של 8 שעות.
- **סיסמה:** נשמרת ב-`.env` של השרת. השוואה בזמן קבוע (`hmac.compare_digest`) והגבלת ניסיונות.
- **בלי מטמון:** כל תשובה עם נתונים אישיים או תמונה נשלחת עם `Cache-Control: no-store`. הלקוח לא שומר נתונים בדפדפן.
- **בדיקת קבצים לפי התוכן** (magic bytes) ולא לפי הסיומת. גודל מרבי מומלץ: 25MB.
- **לא לכתוב ללוג** שמות, מספרי ת"ז, ערכי שדות או תוכן קבצים.

## מבני נתונים

### סטטוס טופס

| ערך | בעברית | הערה |
|---|---|---|
| `received` | התקבל | הקובץ נשמר בשרת |
| `processing` | בעיבוד | החילוץ רץ |
| `pending_review` | ממתין לבדיקה | גם כשאין שדות צהובים, אדם מאשר |
| `approved` | אושר | |
| `failed` | נכשל | `error` מסביר למה |
| `rejected` | נדחה | כולל טופס שמוזג לטופס אחר |

### FormSummary – שורה ברשימה

```json
{
  "id": "f_8c1e",
  "file_name": "סריקה_0012.pdf",
  "file_type": "application/pdf",
  "file_sha256": "9f2c4a…",
  "source": "upload",
  "status": "pending_review",
  "received_at": "2026-10-20T08:14:03Z",
  "updated_at": "2026-10-20T08:14:41Z",
  "reviewed_at": null,
  "person_name": "נועה לוי",
  "id_number": "123456782",
  "form_date": "2026-10-19",
  "page_count": 1,
  "uncertain_count": 2,
  "corrected_count": 0,
  "progress": null,
  "error": null,
  "merged_into": null
}
```

| שדה | הסבר |
|---|---|
| `file_sha256` | טביעת אצבע של הקובץ (hex). הלקוח משתמש בה כדי לא לשלוח אותו קובץ פעמיים |
| `source` | `upload` (גרירה), `phone` (צילום מהטלפון), `demo` (מצב הדגמה) |
| `reviewed_at` | מתי אושר או נדחה. משמש לחישוב זמן טיפול ממוצע |
| `person_name`, `id_number`, `form_date` | ערכים מתוך השדות, לחיפוש ולזיהוי כפילויות. `null` עד סוף החילוץ |
| `uncertain_count` | כמה שדות צהובים עדיין פתוחים |
| `corrected_count` | כמה שדות תוקנו ידנית. 0 באישור = "אושר בלי תיקון" |
| `progress` | רק בזמן `received`/`processing`, לא חובה: `{ "percent": 60, "step": "אימות שני" }` |
| `error` | רק ב-`failed`: הסבר קצר בעברית פשוטה |
| `merged_into` | מזהה הטופס שאליו מוזג הטופס הזה |

### FormDetail – טופס מלא

כל השדות של `FormSummary`, ובנוסף:

```json
{
  "pages": [
    { "number": 1, "width": 1240, "height": 1754, "image_url": "/api/forms/f_8c1e/pages/1/image" }
  ],
  "fields": [ /* Field */ ]
}
```

`fields` מגיע בסדר שבו השדות מופיעים בטופס.

### Field – שדה

```json
{
  "key": "id_number",
  "label": "תעודת זהות",
  "type": "id_number",
  "value": "123456782",
  "confidence": 0.62,
  "uncertain": true,
  "reason_code": "models_disagree",
  "reason": "Gemini קרא 123456782 ו-Qwen קרא 123456732",
  "readings": { "gemini": "123456782", "qwen": "123456732" },
  "box": { "page": 1, "x": 0.12, "y": 0.30, "w": 0.20, "h": 0.04 },
  "corrected": false,
  "original_value": null
}
```

| שדה | הסבר |
|---|---|
| `key` | מזהה קבוע של השדה, באנגלית |
| `label` | שם השדה בעברית, כפי שיוצג |
| `type` | `text`, `id_number`, `date`, `phone`, `number`, `checkbox`, `signature`. משפיע על התצוגה בלבד |
| `confidence` | 0 עד 1. לא חובה |
| `uncertain` | `true` = שדה צהוב |
| `reason_code` | `models_disagree`, `checksum_failed`, `illegible`, `missing`, `low_confidence`, `other` |
| `reason` | משפט קצר בעברית שמוצג ליד השדה הצהוב |
| `readings` | מה כל מודל קרא. הלקוח מציג כפתור בחירה לכל קריאה. לא חובה |
| `box` | איפה השדה כתוב בטופס. לא חובה: בלעדיו מוצגת התמונה המלאה בחלונית מתקפלת |
| `corrected` | `true` אם הערך הנוכחי שונה מהמקורי |
| `original_value` | הערך שהחילוץ החזיר, נשמר בתיקון הראשון. `null` אם לא תוקן |

**קואורדינטות (`box`):** `x`, `y` הם הפינה העליונה השמאלית, ו-`w`, `h` הם הרוחב והגובה. כולם חלק יחסי מגודל העמוד, בין 0 ל-1, כך שלא משנה באיזו רזולוציה התמונה. `page` מתחיל ב-1.

Gemini מחזיר `box_2d` בצורה `[ymin, xmin, ymax, xmax]` בסקאלה 0–1000. ההמרה:

```python
ymin, xmin, ymax, xmax = box_2d
box = {"page": 1, "x": xmin / 1000, "y": ymin / 1000,
       "w": (xmax - xmin) / 1000, "h": (ymax - ymin) / 1000}
```

## בקשות

### כניסה

#### `POST /api/auth/login`

```json
{ "password": "..." }
```

- `204` ועוגיית כניסה (`Set-Cookie`).
- `401` סיסמה שגויה. `429` יותר מדי ניסיונות.

#### `POST /api/auth/logout`

`204`. מוחק את העוגייה.

#### `GET /api/auth/session`

- `200` `{ "authenticated": true }`
- `401` אם אין כניסה בתוקף.

### טפסים

#### `GET /api/forms`

`200` `{ "items": [FormSummary, ...] }`, מהחדש לישן.

החיפוש, הסינון, המדדים, לוח השנה וזיהוי הכפילויות מחושבים בלקוח מתוך הרשימה הזו. בזמן שיש טפסים בקליטה או בעיבוד, הלקוח שולח את הבקשה כל 2 שניות כדי להציג התקדמות.

#### `POST /api/forms`

העלאת קובץ אחד (`multipart/form-data`). הלקוח שולח כל קובץ בבקשה נפרדת, כדי שלכל קובץ יהיה פס התקדמות משלו.

| חלק | חובה | הסבר |
|---|---|---|
| `file` | כן | הקובץ |
| `sha256` | כן | טביעת האצבע שהלקוח חישב |
| `source` | לא | `upload` (ברירת מחדל) או `demo` |
| `force` | לא | `true` = לקלוט גם אם הקובץ כבר קיים |

- `201` `FormSummary` בסטטוס `received`. השרת ממשיך לחילוץ ברקע.
- `409` `{ "error": { "code": "duplicate_file", "existing_id": "f_12ab" } }` אם קובץ זהה כבר קיים ולא נשלח `force`.
- `413`, `415`.

**סוגי קבצים:** PDF, JPEG, PNG, TIFF, HEIC/HEIF, WEBP.

**הנחה (קל לשנות):** כל קובץ הוא טופס אחד. PDF או TIFF של כמה עמודים הוא טופס אחד עם כמה עמודים.

#### `GET /api/forms/{id}`

`200` `FormDetail`. `404` אם לא קיים.

#### `GET /api/forms/{id}/pages/{number}/image`

תמונת העמוד כ-PNG או JPEG. השרת ממיר PDF, TIFF ו-HEIC לתמונה שהדפדפן יכול להציג. `Cache-Control: no-store`.

#### `PATCH /api/forms/{id}/fields/{key}`

תיקון שדה או אישור שלו.

```json
{ "value": "123456782", "source": "gemini" }
```

`source`: `manual` (הוקלד ידנית), `gemini` / `qwen` (נבחרה קריאה של מודל), `confirmed` (הערך הנוכחי נכון).

מה השרת עושה:
1. בתיקון הראשון שומר את הערך הקודם ב-`original_value`.
2. מעדכן את `value`, מסמן `uncertain: false`, ו-`corrected` לפי השוואה ל-`original_value`.
3. מעדכן את `uncertain_count` ו-`corrected_count` של הטופס.

- `200` `Field` המעודכן.
- `409` אם הטופס לא בסטטוס `pending_review`.

#### `POST /api/forms/{id}/approve`

מאשר טופס בסטטוס `pending_review`. שדות צהובים שנשארו פתוחים נחשבים מאושרים כפי שהם. מעדכן את `reviewed_at`.

- `200` `FormSummary`. `409` אם הסטטוס אחר.

#### `POST /api/forms/{id}/reject`

```json
{ "reason": "כפילות" }
```

`reason` לא חובה. `200` `FormSummary`.

#### `POST /api/forms/{id}/retry`

מריץ שוב את החילוץ לטופס בסטטוס `failed`. `200` `FormSummary` בסטטוס `received`.

#### `POST /api/forms/{id}/merge`

ממזג את הטופס `{id}` לתוך טופס אחר עם אותה ת"ז.

```json
{ "into": "f_12ab", "values": { "phone": "050-1234567" } }
```

- `values`: הערכים שהמשתמש בחר עבור טופס היעד. כל אחד נשמר כמו `PATCH` עם `source: "manual"`.
- הטופס `{id}` עובר ל-`rejected` עם `merged_into`.
- `200` `FormSummary` של טופס היעד.

### צילום מהטלפון

הטלפון לא נכנס בסיסמה. במקום זה, המחשב פותח סשן צילום ומציג קוד QR עם אישור חד-פעמי.

#### `POST /api/capture-sessions`

דורש עוגיית כניסה.

`201` `{ "token": "…", "expires_at": "2026-10-20T08:24:03Z" }`

- `token` אקראי, לפחות 128 ביט (`secrets.token_urlsafe(32)`).
- תוקף של 10 דקות. בתוך הזמן הזה אפשר לשלוח כמה צילומים.

#### `GET /api/capture/{token}`

הטלפון בודק שהסשן תקף.

- `200` `{ "expires_at": "…" }`
- `404` לא קיים. `410` פג.

#### `POST /api/capture/{token}/forms`

העלאת צילום מהטלפון (`multipart/form-data`): `file` ו-`sha256`.

- `201` `{ "id": "f_9d2e", "status": "received" }`. בכוונה בלי נתונים אישיים.
- `404`, `410`, `413`, `415`.

הטופס נכנס לאותו תור עם `source: "phone"`, והמחשב רואה אותו ברשימה בבדיקה הבאה.
