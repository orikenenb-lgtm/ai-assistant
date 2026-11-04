package com.disciplineos.core.domain.task

import com.disciplineos.core.model.RecurrenceRule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek.*

class RecurrenceEngineTest {

    private fun dates(vararg s: String) = s.map(::d)

    @Test fun oneOff_returnsStartDateWhenInWindow() {
        val tk = task(startDate = d("2026-11-04"))
        assertEquals(dates("2026-11-04"), RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-11-30")))
    }

    @Test fun oneOff_outsideWindow_isEmpty() {
        val tk = task(startDate = d("2026-11-04"))
        assertTrue(RecurrenceEngine.occurrenceDates(tk, d("2026-11-05"), d("2026-11-30")).isEmpty())
        assertTrue(RecurrenceEngine.occurrenceDates(tk, d("2026-10-01"), d("2026-11-03")).isEmpty())
    }

    @Test fun oneOff_windowEdgesInclusive() {
        val tk = task(startDate = d("2026-11-04"))
        assertEquals(dates("2026-11-04"), RecurrenceEngine.occurrenceDates(tk, d("2026-11-04"), d("2026-11-04")))
    }

    @Test fun archived_producesNothing() {
        val tk = task(startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1), archived = true)
        assertTrue(RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-11-30")).isEmpty())
    }

    @Test fun invertedWindow_isEmpty() {
        val tk = task(startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1))
        assertTrue(RecurrenceEngine.occurrenceDates(tk, d("2026-11-10"), d("2026-11-01")).isEmpty())
    }

    @Test fun daily_everyDay_respectsStartAndEnd() {
        val tk = task(startDate = d("2026-11-03"), endDate = d("2026-11-06"), recurrence = RecurrenceRule.Daily(1))
        assertEquals(
            dates("2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-11-30")),
        )
    }

    @Test fun daily_everyThreeDays_anchoredOnStartDate_evenWhenWindowStartsLater() {
        val tk = task(startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(3))
        // Series: 1, 4, 7, 10, 13 ...
        assertEquals(dates("2026-11-07", "2026-11-10", "2026-11-13"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-05"), d("2026-11-14")))
        assertEquals(dates("2026-11-04"), RecurrenceEngine.occurrenceDates(tk, d("2026-11-04"), d("2026-11-06")))
    }

    @Test fun daily_acrossDstTransitions_yieldsEveryCalendarDay() {
        val tk = task(startDate = d("2026-03-25"), recurrence = RecurrenceRule.Daily(1))
        assertEquals(dates("2026-03-26", "2026-03-27", "2026-03-28"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-03-26"), d("2026-03-28")))
    }

    @Test fun weekly_selectedDays() {
        val tk = task(startDate = d("2026-11-01"), recurrence = RecurrenceRule.Weekly(setOf(MONDAY, WEDNESDAY)))
        assertEquals(dates("2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-11-14")))
    }

    @Test fun weekly_doesNotIncludeDaysBeforeStartDate() {
        // Start on Wednesday 4 Nov: Monday 2 Nov of the same week must not appear.
        val tk = task(startDate = d("2026-11-04"), recurrence = RecurrenceRule.Weekly(setOf(MONDAY, WEDNESDAY)))
        assertEquals(dates("2026-11-04", "2026-11-09", "2026-11-11"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-11-14")))
    }

    @Test fun weekly_everyTwoWeeks_anchoredOnStartWeek() {
        // startDate Wed 4 Nov; anchor week starts Sunday 1 Nov. Weeks of 1 Nov, 15 Nov, 29 Nov qualify.
        val tk = task(startDate = d("2026-11-04"), recurrence = RecurrenceRule.Weekly(setOf(SUNDAY, THURSDAY), everyNWeeks = 2))
        assertEquals(dates("2026-11-05", "2026-11-15", "2026-11-19", "2026-11-29", "2026-12-03"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-12-05")))
    }

    @Test fun weekly_everyTwoWeeks_windowStartingInOffWeek() {
        val tk = task(startDate = d("2026-11-02"), recurrence = RecurrenceRule.Weekly(setOf(MONDAY), everyNWeeks = 2))
        assertEquals(dates("2026-11-16", "2026-11-30"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-08"), d("2026-12-06")))
    }

    @Test fun weekly_respectsEndDate() {
        val tk = task(startDate = d("2026-11-01"), endDate = d("2026-11-09"),
            recurrence = RecurrenceRule.Weekly(setOf(MONDAY)))
        assertEquals(dates("2026-11-02", "2026-11-09"), RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2026-12-31")))
    }

    @Test fun monthly_clampsToMonthLength() {
        val tk = task(startDate = d("2026-01-01"), recurrence = RecurrenceRule.Monthly(31))
        assertEquals(dates("2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-01-01"), d("2026-05-31")))
    }

    @Test fun monthly_leapYearFebruary() {
        val tk = task(startDate = d("2028-01-01"), recurrence = RecurrenceRule.Monthly(30))
        assertEquals(dates("2028-01-30", "2028-02-29", "2028-03-30"),
            RecurrenceEngine.occurrenceDates(tk, d("2028-01-01"), d("2028-03-31")))
    }

    @Test fun monthly_skipsDateBeforeStartInFirstMonth() {
        val tk = task(startDate = d("2026-11-20"), recurrence = RecurrenceRule.Monthly(15))
        assertEquals(dates("2026-12-15", "2027-01-15"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-11-01"), d("2027-01-31")))
    }

    @Test fun monthly_endDateInclusive() {
        val tk = task(startDate = d("2026-01-01"), endDate = d("2026-03-15"), recurrence = RecurrenceRule.Monthly(15))
        assertEquals(dates("2026-01-15", "2026-02-15", "2026-03-15"),
            RecurrenceEngine.occurrenceDates(tk, d("2026-01-01"), d("2026-12-31")))
    }

    @Test fun endDateBeforeStartDate_isEmpty() {
        val tk = task(startDate = d("2026-11-10"), endDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1))
        assertTrue(RecurrenceEngine.occurrenceDates(tk, d("2026-10-01"), d("2026-12-01")).isEmpty())
        val oneOff = task(startDate = d("2026-11-10"), endDate = d("2026-11-01"))
        assertTrue(RecurrenceEngine.occurrenceDates(oneOff, d("2026-10-01"), d("2026-12-01")).isEmpty())
    }
}
