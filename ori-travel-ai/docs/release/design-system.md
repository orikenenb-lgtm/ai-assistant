# מערכת העיצוב — Ori Travel AI (V6)

> בעלים: UX-DS (תפקידי V6 06 + 07). קוד: `apps/web/src/styles/index.css` (טוקנים), `apps/web/src/components/ui/**` (רכיבים),
> `apps/web/src/components/layout/**` (מעטפת + ערכת צבעים). חוזה מחייב: `docs/architecture/v6-flight-experience-contract.md` §5.

## 1. עקרונות

1. **כלי השוואה מהיר, בהיר ושקט** — רקע כמעט-לבן ניטרלי, משטחים לבנים, קווי 1px חדים, צללים רכים מאוד. לא "דשבורד יוקרה כהה".
2. **צבע אחד לפעולה** — טורקיז-ים (`accent`, סולם `sea`) לכפתור הראשי, קישורים, ניווט פעיל ופוקוס. אין צבע פעולה נוסף.
3. **צבע מחיר ≠ צבע ממשק** — כתום-מנדרינה (`deal`, סולם `tangerine`) שמור **רק** להצעה המומלצת/הזולה ביותר; תכלת (`low`, סולם `sky`) למחירים נמוכים.
   כך שהעין מזהה מחיר טוב בלי להתבלבל עם כפתורים. שלוש הגוונים (טורקיז / כתום / תכלת) רחוקים זה מזה בגוון.
4. **כנות קודמת לעיצוב** — תג DEMO (קו מקווקו חול) תמיד גלוי, רגוע ולא מבהיל; צבע לעולם אינו הסימן היחיד (טקסט/אייקון/סמן תמיד מלווים).
5. **מספרים מיושרים** — מחירים, משכים וכמויות בספרות טבלאיות (`tabular-nums` / `price-nums`; כל `<table>` מקבל זאת אוטומטית).
6. **נגיש כברירת מחדל** — AA בשתי הערכות, טבעת פוקוס ≥ 3:1, מטרות מגע ≥ 44px במסכי מגע, כבוד ל-`prefers-reduced-motion`, RTL מלא.
7. **רזה** — ללא תלויות חדשות; Tailwind v4 + Radix בלבד.

### למה טורקיז ולא כחול?
- **הפרדת משמעות**: כחול/תכלת מסמן במסך הטיסות "מחיר נמוך". כפתור ראשי כחול היה מתחרה בתאי לוח המחירים ומטשטש את המסר.
- **המשכיות מותג**: גלי הלוגו טורקיז; המשתמשים כבר מכירים את הצבע.
- **רוגע ואמון**: טורקיז עמוק (`sea-600`, 6.0:1 מול לבן) נקרא שקט ומקצועי, ועובד היטב גם בערכה הכהה (`#5ec5b6`).

## 2. ערכות צבעים (בהירה / כהה)

- ברירת המחדל: **לפי הגדרות המכשיר** (`prefers-color-scheme`). המשתמש יכול לבחור "בהירה" / "כהה" / "לפי הגדרות המכשיר" בתפריט המשתמש (סרגל עליון → שם המשתמש → "ערכת צבעים").
- הבחירה נשמרת ב-`localStorage` (מפתח `ori.theme`, עטוף ב-try/catch — אם האחסון חסום, האפליקציה פשוט עוקבת אחרי המערכת). "לפי הגדרות המכשיר" מוחק את המפתח.
- המימוש: `components/layout/theme.ts` (נטען ב-`RootLayout` לפני הרינדור הראשון) כותב `<html data-theme="light|dark">`, `color-scheme`, ומעדכן את `<meta name="theme-color">`.
  מאזין לשינוי הגדרת המערכת ולשינוי בלשונית אחרת (`storage`).
- API: `useTheme()` → `{ preference, resolved, setPreference }`; `setThemePreference(p)`; `resolveTheme(p)`.
- ב-CSS: `:root[data-theme='dark']` מגדיר מחדש את **כל סולמות הצבע**. הסולמות "משתקפים" (50 ↔ 950) כך שכל מחלקה שומרת על **התפקיד** שלה:
  `bg-X-50` = רקע עדין, `text-X-700` = טקסט עליו, `bg-X-600 text-white` = מילוי מלא. `white` הופך למשטח הכהה (`#151c27`), ולכן
  `bg-sea-600 text-white` הופך אוטומטית לטורקיז בהיר עם טקסט כהה — קריא בשתי הערכות. **כל קוד הפיצ'רים הקיים עובד בכהה בלי שינוי.**
- וריאנט Tailwind `dark:` עוקב אחרי הערכה שנבחרה בפועל (לא רק אחרי ה-media query).
- **"אי כהה"** (`.surface-dark` + `.bg-horizon`): כרטיס מותג בצבע טורקיז עמוק שנראה זהה בשתי הערכות (משמש בכרטיס "שאלו את העוזר" בלוח הבקרה). `.surface-dark` מקבע את
  `white`, `ink-200/300`, `sea-300`, `sun-300/400` ו-`focus` לערכים הבהירים שלהם בתוך האי. יחסים: לבן 9.4:1, `ink-200` 6.7:1, `sea-300` 5.9:1, `sun-400` 5.7:1 (על `#0f4f49`).
