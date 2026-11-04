package com.disciplineos.core.domain.gamification

import app.cash.turbine.test
import com.disciplineos.core.domain.focus.MutableTimeProvider
import com.disciplineos.core.domain.gamification.B2.TODAY
import com.disciplineos.core.domain.stats.ObserveStatisticsUseCase
import com.disciplineos.core.domain.stats.StatsRange
import com.disciplineos.core.domain.time.observeLocalDate
import com.disciplineos.core.model.OccurrenceStatus
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Duration
import java.time.LocalTime

/** Long-lived progress/statistics flows must follow the local date across midnight without re-subscribing. */
@OptIn(ExperimentalCoroutinesApi::class)
class MidnightRolloverTest {
    private val tick = 60_000L
    private val clock = MutableTimeProvider(TODAY.atTime(LocalTime.of(23, 58)).atZone(B2.ZONE).toInstant(), B2.ZONE)
    private val repo = FakeGamificationRepository()
    private val tasks = FakeTaskRepository()
    private val focus = FakeFocusRepository()

    /** Yesterday cleared, today's mandatory task still pending: streak 1 today, broken once today becomes the past. */
    private fun seedPendingToday() {
        tasks.setOccurrences(
            B2.mandatoryDays(TODAY.minusDays(1) to OccurrenceStatus.COMPLETED, TODAY to OccurrenceStatus.PENDING),
        )
    }

    @Test fun localDateFlow_emitsOnlyOnDateChange() = runTest {
        clock.observeLocalDate(tick).test {
            assertEquals(TODAY, awaitItem())
            advanceTimeBy(tick); runCurrent() // 23:58 -> still the same date: no emission
            expectNoEvents()
            clock.advanceMinutes(3) // 00:01 next day
            advanceTimeBy(tick); runCurrent()
            assertEquals(TODAY.plusDays(1), awaitItem())
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun observeProgress_followsMidnight() = runTest {
        seedPendingToday()
        val service = GamificationService(repo, tasks, focus, clock)
        service.observeProgress(tick).test {
            assertEquals(1, awaitItem().currentStreakDays)
            clock.advanceMinutes(3) // past midnight: yesterday's pending mandatory task is now a FAILED day
            advanceTimeBy(tick); runCurrent()
            val after = awaitItem()
            assertEquals(0, after.currentStreakDays)
            assertEquals(1, after.bestStreakDays)
            cancelAndIgnoreRemainingEvents()
        }
        // Reading progress never records freezes.
        assertEquals(emptyList<java.time.LocalDate>(), repo.freezesUsed)
    }

    @Test fun observeStatistics_followsMidnight() = runTest {
        seedPendingToday()
        val useCase = ObserveStatisticsUseCase(tasks, focus, FakeBlockerRepository(), clock)
        useCase(StatsRange.WEEK, tick).test {
            val before = awaitItem()
            assertEquals(TODAY, before.days.last().date)
            assertEquals(1, before.currentStreak)
            clock.advance(Duration.ofMinutes(3))
            advanceTimeBy(tick); runCurrent()
            val after = awaitItem()
            assertEquals(TODAY.plusDays(1), after.days.last().date)
            assertEquals(0, after.currentStreak)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
