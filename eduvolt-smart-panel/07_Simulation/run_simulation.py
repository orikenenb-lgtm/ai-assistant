"""מריץ את כל התרחישים על שלושה מנועים, מריץ בדיקה השוואתית אקראית, וכותב דוח.

הרצה:
    python3 run_simulation.py            # מריץ ומעדכן את 08_Test_Reports/SIMULATION_RESULTS.md
    python3 run_simulation.py --no-write # מריץ בלי לכתוב דוח

קוד יציאה 0 רק אם כל הבדיקות עברו.
"""

from __future__ import annotations

import argparse
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from ladder_engine import INPUTS, LadderPLC, load_program  # noqa: E402
from plant import Plant  # noqa: E402
from reference_model import ReferenceController  # noqa: E402
from scenarios import Scenario, all_scenarios  # noqa: E402
from signals import OUTPUT_NAMES, derive_state  # noqa: E402

DT = 0.01
REPORT = HERE.parent / "08_Test_Reports" / "SIMULATION_RESULTS.md"
ENGINES = ["ladder-immediate", "ladder-deferred", "reference"]


def make_controller(engine: str, program: dict):
    if engine == "ladder-immediate":
        return LadderPLC(program, "immediate")
    if engine == "ladder-deferred":
        return LadderPLC(program, "deferred")
    presets = {t: float(v["preset_s"]) for t, v in program["timers"].items()}
    return ReferenceController(presets)


class Simulation:
    def __init__(self, engine: str, program: dict, setup: dict | None = None):
        self.engine = engine
        self.program = program
        self.ctrl = make_controller(engine, program)
        self.plant = Plant(**(setup or {}))
        self.was_powered = True
        self.trace: list[dict] = []

    def step(self) -> dict:
        p = self.plant
        if p.control_power and not self.was_powered:
            self.ctrl = make_controller(self.engine, self.program)  # זיכרון לא שמור
        self.was_powered = p.control_power
        if p.control_power:
            z = {i: False for i in INPUTS}
            z.update(p.plc_inputs())
            q = self.ctrl.scan(z, DT)
            state = derive_state(self.ctrl.signals())
        else:
            q = {f"Q{c}": False for c in "123456789A"}
            state = "POWER_OFF"
        p.apply(q)
        rec = {OUTPUT_NAMES[k]: v for k, v in q.items() if k in OUTPUT_NAMES}
        rec.update({"state": state, "KM1_COIL": p.km1_coil, "KM1_CLOSED": p.km1_closed})
        self.trace.append(rec)
        return rec


def run_scenario(sc: Scenario, engine: str, program: dict) -> dict:
    sim = Simulation(engine, program, sc.setup)
    events = sorted(((round(t / DT), f, v, n) for t, f, v, n in sc.events), key=lambda e: e[0])
    n_steps = round(sc.duration / DT)
    ei = 0
    for k in range(n_steps + 1):
        while ei < len(events) and events[ei][0] <= k:
            _, fld, val, _ = events[ei]
            if not hasattr(sim.plant, fld):
                raise AttributeError(f"{sc.sid}: שדה לא קיים {fld}")
            setattr(sim.plant, fld, val)
            ei += 1
        sim.step()

    results = []
    for c in sc.checks:
        rec = sim.trace[round(c.t / DT)]
        actual = {key: rec[key] for key in c.expect}
        results.append({"check": c, "actual": actual, "ok": actual == c.expect})
    blinks = []
    for t0, t1, out in sc.blink_windows:
        vals = {sim.trace[k][out] for k in range(round(t0 / DT), round(t1 / DT) + 1)}
        blinks.append({"window": (t0, t1, out), "ok": vals == {True, False}})

    transitions = []
    prev = None
    for k, rec in enumerate(sim.trace):
        if rec["state"] != prev:
            transitions.append((k * DT, rec["state"]))
            prev = rec["state"]
    ok = all(r["ok"] for r in results) and all(b["ok"] for b in blinks)
    return {"ok": ok, "results": results, "blinks": blinks, "transitions": transitions}


# ---------- בדיקה השוואתית אקראית: לדר (immediate) מול מודל הייחוס ----------

RANDOM_FIELDS = [
    ("start_pressed", 0.20), ("stop_pressed", 0.10), ("reset_pressed", 0.20), ("estop_pressed", 0.06),
    ("ol_tripped", 0.06), ("ts1_warn", 0.08), ("ts2_alarm", 0.05), ("ts3_warn", 0.08), ("ts4_alarm", 0.05),
    ("smoke_present", 0.05), ("gas_present", 0.05), ("stop_wire_broken", 0.02),
]