- לפני שה-JS רץ (פריים ראשון בלבד), משתמשי מצב כהה מקבלים רקע כהה דרך `@media (prefers-color-scheme: dark) :root:not([data-theme])` — בלי הבהוב לבן.
- צללים: Tailwind v4 מטמיע את ערכי הצל בזמן הבנייה, לכן בערכה הכהה הצללים כמעט שקופים — ההפרדה נעשית ע"י קווים (`border-line`) ושכבות משטח. זה מכוון.

## 3. טוקנים

כל הצבעים הם משתני CSS (`@theme static` — כולם נפלטים תמיד, כך שגם `var(--color-…)` בתוך SVG/סגנון inline עובד). פלטת ברירת המחדל של Tailwind מאופסת.

### 3.1 טוקנים סמנטיים (העדיפו אותם בקוד פיצ'רים)

| טוקן | מחלקה לדוגמה | בהירה | כהה | שימוש |
|---|---|---|---|---|
| `canvas` | `bg-canvas` | `#f6f7f9` | `#0e141d` | רקע הדף |
| `surface` | `bg-surface` | `#ffffff` | `#151c27` | כרטיסים, סרגל צד, סרגל עליון, דיאלוגים |
| `surface-sunken` | `bg-surface-sunken` | `#f1f3f6` | `#111721` | בארות, כותרות טבלה, מסילת Segmented/Tabs |
| `surface-hover` | `hover:bg-surface-hover` | `#f3f5f8` | `#1b2331` | ריחוף על שורה/פריט ניווט/כפתור ghost |
| `line` | `border-line` | `#e3e7ed` | `#273142` | קווים דקים בין משטחים (דקורטיבי) |
| `line-strong` | `border-line-strong` | `#cdd5e0` | `#364257` | מפרידים מודגשים, כפתור secondary |
| `control` | `border-control` | `#7c8ba3` | `#6d7b93` | גבול שדות קלט (≥ 3:1) |
| `fg` | `text-fg` | `#142339` | `#eef1f5` | טקסט ראשי |
| `fg-muted` | `text-fg-muted` | `#45556f` | `#a9b3c4` | טקסט משני |
| `fg-subtle` | `text-fg-subtle` | `#5b6b86` | `#8f9bb0` | רמזים, חותמות זמן (עדיין AA) |
| `accent` | `bg-accent` / `text-accent` | `#156f66` | `#5ec5b6` | כפתור ראשי, קישורים, מחוון פעיל |
| `accent-hover` | `hover:bg-accent-hover` | `#125a53` | `#88d7cb` | ריחוף על accent |
| `accent-soft` | `bg-accent-soft` | `#edf8f6` | `#0f2a29` | פריט ניווט פעיל, כפתור tonal, צ'יפ אייקון |
| `accent-strong` | `text-accent-strong` | `#125a53` | `#88d7cb` | טקסט בגוון accent על `accent-soft` |
| `accent-line` | `border-accent-line` | `#a6ded5` | `#1b514b` | מסגרת לאלמנטים בגוון accent |
| `accent-fg` | `text-accent-fg` | `#ffffff` | `#151c27` | טקסט על `bg-accent` |
| `focus` | `outline-focus` | `#1f897d` | `#3faf9f` | טבעת פוקוס (2px, offset 2px) |
| `scrim` | `bg-scrim/45` | `#0b1220` | `#000000` | שכבת רקע לדיאלוג/מגירה |
| `deal` | `text-deal` | `#a8480b` | `#f6b07c` | מחיר/טקסט של ההצעה המומלצת |
| `deal-strong` | `bg-deal-strong` | `#b9520c` | `#f2a066` | מילוי מלא (כפתור `variant="deal"`, פס הדגשה) |
| `deal-soft` | `bg-deal-soft` | `#fff6ef` | `#2c1b0f` | רקע פאנל ההצעה המומלצת |
| `deal-line` | `border-deal-line` | `#ffc9a1` | `#6c3e1b` | מסגרת פאנל ההצעה המומלצת |
| `low` | `text-low` | `#14628a` | `#90d0f2` | מחיר נמוך (טקסט) |
| `low-soft` | `bg-low-soft` | `#effaff` | `#0e2331` | רקע עדין למחיר נמוך |
| `low-line` | `border-low-line` | `#a9dcf3` | `#18496b` | מסגרת למחיר נמוך |
| `heat-best` | `bg-heat-best` | `#ffb27a` | `#8a4613` | תא לוח מחירים: הזול ביותר (+ סמן ★ חובה) |
| `heat-low` | `bg-heat-low` | `#cfeefb` | `#123e57` | שליש תחתון |
| `heat-mid` | `bg-heat-mid` | `#fdeaa8` | `#40381a` | שליש אמצעי |
| `heat-high` | `bg-heat-high` | `#ffd2b0` | `#4a2d1c` | שליש עליון |
| `heat-none` | `bg-heat-none` | `#f3f5f8` | `#1b2331` | נבדק — אין טיסות (`∅`) |
| `heat-unknown` | `bg-heat-unknown` | `#ffffff` | `#151c27` | לא נבדק (`—`); חייב `border-line` כי זהה למשטח |
| `success` / `-soft` / `-line` | `text-success` | moss 700/50/200 | משתקף | הצלחה / חי |
| `info` / `-soft` / `-line` | `text-info` | harbor 700/50/200 | משתקף | מידע / מטמון |
| `warn` / `-soft` / `-line` | `text-warn` | amber 700/50/200 | משתקף | אזהרה / חלקי |
| `danger` / `-soft` / `-line` | `text-danger` | coral 700/50/200 | משתקף | שגיאה / נכשל |

