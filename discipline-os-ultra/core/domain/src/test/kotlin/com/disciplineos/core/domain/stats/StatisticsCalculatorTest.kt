package com.disciplineos.core.domain.stats

import com.disciplineos.core.domain.gamification.B2
import com.disciplineos.core.domain.gamification.B2.TODAY
import com.disciplineos.core.domain.gamification.FakeBlockerRepository
import com.disciplineos.core.domain.gamification.FakeFocusRepository
import com.disciplineos.core.domain.gamification.FakeTaskRepository
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

class StatisticsCalculatorTest {
    private fun compute(
        range: StatsRange = StatsRange.WEEK,
        occ: List<OccurrenceWithTask> = emptyList(),
        prev: List<OccurrenceWithTask> = emptyList(),
        focus: List<FocusSession> = emptyList(),
        bypasses: List<BypassSession> = emptyList(),
        categories: List<Category> = emptyList(),
        zone: ZoneId = B2.ZONE,
    ) = StatisticsCalculator.compute(range, TODAY, occ, prev, focus, bypasses, categories, zone)

    @Test fun emptyData_zeroRatesNoNaN() {
        StatsRange.entries.forEach { range ->
            val s = compute(range)
            assertEquals(range.days, s.days.size)
            assertEquals(TODAY, s.days.last().date)
            assertEquals(TODAY.minusDays(range.days - 1L), s.days.first().date)
            listOf(s.completionRate, s.mandatoryCompletionRate, s.trendDeltaPoints).forEach {
                assertFalse(it.isNaN()); assertEquals(0f, it)
            }
            assertEquals(0, s.focusMinutesTotal); assertEquals(0, s.bypassCount)
            assertTrue(s.byCategory.isEmpty())
            assertEquals(0, s.currentStreak); assertEquals(0, s.bestStreak)
        }
    }

    @Test fun skippedExcludedFromDenominator() {
        val m = B2.task(1); val o = B2.task(2, TaskKind.OPTIONAL)
        val s = compute(
            occ = listOf(
                B2.occ(1, m, TODAY.minusDays(1), OccurrenceStatus.COMPLETED),
                B2.occ(2, m, TODAY.minusDays(1), OccurrenceStatus.SKIPPED),
                B2.occ(3, o, TODAY.minusDays(2), OccurrenceStatus.MISSED),
                B2.occ(4, o, TODAY.minusDays(2), OccurrenceStatus.SKIPPED),
            ),
        )
        assertEquals(0.5f, s.completionRate, 1e-6f)
        assertEquals(1f, s.mandatoryCompletionRate, 1e-6f)
        val y = s.days.first { it.date == TODAY.minusDays(1) }
        assertEquals(1, y.total); assertEquals(1, y.completed); assertEquals(1, y.mandatoryTotal)
    }

    @Test fun futureAndOutOfRangeOccurrencesExcluded() {
        val o = B2.task(2, TaskKind.OPTIONAL)
        val s = compute(
            occ = listOf(
                B2.occ(1, o, TODAY, OccurrenceStatus.COMPLETED),
                B2.occ(2, o, TODAY.plusDays(1), OccurrenceStatus.PENDING),
                B2.occ(3, o, TODAY.minusDays(30), OccurrenceStatus.PENDING),
            ),
        )
        assertEquals(1f, s.completionRate)
        assertEquals(1, s.days.sumOf { it.total })
    }

    @Test fun focusMinutesAttributedToLocalStartDate() {
        // 22:30 UTC on the 3rd is 00:30 on the 4th in Jerusalem (UTC+2 in November).
        val lateUtc = Instant.parse("2026-11-03T22:30:00Z")
        val sessions = listOf(
            B2.session(1, lateUtc, 25),
            B2.session(2, B2.at(TODAY.minusDays(2), 9), 40, completed = false),
            B2.session(3, B2.at(TODAY.minusDays(10), 9), 60),
        )
        val s = compute(focus = sessions)
        assertEquals(25, s.days.first { it.date == TODAY }.focusMinutes)
        assertEquals(0, s.days.first { it.date == TODAY.minusDays(1) }.focusMinutes)
        assertEquals(40, s.days.first { it.date == TODAY.minusDays(2) }.focusMinutes)
        assertEquals(65, s.focusMinutesTotal)
        assertEquals(1, s.focusSessionsCompleted)

        val utc = compute(focus = sessions, zone = ZoneId.of("UTC"))
        assertEquals(25, utc.days.first { it.date == TODAY.minusDays(1) }.focusMinutes)
    }

