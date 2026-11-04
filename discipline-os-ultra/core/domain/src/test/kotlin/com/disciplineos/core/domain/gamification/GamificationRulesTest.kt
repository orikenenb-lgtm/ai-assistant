package com.disciplineos.core.domain.gamification

import com.disciplineos.core.domain.gamification.B2.TODAY
import com.disciplineos.core.model.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class LevelCurveTest {
    @Test fun xpToNext_isGentleAndStrictlyMonotonic() {
        assertEquals(100L, LevelCurve.xpToNext(1))
        assertEquals(150L, LevelCurve.xpToNext(2))
        assertEquals(550L, LevelCurve.xpToNext(10))
        for (l in 1..500) assertTrue(LevelCurve.xpToNext(l + 1) > LevelCurve.xpToNext(l))
    }

    @Test fun xpToNext_clampsInvalidLevels() {
        assertEquals(100L, LevelCurve.xpToNext(0))
        assertEquals(100L, LevelCurve.xpToNext(-5))
    }

    @Test fun progressFor_boundaries() {
        LevelCurve.progressFor(0, 0, 0, 0).let { assertEquals(1, it.level); assertEquals(0L, it.xpIntoLevel); assertEquals(100L, it.xpForNextLevel) }
        LevelCurve.progressFor(99, 0, 0, 0).let { assertEquals(1, it.level); assertEquals(99L, it.xpIntoLevel) }
        LevelCurve.progressFor(100, 0, 0, 0).let { assertEquals(2, it.level); assertEquals(0L, it.xpIntoLevel); assertEquals(150L, it.xpForNextLevel) }
        LevelCurve.progressFor(249, 0, 0, 0).let { assertEquals(2, it.level); assertEquals(149L, it.xpIntoLevel) }
        LevelCurve.progressFor(250, 0, 0, 0).let { assertEquals(3, it.level); assertEquals(0L, it.xpIntoLevel) }
        LevelCurve.progressFor(-40, 0, 0, 0).let { assertEquals(1, it.level); assertEquals(0L, it.totalXp) }
    }

    @Test fun progressFor_levelNeverDecreasesAsXpGrows() {
        var last = 1
        for (xp in 0L..20_000L step 37) {
            val p = LevelCurve.progressFor(xp, 0, 0, 0)
            assertTrue(p.level >= last)
            assertTrue(p.xpIntoLevel in 0 until p.xpForNextLevel)
            last = p.level
        }
    }

    @Test fun progressFor_carriesStreakAndFreezes() {
        val p = LevelCurve.progressFor(10, currentStreak = 4, bestStreak = 9, freezes = 2)
        assertEquals(4, p.currentStreakDays); assertEquals(9, p.bestStreakDays); assertEquals(2, p.streakFreezesAvailable)
    }
}

class XpRulesTest {
    private fun xp(kind: TaskKind, p: Priority) = XpRules.forOccurrence(B2.task(1, kind, p), B2.occ(1, B2.task(1, kind, p), TODAY).occurrence)

    @Test fun occurrenceXp_byPriorityAndKind() {
        assertEquals(10, xp(TaskKind.OPTIONAL, Priority.LOW))
        assertEquals(15, xp(TaskKind.OPTIONAL, Priority.MEDIUM))
        assertEquals(25, xp(TaskKind.OPTIONAL, Priority.HIGH))
        assertEquals(40, xp(TaskKind.OPTIONAL, Priority.CRITICAL))
        assertEquals(20, xp(TaskKind.MANDATORY, Priority.LOW))
        assertEquals(50, xp(TaskKind.MANDATORY, Priority.CRITICAL))
    }

    @Test fun focusXp_onePerMinuteCappedAndOnlyWhenCompleted() {
        val start = Instant.parse("2026-11-04T08:00:00Z")
        assertEquals(25, XpRules.forFocus(B2.session(1, start, 25)))
        assertEquals(60, XpRules.forFocus(B2.session(1, start, 90)))
        assertEquals(0, XpRules.forFocus(B2.session(1, start, 25, completed = false)))
        assertEquals(0, XpRules.forFocus(B2.session(1, start, 0)))
        assertEquals(0, XpRules.forFocus(B2.session(1, start, 1).copy(focusedSeconds = 59)))
        assertEquals(0, XpRules.forFocus(B2.session(1, start, 1).copy(focusedSeconds = -100)))
    }
}