> שמות `tangerine-*`, `sky-*`, `deal*`, `heat-*` הם חלק מהחוזה — אין לשנות שמות; שינוי ערך רק עם בדיקת ניגודיות ועדכון הטבלה למטה.
> ב-V6 נוספו (תוספת בלבד): `surface-hover`, `accent-soft/strong/line/fg`, `scrim`, `low*`, `success/info/warn/danger*`, `spacing-touch`.

### 3.2 סולמות פלטה

`ink` (נייטרלי צפחה-נייבי), `sand` (נייטרלי חם — כעת עדין מאוד ב-50–200; שמור לשפת ה-DEMO), `sea` (accent), `sun` (מותג: לוגו, דירוג 1),
`moss` / `harbor` / `amber` / `coral` (סטטוס), `tangerine` (deal), `sky` (low). בכל סולם: **50** רקע עדין · **200** מסגרת · **600** מילוי מלא עם `text-white` · **700** טקסט על 50.
בערכה הכהה הסולמות משתקפים כך שהכלל הזה נשאר נכון.

### 3.3 טיפוגרפיה

- גופן: **Heebo** (מתארח מקומית, עברית + לטינית, 400/500/600/700). גיבוי: `system-ui`, `Segoe UI`, `Arial Hebrew`.
- היררכיה: H1 של דף `text-2xl sm:text-[1.75rem] font-bold tracking-tight`; כותרת כרטיס `text-base font-semibold`; גוף `text-sm`/`text-base`, `line-height: 1.6`;
  עזר `text-xs` / `text-2xs` (11px). `text-display` (40px) לכותרת מותג בלבד.
- מספרים: `tabular-nums` (מחלקה) או `price-nums` (טבלאי + lining + ריווח צפוף מעט) — חובה לכל מחיר/משך/כמות בטבלאות ובכרטיסי השוואה. `MoneyText` כבר כולל זאת.

### 3.4 רדיוסים, צללים, ריווח, מידות

| טוקן | ערך | שימוש |
|---|---|---|
| `rounded-sm` / `md` / `lg` / `xl` / `2xl` | 6 / 8 / 10 / 14 / 20px | שדות וכפתורים `md`; כרטיסים `xl`; דיאלוג `2xl` |
| `shadow-xs` | 0 1px 2px / 4% | כרטיסים, כפתורי outline |
| `shadow-sm` | שכבתי עדין | צ'יפ נבחר |
| `shadow-md` | 0 8px 20px −6px / 10% | ריחוף כרטיס אינטראקטיבי |
| `shadow-lg` | 0 20px 44px −12px / 20% | דיאלוג, תפריט, טוסט |
| `--spacing-sidebar` | 16rem | רוחב סרגל הצד (דסקטופ, צד ימין ב-RTL) |
| `--spacing-topbar` | 4rem | גובה הסרגל העליון |
| `--spacing-tabbar` | 4.25rem | גובה סרגל הלשוניות התחתון (מובייל) |
| `--spacing-touch` | 2.75rem (44px) | `h-touch` / `min-h-touch` / `size-touch` |
| רוחב תוכן | `max-w-7xl` (1280px) | `main` וסרגל עליון |

### 3.5 תנועה

`animate-fade-in` 160ms · `animate-pop-in` 180ms · `animate-slide-in-start` 240ms (מהצד הימני ב-RTL) · `animate-toast-in` 220ms; עקומה `--ease-out-soft`.
מעברי צבע 150ms. **`prefers-reduced-motion: reduce`** מקצר את כל האנימציות והמעברים ל-0.01ms (כלל גלובלי). אין אנימציות לולאה פרט ל-Spinner/Skeleton.

## 4. טבלת ניגודיות (WCAG 2.x)

חושב בנוסחת ה-relative luminance של WCAG על הערכים המדויקים ב-`index.css` (בהירה + כהה). סף טקסט 4.5:1 (טקסט גדול 3:1), רכיבי ממשק/גרפיקה 3:1.
בנוסף הורץ **ביקורת על הדפים המרונדרים** (Playwright, צבע מחושב מול הרקע האפקטיבי של כל אלמנט טקסט, כולל שקיפויות) ב-17 מסכים × 2 ערכות × 1440/390px: **0 חריגות**.

