package com.disciplineos.app.ui.coach

import org.junit.Test
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoachInputTest {

    @Test fun clampCapsAtMax() {
        assertEquals(CoachInput.MAX_CHARS, CoachInput.clamp("x".repeat(5_000)).length)
        assertEquals("שלום", CoachInput.clamp("שלום"))
    }

    @Test fun canSendRules() {
        assertTrue(CoachInput.canSend("היי", sending = false, limitReached = false))
        assertFalse(CoachInput.canSend("   ", sending = false, limitReached = false))
        assertFalse(CoachInput.canSend("היי", sending = true, limitReached = false))
        assertFalse(CoachInput.canSend("היי", sending = false, limitReached = true))
        assertFalse(CoachInput.canSend("x".repeat(CoachInput.MAX_CHARS + 1), sending = false, limitReached = false))
    }

    @Test fun counterShownNearLimit() {
        assertFalse(CoachInput.showCounter(100))
        assertTrue(CoachInput.showCounter(1_600))
    }

    @Test fun remoteNeedsOptInAndBackend() {
        assertFalse(CoachInput.usesRemote(remoteEnabled = false, backendConfigured = true))
        assertFalse(CoachInput.usesRemote(remoteEnabled = true, backendConfigured = false))
        assertTrue(CoachInput.usesRemote(remoteEnabled = true, backendConfigured = true))
    }

    @Test fun limitLiftsAfterMidnight() {
        val day = LocalDate.of(2026, 11, 4)
        assertFalse(CoachInput.isLimitActive(null, day))
        assertTrue(CoachInput.isLimitActive(day, day))
        assertFalse(CoachInput.isLimitActive(day, day.plusDays(1)))
        assertTrue(CoachInput.isLimitActive(day, day.minusDays(1)), "clock moved back: stay limited")
    }

    @Test fun dayCheckDelayTargetsMidnightButNeverSleepsLong() {
        val zone = ZoneId.of("Asia/Jerusalem")
        // 23:59:30 local → 30s to midnight.
        val late = LocalDate.of(2026, 11, 4).atTime(23, 59, 30).atZone(zone).toInstant()
        assertEquals(30_000L, CoachInput.dayCheckDelayMillis(late, zone))
        // Noon → capped at one minute.
        val noon = LocalDate.of(2026, 11, 4).atTime(12, 0).atZone(zone).toInstant()
        assertEquals(CoachInput.MAX_DAY_CHECK_MILLIS, CoachInput.dayCheckDelayMillis(noon, zone))
        // Exactly at midnight → small positive delay, never zero (no busy loop).
        val midnight = LocalDate.of(2026, 11, 5).atStartOfDay(zone).toInstant().minusMillis(1)
        assertEquals(1_000L, CoachInput.dayCheckDelayMillis(midnight, zone))
        assertTrue(CoachInput.dayCheckDelayMillis(Instant.EPOCH, ZoneId.of("UTC")) in 1_000L..CoachInput.MAX_DAY_CHECK_MILLIS)
    }
}