def differential(seed: int, duration: float, program: dict) -> dict:
    rng = random.Random(seed)
    setup = {
        "smoke_detector_latching": rng.random() < 0.5,
        "km1_fail_to_close": rng.random() < 0.15,
        "km1_welded": rng.random() < 0.15,
    }
    a = Simulation("ladder-immediate", program, setup)
    b = Simulation("reference", program, setup)
    n_steps = round(duration / DT)
    k = 0
    while k <= n_steps:
        hold_steps = rng.randint(3, 250)
        for fld, p_on in RANDOM_FIELDS:
            val = rng.random() < p_on
            setattr(a.plant, fld, val)
            setattr(b.plant, fld, val)
        if rng.random() < 0.01:
            a.plant.control_power = b.plant.control_power = not a.plant.control_power
        for _ in range(hold_steps):
            ra, rb = a.step(), b.step()
            if ra != rb:
                diff = {key: (ra[key], rb[key]) for key in ra if ra[key] != rb[key]}
                return {"seed": seed, "ok": False, "scans": k, "t": round(k * DT, 2), "diff": diff}
            k += 1
    states = {r["state"] for r in a.trace}
    return {"seed": seed, "ok": True, "scans": k, "states_seen": states}


# ---------- דוח ----------

def _fmt(v) -> str:
    if isinstance(v, bool):
        return "1" if v else "0"
    return str(v)


def _fmt_expect(d: dict) -> str:
    return ", ".join(f"{k}={_fmt(v)}" for k, v in d.items())


def write_report(scen_results: dict, diff_results: list, program: dict) -> str:
    L = []
    L.append("# תוצאות סימולציית הלוגיקה")
    L.append("")
    L.append("> **מה זה ומה זה לא.** זו סימולציה של **לוגיקת הבקרה בלבד** שרצה ב-Python.")
    L.append("> היא לא EduVolt, לא Zelio Soft 2 ולא בדיקה של חומרה או חיווט.")
    L.append("> לפני כל שימוש יש להריץ את אותן בדיקות בסימולציה של Zelio Soft 2 (לפי TEST_PLAN.md).")
    L.append("> הקובץ נוצר אוטומטית על ידי `07_Simulation/run_simulation.py` — לא לערוך ידנית.")
    L.append("")
    L.append("## איך בודקים")
    L.append("")
    L.append("- **ladder-immediate** — הלדר מ-`ladder_program.json` רץ כמו שהוא; תוצאת סליל נראית מיד לשורות שאחריו.")
    L.append("- **ladder-deferred** — אותו לדר, אבל כל הכתיבות נכנסות לתוקף רק בסוף הסריקה (מבחן עמידות).")
    L.append("- **reference** — מודל ייחוס שנכתב ישירות מהמפרט, בלי קשר לשורות הלדר.")
    L.append("- **בדיקה השוואתית** — קלטים אקראיים לאורך זמן; הלדר ומודל הייחוס חייבים לתת יציאות זהות בכל סריקה.")
    L.append("")
    timers = program["timers"]
    L.append("ערכי טיימרים בסימולציה (ערכי דמה — הערכים האמיתיים TBD):")
    L.append("")
    L.append("| טיימר | תפקיד | ערך בסימולציה | סטטוס |")
    L.append("|---|---|---|---|")
    for t, v in timers.items():
        L.append(f"| `{t}` | {v['comment']} | {v['preset_s']} s | {v['preset_status']} |")
    L.append("")

    total = sum(1 for sid in scen_results for e in ENGINES)
    passed = sum(1 for sid in scen_results for e in ENGINES if scen_results[sid]["by_engine"][e]["ok"])
    diff_ok = all(d["ok"] for d in diff_results)
    L.append("## סיכום")
    L.append("")
    L.append(f"- תרחישים: {len(scen_results)} × {len(ENGINES)} מנועים = {total} הרצות; עברו: **{passed}/{total}**.")
    n_scans = sum(d["scans"] for d in diff_results)
    L.append(f"- בדיקה השוואתית: {len(diff_results)} הרצות אקראיות, {n_scans:,} סריקות; "
             f"{'**אין אף הבדל** בין הלדר למודל הייחוס' if diff_ok else '**נמצאו הבדלים — ראו למטה**'}.")
    L.append("")
    L.append("| תרחיש | נושא | ladder-immediate | ladder-deferred | reference |")
    L.append("|---|---|---|---|---|")
    for sid, r in scen_results.items():
        cells = ["✅" if r["by_engine"][e]["ok"] else "❌" for e in ENGINES]
        L.append(f"| {sid} | {r['scenario'].title} | " + " | ".join(cells) + " |")
    L.append("")

    L.append("## מגבלות שהסימולציה הדגימה")
    L.append("")
    L.append("אלה לא באגים בלוגיקה אלא גבולות של התכנון הלימודי. הם מסומנים כבדיקות מסוג `limitation`:")
    L.append("")
    for sid, r in scen_results.items():
        for c in r["scenario"].checks:
            if c.kind == "limitation":
                L.append(f"- **{sid}** — {c.note}")
    L.append("")

    L.append("## פירוט תרחישים")
    L.append("")
    for sid, r in scen_results.items():
        sc: Scenario = r["scenario"]
        L.append(f"### {sid} — {sc.title}")
        L.append("")
        L.append(f"**מטרה:** {sc.goal}")
        L.append("")
        if sc.setup:
            L.append("**הגדרות ותקלות מוזרקות:** " + ", ".join(f"`{k}={_fmt(v)}`" for k, v in sc.setup.items()))
            L.append("")
        L.append("**אירועים:**")
        L.append("")
        for t, fld, val, note in sorted(sc.events, key=lambda e: e[0]):
            if note:
                L.append(f"- `t={t:g}s` — {note}")
        L.append("")
        L.append("| זמן | ציפייה | ladder-immediate | ladder-deferred | reference |")
        L.append("|---|---|---|---|---|")
        for idx, c in enumerate(sc.checks):
            cells = []
            for e in ENGINES:
                res = r["by_engine"][e]["results"][idx]
                cells.append("✅" if res["ok"] else "❌ " + _fmt_expect(res["actual"]))
            tag = " *(מגבלה)*" if c.kind == "limitation" else ""
            note = f" — {c.note}" if c.note else ""
            L.append(f"| {c.t:g}s | `{_fmt_expect(c.expect)}`{note}{tag} | " + " | ".join(cells) + " |")
        for idx, (t0, t1, out) in enumerate(sc.blink_windows):
            cells = ["✅" if r["by_engine"][e]["blinks"][idx]["ok"] else "❌" for e in ENGINES]
            L.append(f"| {t0:g}–{t1:g}s | `{out}` מהבהב | " + " | ".join(cells) + " |")
        L.append("")
        trans = r["by_engine"]["ladder-immediate"]["transitions"]
        L.append("**מעברי מצב (ladder-immediate):** " + " → ".join(f"{s} ({t:.2f}s)" for t, s in trans))
        L.append("")

    L.append("## בדיקה השוואתית אקראית")
    L.append("")
    L.append("| seed | סריקות | תוצאה |")
    L.append("|---|---|---|")
    for d in diff_results:
        if d["ok"]:
            L.append(f"| {d['seed']} | {d['scans']:,} | ✅ זהות מלאה; מצבים שנצפו: {', '.join(sorted(d['states_seen']))} |")
        else:
            L.append(f"| {d['seed']} | {d['scans']:,} | ❌ הבדל ב-t={d['t']}s: {d['diff']} |")
    L.append("")
    return "\n".join(L) + "\n"