| זוג (טקסט / רקע) | שימוש | בהיר | כהה | סף |
|---|---|---|---|---|
| `fg` / `canvas` | טקסט ראשי על רקע הדף | 14.74:1 ✓ | 16.31:1 ✓ | 4.5:1 |
| `fg` / `surface` | טקסט ראשי על כרטיס | 15.80:1 ✓ | 15.10:1 ✓ | 4.5:1 |
| `fg-muted` / `surface` | טקסט משני | 7.55:1 ✓ | 8.09:1 ✓ | 4.5:1 |
| `fg-muted` / `canvas` | טקסט משני על רקע הדף | 7.04:1 ✓ | 8.74:1 ✓ | 4.5:1 |
| `fg-subtle` / `surface` | טקסט עדין (רמזים, חותמות זמן) | 5.40:1 ✓ | 6.10:1 ✓ | 4.5:1 |
| `fg-subtle` / `canvas` | טקסט עדין על רקע הדף | 5.03:1 ✓ | 6.58:1 ✓ | 4.5:1 |
| `fg-subtle` / `surface-sunken` | טקסט עדין על משטח שקוע | 4.85:1 ✓ | 6.41:1 ✓ | 4.5:1 |
| `fg-muted` / `surface-hover` | פריט ניווט במעבר עכבר | 6.91:1 ✓ | 7.46:1 ✓ | 4.5:1 |
| `accent-strong` / `accent-soft` | פריט ניווט פעיל / תג accent | 7.41:1 ✓ | 9.13:1 ✓ | 4.5:1 |
| `accent` / `surface` | קישור / טקסט accent | 6.00:1 ✓ | 8.26:1 ✓ | 4.5:1 |
| `accent` / `canvas` | קישור על רקע הדף | 5.60:1 ✓ | 8.92:1 ✓ | 4.5:1 |
| `accent-fg` / `accent` | כפתור ראשי | 6.00:1 ✓ | 8.26:1 ✓ | 4.5:1 |
| `accent-fg` / `accent-hover` | כפתור ראשי (hover) | 8.04:1 ✓ | 10.29:1 ✓ | 4.5:1 |
| `white` / `sea-800` | כפתור ראשי (לחוץ) | 10.34:1 ✓ | 12.51:1 ✓ | 4.5:1 |
| `accent-strong` / `sea-100` | כפתור tonal (accent) ב-hover | 6.61:1 ✓ | 7.59:1 ✓ | 4.5:1 |
| `fg` / `surface-hover` | שורה/פריט במעבר עכבר | 14.46:1 ✓ | 13.92:1 ✓ | 4.5:1 |
| `white` / `ink-900` | טולטיפ / תג כהה / טקסט על ink-900 | 15.80:1 ✓ | 15.10:1 ✓ | 4.5:1 |
| `ink-200` / `ink-900` | טקסט משני בתוך משטח ink-900 | 10.68:1 ✓ | 10.11:1 ✓ | 4.5:1 |
| `sun-400` / `ink-900` | אייקון זהב על ink-900 (רכיב גרפי) | 8.70:1 ✓ | 5.96:1 ✓ | 3:1 |
| `sun-300` / `ink-900` | מספר שלב זהב על ink-900 | 10.41:1 ✓ | 7.06:1 ✓ | 4.5:1 |
| `ink-950` / `sun-400` | דירוג 1 / אווטאר זהב | 10.06:1 ✓ | 6.41:1 ✓ | 4.5:1 |
| `white` / `sea-600` | צ׳יפ פעיל (bg-sea-600 text-white) | 6.00:1 ✓ | 8.26:1 ✓ | 4.5:1 |
| `white` / `moss-600` | שלב הושלם | 5.69:1 ✓ | 7.86:1 ✓ | 4.5:1 |
| `white` / `coral-600` | כפתור מחיקה / מונה התראות | 5.89:1 ✓ | 7.36:1 ✓ | 4.5:1 |
| `white` / `coral-700` | כפתור מחיקה (hover) | 8.05:1 ✓ | 9.83:1 ✓ | 4.5:1 |
| `white` / `ink-500` | ציון לא בר-השוואה | 5.40:1 ✓ | 6.10:1 ✓ | 4.5:1 |
| `ink-700` / `ink-50` | תג neutral | 9.16:1 ✓ | 9.75:1 ✓ | 4.5:1 |
| `ink-600` / `surface` | תג muted | 7.55:1 ✓ | 8.09:1 ✓ | 4.5:1 |
| `ink-600` / `ink-100` | שלב עתידי | 6.25:1 ✓ | 6.63:1 ✓ | 4.5:1 |
| `sea-700` / `sea-50` | תג accent | 7.41:1 ✓ | 9.13:1 ✓ | 4.5:1 |
| `moss-700` / `moss-50` | תג/Callout הצלחה | 7.21:1 ✓ | 9.65:1 ✓ | 4.5:1 |
| `harbor-700` / `harbor-50` | תג/Callout מידע | 8.29:1 ✓ | 10.23:1 ✓ | 4.5:1 |
| `amber-700` / `amber-50` | תג/Callout אזהרה | 6.47:1 ✓ | 11.11:1 ✓ | 4.5:1 |
| `coral-700` / `coral-50` | תג/Callout שגיאה | 7.33:1 ✓ | 9.53:1 ✓ | 4.5:1 |
| `coral-700` / `surface` | הודעת שגיאה בטופס | 8.05:1 ✓ | 9.83:1 ✓ | 4.5:1 |
| `sand-800` / `sand-100` | תג הדגמה (DEMO) | 8.22:1 ✓ | 10.36:1 ✓ | 4.5:1 |
| `sand-800` / `sand-50` | תג הדגמה על sand-50 | 8.80:1 ✓ | 11.29:1 ✓ | 4.5:1 |
| `sand-900` / `sand-100` | באנר ביצוע (הדגמה) | 11.36:1 ✓ | 12.34:1 ✓ | 4.5:1 |
| `tangerine-800` / `tangerine-50` | תג deal | 8.30:1 ✓ | 11.97:1 ✓ | 4.5:1 |
| `tangerine-800` / `tangerine-100` | טקסט deal על tangerine-100 | 7.17:1 ✓ | 10.29:1 ✓ | 4.5:1 |
| `tangerine-700` / `surface` | deal: מחיר/טקסט על לבן | 5.84:1 ✓ | 9.30:1 ✓ | 4.5:1 |
| `white` / `tangerine-600` | deal-strong: כפתור deal | 4.91:1 ✓ | 8.14:1 ✓ | 4.5:1 |
| `white` / `tangerine-700` | כפתור deal (hover) | 5.84:1 ✓ | 9.30:1 ✓ | 4.5:1 |
| `white` / `tangerine-800` | כפתור deal (לחוץ) | 8.86:1 ✓ | 12.40:1 ✓ | 4.5:1 |
| `sky-700` / `surface` | low: מחיר נמוך על לבן | 6.68:1 ✓ | 10.18:1 ✓ | 4.5:1 |
| `sky-800` / `sky-100` | טקסט על sky-100 | 7.68:1 ✓ | 10.19:1 ✓ | 4.5:1 |
| `sky-800` / `sky-50` | תג low | 8.73:1 ✓ | 12.21:1 ✓ | 4.5:1 |
| `fg` / `heat-best` | תא לוח מחירים: הזול ביותר | 8.95:1 ✓ | 6.25:1 ✓ | 4.5:1 |
| `fg` / `heat-low` | תא: שליש תחתון | 13.00:1 ✓ | 10.01:1 ✓ | 4.5:1 |
| `fg` / `heat-mid` | תא: שליש אמצעי | 13.17:1 ✓ | 10.31:1 ✓ | 4.5:1 |
| `fg` / `heat-high` | תא: שליש עליון | 11.36:1 ✓ | 11.01:1 ✓ | 4.5:1 |
| `fg` / `heat-none` | תא: אין טיסות | 14.46:1 ✓ | 13.92:1 ✓ | 4.5:1 |
| `fg-muted` / `heat-none` | תא: אין טיסות (טקסט משני) | 6.91:1 ✓ | 7.46:1 ✓ | 4.5:1 |
| `fg` / `heat-unknown` | תא: לא נבדק | 15.80:1 ✓ | 15.10:1 ✓ | 4.5:1 |
| `fg-subtle` / `heat-unknown` | תא: לא נבדק (טקסט עדין) | 5.40:1 ✓ | 6.10:1 ✓ | 4.5:1 |
| `control` / `surface` | גבול שדה קלט (רכיב UI) | 3.45:1 ✓ | 4.00:1 ✓ | 3:1 |
| `control` / `canvas` | גבול שדה קלט על רקע הדף | 3.22:1 ✓ | 4.32:1 ✓ | 3:1 |
| `focus` / `surface` | טבעת פוקוס על כרטיס | 4.26:1 ✓ | 6.39:1 ✓ | 3:1 |
| `focus` / `canvas` | טבעת פוקוס על רקע הדף | 3.97:1 ✓ | 6.90:1 ✓ | 3:1 |
| `focus` / `accent-soft` | טבעת פוקוס על פריט פעיל | 3.92:1 ✓ | 5.67:1 ✓ | 3:1 |
| `accent` / `surface` | מחוון פעיל / מתג פעיל (רכיב UI) | 6.00:1 ✓ | 8.26:1 ✓ | 3:1 |
| `ink-400` / `surface` | מסילת מתג כבוי (רכיב UI) | 3.45:1 ✓ | 4.00:1 ✓ | 3:1 |