class StreakCalculatorTest {
    private fun d(back: Long): LocalDate = TODAY.minusDays(back)
    private val C = DayOutcome.CLEARED
    private val F = DayOutcome.FAILED
    private val N = DayOutcome.NEUTRAL
    private val Z = DayOutcome.FROZEN

    @Test fun empty_isZero() = assertEquals(StreakResult(0, 0), StreakCalculator.compute(emptyMap(), TODAY))

    @Test fun endingYesterday_todayInProgressDoesNotBreak() {
        val r = StreakCalculator.compute(mapOf(d(3) to C, d(2) to C, d(1) to C), TODAY)
        assertEquals(StreakResult(3, 3), r)
        assertEquals(3, StreakCalculator.compute(mapOf(d(2) to C, d(1) to C, d(0) to N, d(3) to C), TODAY).current)
    }

    @Test fun todayCleared_counts() = assertEquals(4, StreakCalculator.compute(mapOf(d(3) to C, d(2) to C, d(1) to C, d(0) to C), TODAY).current)

    @Test fun todayFailed_isTreatedAsInProgress() = assertEquals(2, StreakCalculator.compute(mapOf(d(2) to C, d(1) to C, d(0) to F), TODAY).current)

    @Test fun failedDay_breaksCurrentButBestRemembers() {
        val r = StreakCalculator.compute(mapOf(d(6) to C, d(5) to C, d(4) to C, d(3) to C, d(2) to F, d(1) to C), TODAY)
        assertEquals(1, r.current)
        assertEquals(4, r.best)
    }

    @Test fun yesterdayFailed_resetsToZero() = assertEquals(StreakResult(0, 2), StreakCalculator.compute(mapOf(d(3) to C, d(2) to C, d(1) to F), TODAY))

    @Test fun neutralAndMissingDays_preserveWithoutAdding() {
        val r = StreakCalculator.compute(mapOf(d(8) to C, d(7) to N, d(5) to C, d(1) to C), TODAY)
        assertEquals(3, r.current)
    }

    @Test fun frozen_preservesWithoutAdding() {
        val r = StreakCalculator.compute(mapOf(d(3) to C, d(2) to Z, d(1) to C), TODAY)
        assertEquals(StreakResult(2, 2), r)
    }

    @Test fun futureEntries_ignored() {
        val r = StreakCalculator.compute(mapOf(d(1) to C, TODAY.plusDays(1) to C, TODAY.plusDays(2) to F), TODAY)
        assertEquals(StreakResult(1, 1), r)
    }
}

class StreakEngineTest {
    private fun d(back: Long): LocalDate = TODAY.minusDays(back)

    @Test fun rawOutcomes_rules() {
        val m = B2.task(1)
        val opt = B2.task(2, TaskKind.OPTIONAL)
        val occ = listOf(
            B2.occ(1, m, d(3), OccurrenceStatus.COMPLETED),
            B2.occ(2, m, d(2), OccurrenceStatus.SKIPPED),
            B2.occ(3, m, d(1), OccurrenceStatus.PENDING),
            B2.occ(4, opt, d(4), OccurrenceStatus.MISSED),
            B2.occ(5, m, d(0), OccurrenceStatus.PENDING),
            B2.occ(6, m, d(5), OccurrenceStatus.MISSED),
            B2.occ(7, m, d(5), OccurrenceStatus.COMPLETED),
        )
        val raw = StreakEngine.rawOutcomes(occ, TODAY)
        assertEquals(DayOutcome.CLEARED, raw[d(3)])
        assertEquals(DayOutcome.CLEARED, raw[d(2)])
        assertEquals(DayOutcome.FAILED, raw[d(1)])
        assertEquals(null, raw[d(4)]) // optional-only day is neutral (absent)
        assertEquals(DayOutcome.NEUTRAL, raw[d(0)]) // today still in progress
        assertEquals(DayOutcome.FAILED, raw[d(5)])
    }

