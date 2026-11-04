package com.disciplineos.app.ui.focus

import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import org.junit.Test
import kotlin.test.assertEquals

class FocusFormatTest {

    @Test fun clockFormatsMinutesAndSeconds() {
        assertEquals("25:00", FocusFormat.clock(25 * 60_000L))
        assertEquals("00:00", FocusFormat.clock(0))
        assertEquals("00:01", FocusFormat.clock(1))          // rounds up partial seconds
        assertEquals("00:59", FocusFormat.clock(58_001))
        assertEquals("1:00:00", FocusFormat.clock(3_600_000))
        assertEquals("2:05:09", FocusFormat.clock((2 * 3600 + 5 * 60 + 9) * 1000L))
    }

    @Test fun clockClampsNegative() {
        assertEquals("00:00", FocusFormat.clock(-5_000))
    }

    @Test fun phaseTotalsFollowConfig() {
        val c = FocusConfig(workMinutes = 50, shortBreakMinutes = 10, longBreakMinutes = 30)
        assertEquals(50 * 60_000L, FocusFormat.phaseTotalMillis(FocusPhase.WORK, c))
        assertEquals(10 * 60_000L, FocusFormat.phaseTotalMillis(FocusPhase.SHORT_BREAK, c))
        assertEquals(30 * 60_000L, FocusFormat.phaseTotalMillis(FocusPhase.LONG_BREAK, c))
        assertEquals(0L, FocusFormat.phaseTotalMillis(FocusPhase.IDLE, c))
    }

    @Test fun elapsedFraction() {
        assertEquals(0f, FocusFormat.elapsedFraction(1000, 1000))
        assertEquals(0.5f, FocusFormat.elapsedFraction(500, 1000))
        assertEquals(1f, FocusFormat.elapsedFraction(0, 1000))
        // Config shortened mid-phase: remaining > total must not go negative.
        assertEquals(0f, FocusFormat.elapsedFraction(2000, 1000))
        assertEquals(0f, FocusFormat.elapsedFraction(0, 0))
    }

    @Test fun filledDots() {
        assertEquals(0, FocusFormat.filledDots(0, 4, FocusPhase.WORK))
        assertEquals(1, FocusFormat.filledDots(1, 4, FocusPhase.SHORT_BREAK))
        assertEquals(3, FocusFormat.filledDots(3, 4, FocusPhase.WORK))
        assertEquals(4, FocusFormat.filledDots(4, 4, FocusPhase.LONG_BREAK))
        assertEquals(0, FocusFormat.filledDots(4, 4, FocusPhase.WORK))
        assertEquals(1, FocusFormat.filledDots(5, 4, FocusPhase.SHORT_BREAK))
        assertEquals(0, FocusFormat.filledDots(3, 0, FocusPhase.WORK)) // perCycle clamped to 1
    }

    @Test fun minutesLeftRoundsUp() {
        assertEquals(0, FocusFormat.minutesLeftRoundedUp(0))
        assertEquals(1, FocusFormat.minutesLeftRoundedUp(1))
        assertEquals(1, FocusFormat.minutesLeftRoundedUp(60_000))
        assertEquals(2, FocusFormat.minutesLeftRoundedUp(60_001))
    }

    @Test fun sanitizeClampsToSliderRanges() {
        val s = FocusFormat.sanitize(FocusConfig(workMinutes = 1, shortBreakMinutes = 99, longBreakMinutes = 0, sessionsBeforeLongBreak = 50))
        assertEquals(FocusFormat.WORK_RANGE.first, s.workMinutes)
        assertEquals(FocusFormat.SHORT_BREAK_RANGE.last, s.shortBreakMinutes)
        assertEquals(FocusFormat.LONG_BREAK_RANGE.first, s.longBreakMinutes)
        assertEquals(FocusFormat.CYCLE_RANGE.last, s.sessionsBeforeLongBreak)
    }
}