**אי כהה** (`.surface-dark` על `#0f4f49` → `#143241`): לבן 9.40 / 13.44, `ink-200` 6.73 / 9.62, `sea-300` 5.95 / 8.52, `sun-400` (אייקון) 5.70 / 8.15 — זהה בשתי הערכות.

**ערכים שאינם טקסט (לידיעה):** קו `line` מול `surface` 1.24:1 (דקורטיבי בלבד — שדות קלט משתמשים ב-`control`); `heat-unknown` זהה ל-`surface` ולכן תא "לא נבדק" חייב
`border-line` + הסמן `—`; `heat-best` מול `heat-high` רק 1.27:1 (בהירה) — לכן **הסמן ★/טקסט "הזול ביותר" בתא best הוא חובה**, לא קישוט.
מסגרת DEMO מקווקוות (`sand-500`) 2.4:1 — דקורטיבית; התג מזוהה בטקסט "הדגמה" + אייקון.

**בדיקה חוזרת כשמשנים ערך:** יחס = (L1+0.05)/(L2+0.05), L = 0.2126R + 0.7152G + 0.0722B על ערוצים ליניאריים
(c ≤ 0.03928 ? c/12.92 : ((c+0.055)/1.055)^2.4). עדכנו את השורה בטבלה, ובדקו את שתי הערכות.

## 5. רכיבים (`@/components/ui`)

כל ה-props הקיימים נשמרו (תאימות לאחור). שינויים ותוספות ב-V6 מסומנים **חדש**.

