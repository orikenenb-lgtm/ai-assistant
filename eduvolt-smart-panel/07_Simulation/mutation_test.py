"""בדיקת מוטציות: האם הבדיקות באמת תופסות טעויות הקלדה בלדר?

לכל מגע בלדר יוצרים "מוטנט" שבו המגע הפוך (NO↔NC) — בדיוק הטעות
הנפוצה בהקלדה ידנית ל-Zelio Soft 2 — ובודקים שלפחות בדיקה אחת נכשלת.
מוטנט ששורד = מגע שהבדיקות לא מכסות, או מגע מיותר.

הרצה: python3 mutation_test.py   (לוקח כמה דקות)
"""

from __future__ import annotations

import copy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from ladder_engine import load_program  # noqa: E402
from run_simulation import differential, run_scenario  # noqa: E402
from scenarios import all_scenarios  # noqa: E402


def flip(token: str) -> str:
    return (token[0].lower() if token[0].isupper() else token[0].upper()) + token[1:]


def killed(program: dict) -> str | None:
    for sc in all_scenarios():
        if not run_scenario(sc, "ladder-immediate", program)["ok"]:
            return f"scenario {sc.sid}"
    for seed in (1, 2, 3):
        if not differential(seed, 200.0, program)["ok"]:
            return f"differential seed {seed}"
    return None


def main() -> int:
    base = load_program()
    survivors, total, lines = [], 0, []
    for ri, rung in enumerate(base["rungs"]):
        for bi, branch in enumerate(rung["branches"]):
            for ci, tok in enumerate(branch):
                total += 1
                prog = copy.deepcopy(base)
                prog["rungs"][ri]["branches"][bi][ci] = flip(tok)
                by = killed(prog)
                label = f"rung {rung['n']:>2} branch {bi + 1} contact {tok}→{flip(tok)}"
                line = f"{label}: {'killed by ' + by if by else 'SURVIVED'}"
                lines.append(line)
                print(line, flush=True)
                if not by:
                    survivors.append(label)
    print(f"\n{total - len(survivors)}/{total} mutants killed")
    for s in survivors:
        print("SURVIVOR:", s)
    write_report(total, lines, survivors)
    return 0 if not survivors else 1


def write_report(total: int, lines: list[str], survivors: list[str]) -> None:
    out = HERE.parent / "08_Test_Reports" / "MUTATION_RESULTS.md"
    L = [
        "# בדיקת מוטציות ללדר",
        "",
        "> נוצר אוטומטית על ידי `07_Simulation/mutation_test.py` — לא לערוך ידנית.",
        "",
        "## מה נבדק",
        "",
        "לכל מגע בתוכנית נוצרה גרסה שבה המגע הפוך (NO↔NC) — הטעות הנפוצה ביותר בהקלדה ידנית.",
        "כל גרסה הורצה מול כל התרחישים ומול בדיקה השוואתית קצרה. גרסה ש'שורדת' פירושה שהבדיקות",
        "לא היו מגלות את הטעות הזאת.",
        "",
        "## תוצאה",
        "",
        f"**{total - len(survivors)} מתוך {total}** מוטציות נתפסו.",
        "",
    ]
    if survivors:
        L += ["מוטציות ששרדו (דורשות בדיקה נוספת או מגע מיותר):", ""] + [f"- `{s}`" for s in survivors] + [""]
    L += ["## פירוט", "", "```text"] + lines + ["```", ""]
    out.write_text("\n".join(L), encoding="utf-8")
    print(f"report: {out}")


if __name__ == "__main__":
    sys.exit(main())
