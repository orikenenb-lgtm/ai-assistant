# הוראות Rollback — NOA Personal Bridge

## נקודת המוצא
- `main` לפני תחילת העבודה: `c4ce0d7a78c25982f69099d75093d60efa46fbff` ("Merge pull request #10").
- כל העבודה נמצאת בענף נפרד. **שום קובץ קיים לא שונה** — נוספו רק:
  - `noa-personal-bridge/` (אפליקציית Android ושירות הגשר)
  - `docs/noa-personal-bridge/` (תיעוד)
  - `.github/workflows/noa-personal-bridge.yml` (CI נפרד, ללא פריסה)

אפשר לוודא זאת בכל רגע:

```bash
git diff --stat c4ce0d7 -- . ':!noa-personal-bridge' ':!docs/noa-personal-bridge' ':!.github/workflows/noa-personal-bridge.yml'
```

פלט ריק = אף קובץ קיים לא נגע.

## שכבה 1 — כיבוי מיידי בטלפון (שניות)
1. באפליקציה: מסך הבית ← **עצירת חירום**. כל הטיימרים נעצרים, כל הטיוטות פגות, השליחה נחסמת.
2. או: הגדרות Android ← התראות ← גישה להתראות ← לכבות את **NOA Personal Bridge**. מרגע זה האפליקציה לא רואה אף התראה.
3. הסרה מלאה: להסיר את האפליקציה. כל המידע המקומי (טוקן, החרגות, הגדרות) נמחק איתה; מפתח ההצפנה ב־Keystore נמחק גם הוא.

## שכבה 2 — כיבוי השרת (דקה)
1. להגדיר `BRIDGE_ENABLED=false` ולהפעיל מחדש — כל הבקשות מקבלות `503`. `/health` ממשיך לענות.
2. או פשוט לעצור את התהליך. אף רכיב אחר במערכת לא תלוי בשירות הזה.
3. ביטול מכשיר ספציפי: `python -m bridge_service.admin revoke-device <device_id>`.

## שכבה 3 — נועה הקיימת
**אין מה לשחזר.** הגשר לא משנה את מנוע נועה, לא את הסוכנים שלה, לא את המספר שלה ולא את WhatsApp האישי.
אם הוגדר לגשר מפתח API של מנוע נועה (לשימוש ב־`/prompt` לקריאה בלבד) — אפשר לסובב (Rotate) את המפתח הזה בצד נועה, וזה ינתק את הגשר בלי להשפיע על שום תכונה אחרת.

## שכבה 4 — Git
- הענף לא מוזג ל־`main`. כדי לוותר עליו לגמרי מספיק לא למזג אותו / לסגור את ה־PR.
- אם בעתיד הענף ימוזג ותרצו להחזיר: `git revert -m 1 <merge-commit>` — אין צורך ב־reset או force push.
- ה־Workflow החדש רץ רק על שינויים בתוך `noa-personal-bridge/`. מחיקת הקובץ `.github/workflows/noa-personal-bridge.yml` מבטלת אותו בלי להשפיע על `ci.yml` או `smart-crm.yml`.
