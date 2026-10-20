# בדיקת מוטציות ללדר

> נוצר אוטומטית על ידי `07_Simulation/mutation_test.py` — לא לערוך ידנית.

## מה נבדק

לכל מגע בתוכנית נוצרה גרסה שבה המגע הפוך (NO↔NC) — הטעות הנפוצה ביותר בהקלדה ידנית.
כל גרסה הורצה מול כל התרחישים ומול בדיקה השוואתית קצרה. גרסה ש'שורדת' פירושה שהבדיקות
לא היו מגלות את הטעות הזאת.

## תוצאה

**89 מתוך 89** מוטציות נתפסו.

## פירוט

```text
rung  1 branch 1 contact I3→i3: killed by scenario S01
rung  1 branch 1 contact m2→M2: killed by differential seed 1
rung  2 branch 1 contact I3→i3: killed by differential seed 1
rung  3 branch 1 contact I1→i1: killed by scenario S02
rung  3 branch 1 contact m4→M4: killed by scenario S04
rung  4 branch 1 contact I1→i1: killed by scenario S04
rung  5 branch 1 contact mK→MK: killed by scenario S01
rung  6 branch 1 contact IC→iC: killed by scenario S01
rung  6 branch 1 contact T1→t1: killed by scenario S10
rung  7 branch 1 contact I8→i8: killed by scenario S01
rung  7 branch 2 contact IA→iA: killed by scenario S01
rung  7 branch 3 contact IB→iB: killed by scenario S01
rung  7 branch 4 contact M6→m6: killed by scenario S01
rung  8 branch 1 contact i7→I7: killed by scenario S02
rung  8 branch 1 contact i9→I9: killed by scenario S02
rung  9 branch 1 contact MD→mD: killed by scenario S01
rung  9 branch 1 contact i6→I6: killed by scenario S03
rung 10 branch 1 contact mD→MD: killed by scenario S03
rung 10 branch 1 contact I6→i6: killed by scenario S01
rung 11 branch 1 contact I5→i5: killed by scenario S01
rung 11 branch 2 contact T2→t2: killed by scenario S01
rung 11 branch 3 contact T3→t3: killed by scenario S01
rung 12 branch 1 contact i4→I4: killed by scenario S01
rung 12 branch 1 contact m8→M8: killed by scenario S14
rung 12 branch 2 contact M5→m5: killed by scenario S01
rung 12 branch 2 contact m9→M9: killed by scenario S07
rung 12 branch 3 contact M7→m7: killed by scenario S01
rung 12 branch 3 contact mA→MA: killed by scenario S11
rung 13 branch 1 contact i4→I4: killed by scenario S01
rung 14 branch 1 contact M5→m5: killed by scenario S01
rung 15 branch 1 contact M7→m7: killed by scenario S01
rung 16 branch 1 contact M1→m1: killed by scenario S08
rung 16 branch 1 contact IB→iB: killed by scenario S02
rung 16 branch 1 contact mF→MF: killed by scenario S08
rung 17 branch 1 contact MF→mF: killed by scenario S08
rung 18 branch 1 contact MF→mF: killed by scenario S08
rung 19 branch 1 contact MF→mF: killed by scenario S08
rung 19 branch 1 contact t6→T6: killed by scenario S08
rung 20 branch 1 contact T7→t7: killed by scenario S08
rung 21 branch 1 contact I4→i4: killed by scenario S02
rung 21 branch 1 contact m5→M5: killed by scenario S02
rung 21 branch 1 contact m7→M7: killed by scenario S02
rung 21 branch 1 contact mF→MF: killed by scenario S02
rung 22 branch 1 contact M1→m1: killed by scenario S14
rung 22 branch 1 contact I4→i4: killed by scenario S04
rung 23 branch 1 contact M1→m1: killed by scenario S07
rung 23 branch 1 contact m5→M5: killed by scenario S07
rung 23 branch 1 contact mF→MF: killed by scenario S07
rung 24 branch 1 contact M1→m1: killed by scenario S11
rung 24 branch 1 contact m7→M7: killed by scenario S11
rung 25 branch 1 contact M1→m1: killed by scenario S07
rung 26 branch 1 contact M1→m1: killed by scenario S01
rung 26 branch 1 contact T1→t1: killed by scenario S02
rung 26 branch 1 contact MC→mC: killed by scenario S02
rung 27 branch 1 contact m8→M8: killed by scenario S02
rung 27 branch 1 contact m9→M9: killed by scenario S02
rung 27 branch 1 contact mA→MA: killed by scenario S02
rung 28 branch 1 contact MB→mB: killed by scenario S01
rung 28 branch 1 contact MG→mG: killed by scenario S02
rung 28 branch 1 contact MC→mC: killed by scenario S02
rung 28 branch 1 contact I2→i2: killed by scenario S02
rung 29 branch 1 contact M3→m3: killed by scenario S02
rung 29 branch 1 contact MJ→mJ: killed by scenario S03
rung 29 branch 1 contact MH→mH: killed by scenario S03
rung 29 branch 1 contact m1→M1: killed by scenario S03
rung 30 branch 1 contact mJ→MJ: killed by scenario S03
rung 31 branch 1 contact MD→mD: killed by scenario S01
rung 32 branch 1 contact MB→mB: killed by scenario S01
rung 32 branch 1 contact m8→M8: killed by scenario S02
rung 32 branch 1 contact m9→M9: killed by scenario S02
rung 32 branch 1 contact I4→i4: killed by scenario S02
rung 32 branch 1 contact m5→M5: killed by scenario S02
rung 33 branch 1 contact Q1→q1: killed by scenario S03
rung 33 branch 1 contact I6→i6: killed by scenario S03
rung 34 branch 1 contact t5→T5: killed by scenario S01
rung 35 branch 1 contact T4→t4: killed by scenario S01
rung 36 branch 1 contact MJ→mJ: killed by scenario S01
rung 36 branch 2 contact t1→T1: killed by scenario S01
rung 36 branch 2 contact T4→t4: killed by differential seed 1
rung 37 branch 1 contact I7→i7: killed by scenario S06
rung 37 branch 2 contact I9→i9: killed by scenario S06
rung 38 branch 1 contact M8→m8: killed by scenario S01
rung 38 branch 2 contact M9→m9: killed by scenario S01
rung 38 branch 3 contact MA→mA: killed by scenario S01
rung 38 branch 4 contact mB→MB: killed by scenario S01
rung 38 branch 4 contact T1→t1: killed by scenario S01
rung 39 branch 1 contact M5→m5: killed by scenario S01
rung 39 branch 2 contact i4→I4: killed by scenario S01
rung 40 branch 1 contact ME→mE: killed by scenario S01
```