    @Test fun categoryBreakdown_sortedWithUncategorized() {
        val cats = listOf(Category(1, "בריאות", "#00AA00", "heart"), Category(2, "לימודים", "#0000AA", "book"))
        val a = B2.task(1, TaskKind.OPTIONAL, categoryId = 1)
        val b = B2.task(2, TaskKind.OPTIONAL, categoryId = 2)
        val c = B2.task(3, TaskKind.OPTIONAL, categoryId = null)
        val s = compute(
            categories = cats,
            occ = listOf(
                B2.occ(1, b, TODAY), B2.occ(2, b, TODAY.minusDays(1)), B2.occ(3, a, TODAY),
                B2.occ(4, c, TODAY), B2.occ(5, a, TODAY.minusDays(1), OccurrenceStatus.MISSED),
            ),
        )
        assertEquals(listOf(2L, 1L, null), s.byCategory.map { it.categoryId })
        assertEquals("לימודים", s.byCategory[0].name)
        assertEquals(2, s.byCategory[0].completed)
        assertEquals(StatisticsCalculator.UNCATEGORIZED_NAME, s.byCategory[2].name)
    }

    @Test fun bypassCount_onlyInRange() {
        fun bp(i: Long, at: Instant) = BypassSession(i, at, at.plusSeconds(600), BypassReason.OTHER)
        val s = compute(bypasses = listOf(bp(1, B2.at(TODAY, 9)), bp(2, B2.at(TODAY.minusDays(6), 9)), bp(3, B2.at(TODAY.minusDays(7), 9))))
        assertEquals(2, s.bypassCount)
    }

    @Test fun trendDelta_inPercentagePoints() {
        val o = B2.task(2, TaskKind.OPTIONAL)
        val current = listOf(
            B2.occ(1, o, TODAY.minusDays(1), OccurrenceStatus.COMPLETED),
            B2.occ(2, o, TODAY.minusDays(2), OccurrenceStatus.COMPLETED),
            B2.occ(3, o, TODAY.minusDays(3), OccurrenceStatus.COMPLETED),
            B2.occ(4, o, TODAY.minusDays(4), OccurrenceStatus.MISSED),
        )
        val prev = listOf(
            B2.occ(10, o, TODAY.minusDays(8), OccurrenceStatus.COMPLETED),
            B2.occ(11, o, TODAY.minusDays(9), OccurrenceStatus.MISSED),
            B2.occ(12, o, TODAY.minusDays(10), OccurrenceStatus.SKIPPED),
        )
        val s = compute(occ = current, prev = prev)
        assertEquals(25f, s.trendDeltaPoints, 1e-4f) // 75% - 50%
        assertEquals(-100f, compute(occ = current.map { B2.occ(it.occurrence.id, o, it.occurrence.localDate, OccurrenceStatus.MISSED) }, prev = listOf(prev[0])).trendDeltaPoints, 1e-4f)
    }

    @Test fun trendDelta_zeroWhenPreviousPeriodEmpty() {
        val s = compute(occ = listOf(B2.occ(1, B2.task(2, TaskKind.OPTIONAL), TODAY)))
        assertEquals(0f, s.trendDeltaPoints)
    }

    @Test fun streaks_spanCurrentAndPreviousPeriod() {
        val days = (9L downTo 1L).map { TODAY.minusDays(it) to OccurrenceStatus.COMPLETED }
        val all = B2.mandatoryDays(*days.toTypedArray())
        val start = TODAY.minusDays(6)
        val s = compute(occ = all.filter { !it.occurrence.localDate.isBefore(start) }, prev = all.filter { it.occurrence.localDate.isBefore(start) })
        assertEquals(9, s.currentStreak)
        assertEquals(9, s.bestStreak)
    }

    @Test fun useCase_wiresRepositories() = runTest {
        val tasks = FakeTaskRepository()
        val o = B2.task(2, TaskKind.OPTIONAL)
        tasks.setOccurrences(listOf(B2.occ(1, o, TODAY), B2.occ(2, o, TODAY.minusDays(8), OccurrenceStatus.MISSED)))
        val focus = FakeFocusRepository().apply { sessions.value = listOf(B2.session(1, B2.at(TODAY, 8), 30)) }
        val blocker = FakeBlockerRepository().apply {
            bypasses.value = listOf(BypassSession(1, B2.at(TODAY, 9), B2.at(TODAY, 9).plusSeconds(60), BypassReason.HEALTH))
        }
        val s = ObserveStatisticsUseCase(tasks, focus, blocker, B2.timeAt())(StatsRange.WEEK).first()
        assertEquals(1f, s.completionRate)
        assertEquals(100f, s.trendDeltaPoints, 1e-4f)
        assertEquals(30, s.focusMinutesTotal)
        assertEquals(1, s.bypassCount)
    }
}