    @Test fun freezeEarnedAtSevenDayMilestone_coversNextFailure() {
        val days = (10L downTo 4L).map { d(it) to OccurrenceStatus.COMPLETED } +
            listOf(d(3) to OccurrenceStatus.MISSED, d(2) to OccurrenceStatus.COMPLETED, d(1) to OccurrenceStatus.COMPLETED)
        val e = StreakEngine.evaluate(B2.mandatoryDays(*days.toTypedArray()), TODAY)
        assertEquals(listOf(d(3)), e.frozenDates)
        assertEquals(DayOutcome.FROZEN, e.outcomes[d(3)])
        assertEquals(9, e.streak.current)
        assertEquals(0, e.freezesAvailable)
    }

    @Test fun withoutFreeze_failureBreaks() {
        val e = StreakEngine.evaluate(
            B2.mandatoryDays(d(4) to OccurrenceStatus.COMPLETED, d(3) to OccurrenceStatus.MISSED, d(2) to OccurrenceStatus.COMPLETED),
            TODAY,
        )
        assertTrue(e.frozenDates.isEmpty())
        assertEquals(1, e.streak.current)
    }

    @Test fun freezesCappedAtTwo() {
        val days = (30L downTo 1L).map { d(it) to OccurrenceStatus.COMPLETED }
        val e = StreakEngine.evaluate(B2.mandatoryDays(*days.toTypedArray()), TODAY)
        assertEquals(StreakEngine.MAX_FREEZES, e.freezesAvailable)
        assertEquals(30, e.streak.current)
    }

    @Test fun pendingToday_neverConsumesFreeze() {
        val days = (7L downTo 1L).map { d(it) to OccurrenceStatus.COMPLETED } + (d(0) to OccurrenceStatus.PENDING)
        val e = StreakEngine.evaluate(B2.mandatoryDays(*days.toTypedArray()), TODAY)
        assertEquals(1, e.freezesAvailable)
        assertEquals(7, e.streak.current)
    }

    @Test fun deterministic() {
        val days = (40L downTo 0L).map { d(it) to if (it % 9 == 0L) OccurrenceStatus.MISSED else OccurrenceStatus.COMPLETED }
        val input = B2.mandatoryDays(*days.toTypedArray())
        assertEquals(StreakEngine.evaluate(input, TODAY), StreakEngine.evaluate(input.shuffled(java.util.Random(7)), TODAY))
    }
}

class AchievementCatalogTest {
    @Test fun catalog_hasUniqueIdsAndHebrewCopy() {
        val all = AchievementCatalog.all
        assertTrue(all.size >= 12)
        assertEquals(all.size, all.map { it.id }.toSet().size)
        val hebrew = Regex("[\\u0590-\\u05FF]")
        all.forEach {
            assertTrue(it.id, hebrew.containsMatchIn(it.titleHe))
            assertTrue(it.id, hebrew.containsMatchIn(it.descriptionHe))
            assertTrue(it.xpReward >= 0)
        }
    }

    @Test fun comebackCopy_isEncouraging() {
        val c = AchievementCatalog.byId(AchievementIds.COMEBACK)!!
        assertFalse(c.descriptionHe.contains("נכשל"))
    }

    @Test fun comebackRule_usesMostRecentNonNeutralDay() {
        val d = { back: Long -> TODAY.minusDays(back) }
        assertTrue(AchievementRules.hasComeback(mapOf(d(3) to DayOutcome.FAILED, d(2) to DayOutcome.NEUTRAL, d(1) to DayOutcome.CLEARED)))
        assertFalse(AchievementRules.hasComeback(mapOf(d(3) to DayOutcome.FAILED, d(2) to DayOutcome.FAILED)))
        assertFalse(AchievementRules.hasComeback(mapOf(d(3) to DayOutcome.CLEARED, d(2) to DayOutcome.CLEARED)))
    }

    @Test fun earlyBirdWindow() {
        assertTrue(AchievementRules.isEarlyBird(B2.at(TODAY, 7, 59), B2.ZONE))
        assertTrue(AchievementRules.isEarlyBird(B2.at(TODAY, 4, 0), B2.ZONE))
        assertFalse(AchievementRules.isEarlyBird(B2.at(TODAY, 8, 0), B2.ZONE))
        assertFalse(AchievementRules.isEarlyBird(B2.at(TODAY, 2, 30), B2.ZONE))
    }
}