| רכיב | וריאנטים / props עיקריים | הערות |
|---|---|---|
| `Button` / `ButtonLink` / `buttonClasses()` | `variant`: `primary` (מילוי accent — אחד למסך), `accent` (tonal: רקע `accent-soft`), `secondary` (outline), `ghost`, `danger`, `link`, **`deal`** (חדש: כתום, רק לפאנל ההצעה המומלצת); `size`: `sm` 32px / `md` 40px / `lg` 48px; `loading`, `loadingText`, `leadingIcon`, `trailingIcon`, `fullWidth` | כולל `.touch-target` (44px במגע). `primary` עבר מנייבי לטורקיז; `accent` עבר ממילוי ל-tonal |
| `IconButton` | `label` (חובה, עברית), `icon`, `variant`, `size` `sm`/`md`/`lg`, `loading`, `showTooltip` | 44px במגע |
| `Input`, `Textarea`, `NativeSelect`, `controlClasses` | בתוך `<Field label hint error>` | 40px; במגע ≥ 44px וטקסט 16px (אין זום ב-iOS). `controlClasses` למקשים מותאמים (combobox) |
| `Checkbox`, `Switch` | `label`, `description`, `error` | מסילת מתג כבוי `ink-400` (3.45:1); אגודל לבן קבוע; תווית Checkbox מורחבת במגע |
| `Field` | `label`, `hint`, `error`, `required`, `optional` | מחבר `id`, `aria-describedby`, `aria-invalid` |
| `Card`, `CardHeader`, `CardFooter` | `padding`, `interactive`, `as`; `CardHeader icon actions level` | `rounded-xl border-line shadow-xs`; אייקון בצ'יפ `accent-soft` |
| `Badge` | `tone`: `neutral`, `muted`, `accent`, `success`, `info`, `warn`, `danger`, `demo`, `dark`, **`deal`**, **`low`**; `size` `sm`/`md` | `demo` = מקווקו חול + semibold |
| `ModeBadge` | `mode` (DEMO/LIVE/CACHED/סטטוסי ספק), `size`, `showTooltip`, `description` | צבע + טקסט + אייקון + טולטיפ |
| `Callout` | `tone` `info`/`success`/`warn`/`danger`/`neutral`, `title`, `icon`, `action` | |
| `Dialog`, `ConfirmDialog` | `open`, `onOpenChange`, `trigger?`, `title`, `description`, `footer`, `size` `sm`–`xl` | **תיקון BUG-QA-01:** פוקוס חוזר לכפתור שפתח גם בלי `trigger` |
| `Drawer` | `open`, `onOpenChange`, `title`, `hideTitle`, **`showCloseButton`** (חדש, ברירת מחדל `false`), `className` | ברירת מחדל `bg-surface text-fg`; פוקוס חוזר לפותח |
| `useReturnFocus(open, enabled?)` | **חדש** — מחזיר handler ל-`onCloseAutoFocus` | לדיאלוגים מותאמים מעל Radix |
| `DropdownMenu*` | `DropdownMenuItem tone`, **`DropdownMenuRadioGroup`**, **`DropdownMenuRadioItem`** (חדשים) | שורות 36px, 44px במגע |
| `Tabs*` | Radix, RTL | לשונית פעילה: משטח לבן + מסגרת + semibold |
| **`Segmented`** (חדש) | ראו 5.1 | קבוצת בחירה (רשימה ⇄ טבלה, חודש ⇄ מטריצה) |
| **`Legend`**, **`LegendSwatch`** (חדשים) | ראו 5.2 | מקרא ללוח מחירים/גרפים |
| `DataTable` | `columns`, `rows`, `getRowKey`, `caption`, `dense`, `loading`, `empty` | מיכל הגלילה `relative` (תיקון גלישת sr-only); כותרת `surface-sunken`; ספרות טבלאיות |
| `EmptyState`, `ErrorState`, `Skeleton`, `SkeletonText`, `Spinner` | | ריק: מסגרת מקווקוות על `surface`; שגיאה: `coral-50` + מזהה בקשה + "נסו שוב" |
| `Toast` (`useToast`) | `tone` `info`/`success`/`warn`/`danger`, `duration` | פס צבע בצד ההתחלה (ימין) + אייקון; `role="alert"` ל-danger |
| `PageHeader` | `title`, `description`, `eyebrow`, `icon`, `actions` | H1 יחיד; אייקון בצ'יפ `accent-soft` (במקום נייבי+זהב) |
| `Stat`, `Pagination`, `MoneyText`, `DateText`, `DateRange`, `FreshnessText`, `Tooltip`, `Kbd`, `VisuallyHidden` | ללא שינוי API | `Stat` עם `price-nums` |

### 5.1 `Segmented` (חדש)

```tsx
import { Segmented } from '@/components/ui';
import { List, Table2 } from 'lucide-react';

<Segmented<'list' | 'table'>
  label="תצוגת תוצאות"            // שם נגיש לקבוצה (חובה)
  value={view} onValueChange={setView}
  options={[
    { value: 'list', label: 'רשימה', icon: <List />, testId: 'view-list' },
    { value: 'table', label: 'טבלה', icon: <Table2 />, testId: 'view-table' },
  ]}
  size="md"                         // 'sm' (28px) | 'md' (32px, ברירת מחדל)
  data-testid="results-view-toggle"
/>
```

| prop | טיפוס | ברירת מחדל | תיאור |
|---|---|---|---|
| `label` | `string` | — | שם נגיש של הקבוצה (`role="radiogroup"`) |
| `options` | `{ value, label, icon?, disabled?, testId? }[]` | — | האפשרויות; `testId` מוצב על ה-`<label>` |
| `value` / `defaultValue` | `V` | אפשרות פעילה ראשונה | מבוקר / לא-מבוקר |
| `onValueChange` | `(v: V) => void` | — | |
| `size` | `'sm' \| 'md'` | `'md'` | |
| `fullWidth` | `boolean` | `false` | האפשרויות חולקות את הרוחב |
| `iconOnly` | `boolean` | `false` | אייקונים בלבד; הטקסט נשאר לקוראי מסך |
| `disabled`, `name`, `className`, `data-testid` | | | |

מבוסס על `<input type="radio">` מקוריים: Tab נכנס לקבוצה, חיצים מזיזים בחירה (מקורי, מודע ל-RTL), "checked" מוכרז. הנבחר שונה במשטח, משקל וצל — לא רק בצבע.
כל אפשרות היא מטרת מגע של 44px. כל `<label>` מקבל `data-state="checked|unchecked"`.