def run_all(write: bool = True, diff_seeds: int = 12, diff_duration: float = 400.0) -> bool:
    program = load_program()
    scen_results = {}
    for sc in all_scenarios():
        scen_results[sc.sid] = {
            "scenario": sc,
            "by_engine": {e: run_scenario(sc, e, program) for e in ENGINES},
        }
    diff_results = [differential(seed, diff_duration, program) for seed in range(1, diff_seeds + 1)]

    ok = all(r["by_engine"][e]["ok"] for r in scen_results.values() for e in ENGINES) and all(d["ok"] for d in diff_results)
    for sid, r in scen_results.items():
        marks = " ".join(("OK  " if r["by_engine"][e]["ok"] else "FAIL") for e in ENGINES)
        print(f"{sid}: {marks}  {r['scenario'].title}")
        for e in ENGINES:
            for res in r["by_engine"][e]["results"]:
                if not res["ok"]:
                    print(f"    [{e}] t={res['check'].t}: expected {res['check'].expect} got {res['actual']}")
            for b in r["by_engine"][e]["blinks"]:
                if not b["ok"]:
                    print(f"    [{e}] blink window {b['window']} failed")
    for d in diff_results:
        print(f"diff seed {d['seed']}: {'OK' if d['ok'] else 'MISMATCH ' + str(d)}")
    if write:
        REPORT.write_text(write_report(scen_results, diff_results, program), encoding="utf-8")
        print(f"report: {REPORT}")
    print("ALL PASSED" if ok else "FAILURES")
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-write", action="store_true")
    args = ap.parse_args()
    sys.exit(0 if run_all(write=not args.no_write) else 1)
