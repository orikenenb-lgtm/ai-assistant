# Claudex Loop — התקנה והפעלה אוטומטית

[Claudex Loop](https://github.com/chaseai-yt/claudex-loop) הוא תוסף ל-Claude Code:
Claude מתכנן, Codex בודק את התוכנית, הבנייה מתבצעת, ו-Codex בודק את הקוד הסופי.

הכלל שקובע מתי להפעיל אותו נמצא ב-`claudex-rule.md`.
בפרויקטים גדולים Claude מפעיל אותו לבד, ואם משהו חסר — מציע בשורה אחת מה להתקין.

## מה כבר מוגדר ב-repo הזה

- `.claude/settings.json` — Claude Code מציע להתקין את התוסף כשפותחים את ה-repo
- `CLAUDE.md` — טוען את הכלל, כך שהוא פעיל בכל שיחה בפרויקט הזה

## התקנה לכל הפרויקטים במחשב

הסקריפט מתקין את התוסף ברמת המשתמש, ומוסיף את הכלל ל-`CLAUDE.md` הגלובלי.
אפשר להריץ אותו שוב בבטחה: הבלוק הקודם מוחלף, וגיבוי נשמר בשם `CLAUDE.md.bak-claudex`.

ב-Windows, מתוך תיקיית ה-repo:

```powershell
powershell -ExecutionPolicy Bypass -File tools\claudex-loop\install.ps1
```

ב-Mac או Linux:

```bash
bash tools/claudex-loop/install.sh
```

## Codex — חובה ללולאה המלאה

```bash
npm install -g @openai/codex
codex login
```

בדיקה שהכל מחובר (אפשר גם לבקש מ-Claude להריץ):

```bash
codex --version
codex login status
claude --version
claude auth status
python --version
```

## שימוש ידני

```text
/claudex-loop:claudex-loop
claudex this feature - plan and implement it
claudex this plan, mode=review, plan=PLAN.md, rounds=3
```

כדי לדלג על הלולאה במשימה מסוימת, פשוט כותבים "בלי claudex".

## סשנים בענן (claude.ai/code)

כל סשן בענן מתחיל ממכונה נקייה, ולכן אין בה Codex מחובר.
התוסף והכלל נטענים מה-repo, אבל בלי Codex Claude רק יציע את הלולאה ויעבוד כרגיל.
את הלולאה המלאה מריצים ב-Claude Code במחשב, שבו Codex מחובר.
