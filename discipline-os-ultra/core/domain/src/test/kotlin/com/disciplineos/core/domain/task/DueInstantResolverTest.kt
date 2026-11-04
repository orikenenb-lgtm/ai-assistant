package com.disciplineos.core.domain.task

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Duration
import java.time.Instant
import java.time.ZoneOffset

class DueInstantResolverTest {

    private fun i(s: String) = Instant.parse(s)

    @Test fun nullTime_resolvesToNull() {
        assertNull(DueInstantResolver.resolve(d("2026-11-04"), null, JERUSALEM))
    }

    @Test fun normalTime_usesZoneOffset() {
        // Israel in winter = UTC+2.
        assertEquals(i("2026-11-04T07:00:00Z"), DueInstantResolver.resolve(d("2026-11-04"), t("09:00"), JERUSALEM))
        assertEquals(i("2026-11-04T07:00:00Z"), DueInstantResolver.resolve(d("2026-11-04"), t("07:00"), ZoneOffset.UTC))
    }

    // ---- Asia/Jerusalem: spring forward Fri 2026-03-27 02:00 → 03:00; fall back Sun 2026-10-25 02:00 → 01:00 ----

    @Test fun jerusalem_gap_shiftsForwardByGapLength() {
        assertEquals(i("2026-03-27T00:30:00Z"), DueInstantResolver.resolve(d("2026-03-27"), t("02:30"), JERUSALEM))
        // 02:30 does not exist; result equals 03:30 IDT.
        assertEquals(
            DueInstantResolver.resolve(d("2026-03-27"), t("03:30"), JERUSALEM),
            DueInstantResolver.resolve(d("2026-03-27"), t("02:30"), JERUSALEM),
        )
    }

    @Test fun jerusalem_sameWallClockAcrossSpringForward_is23HoursApart() {
        val before = DueInstantResolver.resolve(d("2026-03-26"), t("09:00"), JERUSALEM)!!
        val after = DueInstantResolver.resolve(d("2026-03-27"), t("09:00"), JERUSALEM)!!
        assertEquals(i("2026-03-26T07:00:00Z"), before)
        assertEquals(i("2026-03-27T06:00:00Z"), after)
        assertEquals(Duration.ofHours(23), Duration.between(before, after))
    }

    @Test fun jerusalem_overlap_usesEarlierOffset() {
        // 01:30 happens twice on 2026-10-25; the first one is at +03:00.
        assertEquals(i("2026-10-24T22:30:00Z"), DueInstantResolver.resolve(d("2026-10-25"), t("01:30"), JERUSALEM))
    }

    @Test fun jerusalem_endOfDay_onTransitionDays() {
        assertEquals(i("2026-03-27T21:00:00Z"), DueInstantResolver.endOfDay(d("2026-03-27"), JERUSALEM))
        assertEquals(i("2026-10-25T22:00:00Z"), DueInstantResolver.endOfDay(d("2026-10-25"), JERUSALEM))
        val start = d("2026-10-25").atStartOfDay(JERUSALEM).toInstant()
        assertEquals(Duration.ofHours(25), Duration.between(start, DueInstantResolver.endOfDay(d("2026-10-25"), JERUSALEM)))
    }

    // ---- America/New_York: spring forward 2026-03-08 02:00 → 03:00; fall back 2026-11-01 02:00 → 01:00 ----

    @Test fun newYork_gap_0230_becomes_0330_EDT() {
        assertEquals(i("2026-03-08T07:30:00Z"), DueInstantResolver.resolve(d("2026-03-08"), t("02:30"), NEW_YORK))
    }

    @Test fun newYork_overlap_0130_usesEDT() {
        assertEquals(i("2026-11-01T05:30:00Z"), DueInstantResolver.resolve(d("2026-11-01"), t("01:30"), NEW_YORK))
    }

    @Test fun newYork_endOfDay_dayLengths() {
        val springStart = d("2026-03-08").atStartOfDay(NEW_YORK).toInstant()
        val springEnd = DueInstantResolver.endOfDay(d("2026-03-08"), NEW_YORK)
        assertEquals(i("2026-03-09T04:00:00Z"), springEnd)
        assertEquals(Duration.ofHours(23), Duration.between(springStart, springEnd))

        val fallStart = d("2026-11-01").atStartOfDay(NEW_YORK).toInstant()
        val fallEnd = DueInstantResolver.endOfDay(d("2026-11-01"), NEW_YORK)
        assertEquals(i("2026-11-02T05:00:00Z"), fallEnd)
        assertEquals(Duration.ofHours(25), Duration.between(fallStart, fallEnd))
    }

    @Test fun newYork_afterFallBack_usesEST() {
        assertEquals(i("2026-11-02T14:00:00Z"), DueInstantResolver.resolve(d("2026-11-02"), t("09:00"), NEW_YORK))
    }

    @Test fun effectiveDeadline_fallsBackToEndOfDay() {
        assertEquals(DueInstantResolver.endOfDay(d("2026-11-04"), JERUSALEM),
            DueInstantResolver.effectiveDeadline(d("2026-11-04"), null, JERUSALEM))
        assertEquals(i("2026-11-04T07:00:00Z"), DueInstantResolver.effectiveDeadline(d("2026-11-04"), t("09:00"), JERUSALEM))
    }
}
