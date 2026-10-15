"""בדיקות יחידה ללוגיקה. הרצה: python3 -m unittest -v test_logic"""

from __future__ import annotations

import csv
import re
import sys
import unittest
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from ladder_engine import INPUTS, OUTPUTS, Coil, Contact, compile_rungs, load_program  # noqa: E402
from run_simulation import ENGINES, differential, run_scenario  # noqa: E402
from scenarios import all_scenarios  # noqa: E402

IO_MAP = HERE.parent / "06_PLC_Logic" / "IO_MAP.csv"


class TestProgramStructure(unittest.TestCase):
    """בדיקות סטטיות — מה שחייב להיות נכון כדי שהקלדה ל-Zelio תהיה חד־משמעית."""

    @classmethod
    def setUpClass(cls):
        cls.program = load_program()
        cls.rungs = compile_rungs(cls.program)

    def test_rungs_numbered_in_order(self):
        self.assertEqual([r.n for r in self.rungs], list(range(1, len(self.rungs) + 1)))

    def test_every_address_is_declared(self):
        declared = set(self.program["symbols"]) | set(self.program["timers"]) | set(INPUTS)
        for r in self.rungs:
            for br in r.branches:
                for c in br:
                    self.assertIn(c.address, declared, f"rung {r.n}: {c.address}")
            self.assertIn(r.coil.address, declared, f"rung {r.n}: coil {r.coil.address}")

    def test_no_double_coils(self):
        direct = Counter(r.coil.address for r in self.rungs if r.coil.kind == "direct")
        self.assertEqual([a for a, n in direct.items() if n > 1], [], "סליל ישיר כפול")
        latched = {r.coil.address for r in self.rungs if r.coil.kind in ("set", "reset")}
        self.assertEqual(set(direct) & latched, set(), "אותה כתובת גם כסליל ישיר וגם כ-S/R")
        timers = Counter(r.coil.address for r in self.rungs if r.coil.kind == "timer")
        self.assertEqual([a for a, n in timers.items() if n > 1], [], "טיימר עם שתי פקודות")

    def test_every_set_has_a_reset(self):
        sets = {r.coil.address for r in self.rungs if r.coil.kind == "set"}
        resets = {r.coil.address for r in self.rungs if r.coil.kind == "reset"}
        # MB (ARMED) מתאפס רק בכיבוי — מכוון
        self.assertEqual(sets - resets, {"MB"})

    def test_always_off_relay_is_never_driven(self):
        self.assertNotIn("MK", {r.coil.address for r in self.rungs})

    def test_all_declared_timers_used(self):
        used = {r.coil.address for r in self.rungs if r.coil.kind == "timer"}
        self.assertEqual(used, set(self.program["timers"]))

    def test_smoke_settle_longer_than_pulse(self):
        t = self.program["timers"]
        self.assertGreater(t["T7"]["preset_s"], t["T6"]["preset_s"])

    def test_io_map_matches_ladder_symbols(self):
        with open(IO_MAP, encoding="utf-8-sig") as f:
            rows = {r["address"]: r for r in csv.DictReader(f)}
        for addr in INPUTS + OUTPUTS:
            self.assertIn(addr, rows, f"{addr} חסר ב-IO_MAP.csv")
        for addr, sym in self.program["symbols"].items():
            if addr[0] in "IQ":
                self.assertEqual(rows[addr]["signal"], sym["name"], f"{addr}: שם שונה בין IO_MAP ללדר")

    def test_parsers_reject_bad_tokens(self):
        for bad in ("X1", "M", "QZZ"):
            with self.assertRaises(ValueError):
                Contact.parse(bad)
        for bad in ("[I1", "TM1", "SQB"):
            with self.assertRaises(ValueError):
                Coil.parse(bad)


class TestDesignDataConsistency(unittest.TestCase):
    """כל תג רכיב בטבלאות התכנון חייב להופיע ברשימת הרכיבים (BOM)."""

    @staticmethod
    def _rows(rel: str) -> list[dict]:
        with open(HERE.parent / rel, encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))

    @staticmethod
    def _expand(tag: str) -> set[str]:
        out = set()
        for part in re.split(r"[/+]", tag):
            m = re.match(r"^([A-Z]+)(\d+)-[A-Z]*(\d+)$", part)
            if m:
                out |= {f"{m.group(1)}{i}" for i in range(int(m.group(2)), int(m.group(3)) + 1)}
            else:
                out.add(part)
        return out

    def test_all_tags_known(self):
        known = {"SUPPLY", "BUS-L123"}
        for r in self._rows("10_Documentation/BOM.csv"):
            known |= self._expand(r["tag"])
        for r in self._rows("10_Documentation/CONNECTIONS.csv"):
            for d in (r["from_device"], r["to_device"]):
                self.assertLessEqual(self._expand(d), known, f"{r['wire_id']}: {d}")
        for r in self._rows("06_PLC_Logic/IO_MAP.csv"):
            if r["tag"] != "—":
                self.assertIn(r["tag"], known)
        for r in self._rows("05_Panel_Layout/LAYOUT.csv"):
            if r["tag"] != "GAP":
                self.assertLessEqual(self._expand(r["tag"]), known, r["tag"])

    def test_wire_ids_unique(self):
        ids = [r["wire_id"] for r in self._rows("10_Documentation/CONNECTIONS.csv")]
        self.assertEqual(len(ids), len(set(ids)))

    def test_mains_wires_flagged_for_licensed_review(self):
        for r in self._rows("10_Documentation/CONNECTIONS.csv"):
            if r["circuit_type"] in ("POWER_AC", "PE") and r["wire_id"] != "C011":
                self.assertEqual(r["check_status"], "DESIGN_ONLY_LICENSED_REVIEW", r["wire_id"])


class TestScenarios(unittest.TestCase):
    def test_all_scenarios_all_engines(self):
        program = load_program()
        for sc in all_scenarios():
            for engine in ENGINES:
                with self.subTest(scenario=sc.sid, engine=engine):
                    r = run_scenario(sc, engine, program)
                    failed = [(x["check"].t, x["check"].expect, x["actual"]) for x in r["results"] if not x["ok"]]
                    failed += [b["window"] for b in r["blinks"] if not b["ok"]]
                    self.assertEqual(failed, [])


class TestDifferential(unittest.TestCase):
    def test_ladder_equals_reference_model(self):
        program = load_program()
        for seed in (101, 202, 303):
            with self.subTest(seed=seed):
                r = differential(seed, 200.0, program)
                self.assertTrue(r["ok"], r)


if __name__ == "__main__":
    unittest.main(verbosity=2)