### 5.2 `Legend` / `LegendSwatch` (חדש)

```tsx
import { Legend, ModeBadge } from '@/components/ui';

<Legend
  title="מקרא"
  data-testid="fare-legend"
  items={[
    { id: 'best', label: 'הזול ביותר', swatchClassName: 'bg-heat-best', marker: '★' },
    { id: 'low', label: 'זול', swatchClassName: 'bg-heat-low' },
    { id: 'mid', label: 'בינוני', swatchClassName: 'bg-heat-mid' },
    { id: 'high', label: 'יקר', swatchClassName: 'bg-heat-high' },
    { id: 'none', label: 'אין טיסות', swatchClassName: 'bg-heat-none', marker: '∅' },
    { id: 'unknown', label: 'לא נבדק', swatchClassName: 'bg-heat-unknown', marker: '—' },
    { id: 'error', label: 'שגיאה', swatchClassName: 'bg-coral-50', marker: '!' },
  ]}
>
  <ModeBadge mode="DEMO" size="sm" />
</Legend>
```

| prop | טיפוס | תיאור |
|---|---|---|
| `items` | `{ id?, label, swatchClassName?, marker?, description? }[]` | כל פריט = דוגמית (דקורטיבית, `aria-hidden`) + טקסט |
| `title` | `ReactNode` | כותרת גלויה; אם מחרוזת — גם שם הרשימה |
| `aria-label` | `string` | שם הרשימה כשאין `title` טקסטואלי (ברירת מחדל "מקרא") |
| `children` | `ReactNode` | תוכן בסוף השורה (למשל `ModeBadge`) |
| `size` | `'sm' \| 'md'` | |
| `className`, `data-testid` | | |

`LegendSwatch` (`className`, `marker`, `size`) זמין לשימוש עצמאי, למשל בתוך tooltip.

### 5.3 מתכונים לטיסות (FE-FLIGHT)

- **תא לוח מחירים**: `bg-heat-{tier} text-fg border border-line` + סמן (★ ל-best, `—` לא נבדק, `∅` אין טיסות, `!` שגיאה) + `aria-label` עם שם הדרגה.
  פוקוס: הטבעת הגלובלית (`outline-focus`) עובדת על כל הרקעים (≥ 3:1). נבחר: `ring-2 ring-accent` + `aria-pressed`/`aria-selected`.
- **פאנל ההצעה המומלצת**: `rounded-xl border border-deal-line bg-deal-soft`, מחיר `text-deal price-nums text-3xl font-bold`, תג `<Badge tone="deal">`,
  כפתור `<Button variant="deal">` (ולא כפתור מותאם עם `bg-deal-strong` — כך מקבלים 44px, פוקוס, מצבי hover/active/disabled ותמיכה בכהה).
- **מחיר נמוך**: `text-low` / `<Badge tone="low">` / `bg-low-soft border-low-line`.
- **החלפת תצוגה**: `<Segmented>` לרשימה ⇄ טבלה ולחודש ⇄ מטריצה; גם לבורר הלוך-חזור / כיוון אחד.
- **טבלת תוצאות**: `DataTable` או `<table>` בתוך מיכל `relative overflow-x-auto` (ספרות טבלאיות אוטומטיות).
- **מפה (SVG)**: השתמשו ב-`fill="var(--color-…)"`/`stroke="var(--color-…)"` (כל המשתנים נפלטים) כדי שהמפה תתאים לערכה הכהה.

## 6. מצבים

| מצב | כלל |
|---|---|
| hover | משטחים: `surface-hover`; outline: `border-ink-300`; accent: `accent-hover`. 150ms |
| focus | `:focus-visible` גלובלי: `outline 2px var(--color-focus)` offset 2px (≥ 3:1 על כל משטח, בשתי הערכות). שדות: offset 0 + גבול accent. אין להסיר outline בלי תחליף |
| active / pressed | צעד כהה יותר (`sea-800`, `tangerine-800`, `surface-sunken`) |
| selected | Segmented/Tabs: משטח לבן + מסגרת + semibold; ניווט: `accent-soft` + פס 3px בצד ההתחלה + semibold |
| disabled | `opacity-55` + `cursor-not-allowed` (פטור מדרישת ניגודיות, אך עדיין קריא) |
| loading | `Button loading` (Spinner + `aria-busy`), `Skeleton` (`aria-hidden`; העטיפה מכריזה "טוען…") |
| empty | `EmptyState` — כותרת, הסבר, פעולה אחת |
| error | `ErrorState` / `Callout tone="danger"` — הודעה בעברית + מזהה בקשה + "נסו שוב" |
| DEMO | `Badge tone="demo"` / `ModeBadge mode="DEMO"` — תמיד גלוי ליד כל מחיר |

## 7. נגישות

- **AA בשתי הערכות** (טבלה בסעיף 4 + ביקורת דפים מרונדרים).
- **צבע לעולם לא הסימן היחיד** — טקסט/אייקון/סמן נלווים (תאי heat, ModeBadge, Segmented, ניווט פעיל).
- **מטרות מגע ≥ 44px** במצביע גס (`@media (pointer: coarse)`): `.touch-target` מוסיף `::after` בלתי נראה שמגדיל את אזור הלחיצה ל-44×44 בלי לשנות את המראה
  (Button, IconButton, Switch, Tabs, Segmented, סגירת דיאלוג/טוסט/מגירה, תפריט משתמש); שדות ופריטי תפריט/ניווט: `min-h-touch`/`h-touch`.
  ל-`.touch-target` יש `position: relative` בשכבת components — מחלקת `absolute` על אותו אלמנט גוברת.
