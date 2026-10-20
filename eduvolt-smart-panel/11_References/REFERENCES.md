# מקורות ורמת האימות שלהם

> לא הצלחתי לפתוח אף דף נתונים רשמי של יצרן מסביבת העבודה (הרשת חסומה).
> הנתונים מגיעים מתוצאות חיפוש של מפיצים, מסימון IEC סטנדרטי ומידע כללי.
> **לפני חיווט או רכישה — לפתוח את דף הנתונים הרשמי של כל רכיב ולאמת.**

## רמות אמינות

| רמה | משמעות |
|---|---|
| `IEC_STANDARD` | סימון שמוגדר בתקן (למשל `A1/A2`, `95-96`, `13-14`, `1/L1`) — אמין, ועדיין לבדוק על הרכיב |
| `DISTRIBUTOR_LISTING` | ערך מרשימות של מפיצים (Farnell ואחרים) — צריך אימות מול היצרן |
| `TYPICAL_VERIFY` | נוהג מקובל במודולים נפוצים — חייב בדיקה על הרכיב שבידיך |
| `UNKNOWN` / `TBD` | לא ידוע. לא הומצא ערך |

## מה צריך להוריד ולשמור כאן

| רכיב | מסמך | איפה לחפש | סטטוס |
|---|---|---|---|
| Schneider Zelio SR3B261BD | דף נתונים + מדריך חומרה | אתר Schneider Electric, לפי מספר הדגם | ⏳ |
| Zelio Soft 2 | תוכנה + מדריך תכנות Ladder | אתר Schneider Electric | ⏳ |
| Schneider LC1D09BD | דף נתונים (צריכת סליל, מדכא, מגעי עזר) | אתר Schneider Electric | ⏳ |
| Schneider LRD | דף נתונים + טבלת טווחים | אתר Schneider Electric | ⏳ (אחרי נתוני המנוע) |
| Mean Well HDR-60-24 | דף נתונים (הדקים, בידוד, הפחתת הספק, inrush) | אתר Mean Well | ⏳ |
| MQ-2 | דף נתונים של החיישן (Hanwei) | יצרן החיישן | ⏳ |
| גלאי העשן | הוראות יצרן | לפי הדגם שנרכש | ⏳ |
| XH-W3001 | אין דף נתונים רשמי של יצרן | צילום הלוח + זיהוי הדקים (ראו `03_Custom_Components/EVC_COMPONENT_SPECS.md`) | ⏳ |
| ממסר הפחת, המא״זים | דפי נתונים לפי הדגמים | לפי היצרן | ⏳ |

## מקורות שנמצאו בחיפוש (מפיצים — לא מסמכי יצרן)

- Farnell — Schneider SR3B261BD: https://ie.farnell.com/schneider-electric/sr3b261bd/logic-module-relay-16i-p-10o-p/dp/5018791
- Trace-Tec — SR3B261BD: https://trace-tec.vn/SR3B261BD-pe76266.html
- Farnell — Schneider LC1D09BD: https://export.farnell.com/schneider-electric/lc1d09bd/contactor-3pst-no-24vdc-din-rail/dp/2579146
- Elettronew — LC1D09BD: https://www.elettronew.com/en/schneider-automation/schneider-tesys-lc1d-contactor-3p-9a-24v-lc1d09bd-44262.html
- DigiKey — Mean Well HDR-60-24: https://azcus.digikey.com/en/products/detail/mean-well-usa-inc/HDR-60-24/7703804
- Bravo Electro — HDR-60-24: https://www.bravoelectro.com/hdr-60-24.html

## תקנים שהוזכרו (לבדוק את הגרסה המחייבת בישראל עם המורה)

- IEC 60445 — סימון מוליכים וצבעים.
- EN 60204-1 — ציוד חשמלי של מכונות (נוהג לצבעי פיקוד, עצירת חירום).
- IEC 60947 — ציוד מיתוג במתח נמוך (מגענים, ממסרי עומס, לחצנים).
- IEC 60034-8 — סימון הדקי מנוע.
- תקנות החשמל בישראל — מחייבות; לא נבדקו כאן.
