"""יוצר את 06_PLC_Logic/ZELIO_LADDER.md מתוך ladder_program.json.

הקובץ ב-JSON הוא מקור האמת: הסימולציה מריצה אותו, והמסמך הזה נוצר ממנו.
כך מה שמוקלד ל-Zelio Soft 2 הוא בדיוק מה שנבדק.

הרצה: python3 tools/render_ladder_doc.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "06_PLC_Logic" / "ladder_program.json"
OUT = ROOT / "06_PLC_Logic" / "ZELIO_LADDER.md"


def contact_label(tok: str, symbols: dict, timers: dict) -> str:
    addr = tok[0].upper() + tok[1:]
    nc = tok[0].islower()
    name = (symbols.get(addr) or timers.get(addr) or {}).get("name", addr)
    return f"`{tok}`" + (" (הפוך)" if nc else "") + f" {name}"


def coil_label(tok: str, symbols: dict, timers: dict) -> str:
    if tok.startswith("["):
        kind, addr = "סליל", tok[1:]
    elif tok.startswith("TT"):
        kind, addr = "פקודת טיימר", "T" + tok[2:]
    elif tok[0] == "S":
        kind, addr = "SET", tok[1:]
    else:
        kind, addr = "RESET", tok[1:]
    name = (symbols.get(addr) or timers.get(addr) or {}).get("name", addr)
    return f"`{tok}` {kind} {name}"


def main() -> None:
    p = json.loads(SRC.read_text(encoding="utf-8"))
    sym, tim = p["symbols"], p["timers"]
    L = []
    L.append("# תוכנית Ladder ל-Zelio SR3B261BD")
    L.append("")
    L.append("> נוצר אוטומטית מ-`ladder_program.json` על ידי `tools/render_ladder_doc.py`. לא לערוך ידנית —")
    L.append("> לערוך את ה-JSON, להריץ את הסימולציה, ואז ליצור מחדש את המסמך.")
    L.append("")
    L.append(f"גרסה: `{p['meta']['version']}` · תאריך: `{p['meta']['date']}`")
    L.append("")
    L.append("## סטטוס")
    L.append("")
    L.append("הלוגיקה נבדקה רק בסימולציית Python (ראו `08_Test_Reports/SIMULATION_RESULTS.md`).")
    L.append("היא **לא** נבדקה עדיין ב-Zelio Soft 2 ולא על בקר אמיתי.")
    L.append("")
    L.append("## איך מקלידים ב-Zelio Soft 2")
    L.append("")
    L.append("1. פרויקט חדש ← בוחרים את הדגם `SR3B261BD` ← שפת תכנות `Ladder`.")
    L.append("2. מקלידים את השורות לפי הסדר בטבלה. **הסדר חשוב** — הלוגיקה תוכננה לסריקה מלמעלה למטה.")
    L.append("3. בשורה עם כמה ענפים: כל ענף הוא שורת מגעים נפרדת, והענפים מחוברים במקביל לפני הסליל (OR).")
    L.append("4. מגע באות קטנה (`i4`, `m8`, `t1`) הוא מגע הפוך של אותה כתובת בתוכנה.")
    L.append("   זה לא קשור לסוג הלחצן בשטח: למשל `i4` פירושו 'ESTOP_OK כבוי', כלומר החירום לחוץ.")
    L.append("5. כל טיימר מוגדר כסוג `A` (השהיית הפעלה) עם הערך מטבלת הטיימרים.")
    L.append("6. ממלאים את התגובות (comments) של כל כתובת לפי טבלת הסמלים.")
    L.append("7. עוברים למצב סימולציה ב-Zelio Soft 2 ומריצים את הבדיקות מ-`08_Test_Reports/TEST_PLAN.md`.")
    L.append("")
    L.append("**לאמת בתוכנה עצמה** (לא אומת מכאן): שמות הממסרים העזר הזמינים (`M1`–`M9`, `MA`…),")
    L.append("מספר השורות המרבי, סוגי הטיימרים, והאם תוצאת סליל זמינה מיד לשורות שאחריו באותה סריקה.")
    L.append("הלוגיקה נבדקה בשני מצבי סריקה כדי לא להיות תלויה בהנחה האחרונה.")
    L.append("")
    L.append("## שורות התוכנית")
    L.append("")
    L.append("| # | ענפים (OR) — מגעים בטור (AND) | סליל | הסבר |")
    L.append("|---|---|---|---|")
    for r in p["rungs"]:
        branches = "<br>**או** ".join(" · ".join(contact_label(t, sym, tim) for t in br) for br in r["branches"])
        L.append(f"| {r['n']} | {branches} | {coil_label(r['coil'], sym, tim)} | {r['comment']} |")
    L.append("")
    L.append("### אותה תוכנית בכתיב מקוצר (להקלדה מהירה)")
    L.append("")
    L.append("```text")
    for r in p["rungs"]:
        L.append(f"{r['n']:>2}: " + "  |  ".join(" ".join(br) for br in r["branches"]) + f"  -->  {r['coil']}")
    L.append("```")
    L.append("")
    L.append("## טבלת סמלים")
    L.append("")
    L.append("| כתובת | שם | תיאור |")
    L.append("|---|---|---|")
    for a, v in sym.items():
        L.append(f"| `{a}` | `{v['name']}` | {v['comment']} |")
    L.append("")
    L.append("## טיימרים")
    L.append("")
    L.append("| טיימר | שם | סוג | ערך בסימולציה | סטטוס הערך | תפקיד |")
    L.append("|---|---|---|---|---|---|")
    for a, v in tim.items():
        L.append(f"| `{a}` | `{v['name']}` | `{v['type']}` | {v['preset_s']} s | {v['preset_status']} | {v['comment']} |")
    L.append("")
    OUT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