- **פוקוס**: קישור דילוג, פוקוס עובר ל-`<main>` בניווט, דיאלוגים/מגירות מחזירים פוקוס לפותח (גם במצב מבוקר).
- **תנועה מופחתת** מכובדת גלובלית.
- **גלישה אופקית**: אין ב-390px (נבדק ב-16 מסכים). גריד עם תוכן `nowrap` חייב `grid-cols-1` (= `minmax(0,1fr)`) או `min-w-0` על הילדים.

## 8. RTL

- כיווניות לוגית בלבד: `ms-/me-/ps-/pe-`, `start-/end-`, `text-start/end`, `rounded-s/e`, `border-s/e`. אסור `ml/mr/pl/pr/left/right`.
- סרגל הצד בצד ההתחלה (ימין), גבולו `border-e`; המגירה נכנסת מימין (`animate-slide-in-start`); פס הפריט הפעיל ב-`before:start-0`; פס הטוסט `border-s-4`.
- חיצי "קדימה" מצביעים שמאלה (`ArrowLeft`, `ChevronLeft`) + `ltr:rotate-180`.
- תוכן לטיני בלבד (IATA, אימייל, URL, קוד) מקבל `dir="ltr"`. מספרים בתוך טקסט עברי — `tabular-nums`; טווחים עם מקף en (`–`).
- רכיבי Radix מקבלים `dir={APP_DIR}` (כבר מוגדר ב-Tabs/DropdownMenu). ב-Segmented החיצים מקוריים ומודעים לכיוון.

## 9. מעטפת (layout)

- **סרגל צד** (≥ lg): לבן, `border-e border-line`, לוגו בכהה, כותרות קבוצה `text-2xs text-fg-subtle`, פריטים 36px (44px במגע), פריט פעיל `accent-soft` + פס accent.
- **סרגל עליון**: לבן שקוף-למחצה עם blur, `border-b`; מחוון DEMO (`DataModeIndicator`), פעמון התראות, תפריט משתמש (כולל **ערכת צבעים**).
- **מובייל**: כפתור תפריט → מגירה עם כפתור סגירה; סרגל לשוניות תחתון עם "גלולה" `accent-soft` לפעיל.
- **התחברות**: פאנל מותג בהיר (`.bg-brand-wash`, איור שמש-וגלים שמותאם לערכה), טופס בכרטיס לבן.

## 10. עשה / אל תעשה

| ✓ עשו | ✗ אל תעשו |
|---|---|
| טוקנים סמנטיים (`bg-surface`, `text-fg-muted`, `border-line`, `text-accent`) | ערכי hex בקוד פיצ'רים (לא יתאימו לערכה הכהה) |
| `variant="primary"` לפעולה הראשית **אחת** במסך | כמה כפתורים מלאים זה לצד זה — השתמשו ב-`accent`/`secondary` |
| כתום (`deal`) רק להצעה המומלצת היחידה | כתום לאזהרות, לכפתורים כלליים או לכמה הצעות |
| תכלת (`low`/`heat-low`) רק למחירים נמוכים | תכלת לקישורים או לכפתורים |
| `bg-heat-*` + טקסט/סמן + `aria-label` | תא שבו רק הצבע מעיד על הדרגה |
| `Button`/`IconButton`/`Segmented` (44px במגע מובנה) | כפתורים מותאמים בגובה 32–36px בלי `.touch-target` |
| `tabular-nums` / `price-nums` למספרים | ספרות פרופורציונליות בעמודות מחיר |
| `Badge tone="demo"` / `ModeBadge` ליד כל מחיר הדגמה | הסתרת DEMO או הצגתו בצבע מבהיל (אדום) |
| `grid-cols-1` / `min-w-0` סביב טקסט `truncate`/`nowrap` | גריד עם מסלול `auto` שמתרחב מעבר ל-390px |
| `fill="var(--color-…)"` ב-SVG | `fill="#142339"` (חוץ מהלוגו) |
| `dark:` רק כשאין טוקן מתאים | שכפול כל עיצוב ב-`dark:` — הסולמות כבר משתקפים |

## 11. שינויי V6 (סיכום)

- מעטפת בהירה: סרגל צד לבן (במקום נייבי), סרגל עליון לבן, רקע `#f6f7f9` ניטרלי (במקום חול), רדיוסים חדים יותר, צללים רכים יותר, תוכן עד 1280px.
- `primary` = טורקיז; `accent` = tonal; חדש `deal`. תגים חדשים `deal`, `low`.
- ערכה כהה מלאה + בורר בתפריט המשתמש; `theme-color` לשתי הערכות.
- רכיבים חדשים: `Segmented`, `Legend`, `LegendSwatch`, `DropdownMenuRadioGroup/Item`, `useReturnFocus`; `Drawer showCloseButton`.
- מטרות מגע 44px, טקסט 16px בשדות במגע, `DataTable` עם מיכל `relative`.
- תיקוני QA: BUG-QA-01 (פוקוס חוזר מדיאלוגים מבוקרים, כולל ConfirmDialog/Drawer), BUG-QA-02 (גלישה אופקית בלוח הבקרה ב-390px).
