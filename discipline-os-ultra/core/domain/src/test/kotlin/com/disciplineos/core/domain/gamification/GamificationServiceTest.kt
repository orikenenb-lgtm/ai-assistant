package com.disciplineos.core.domain.gamification

import com.disciplineos.core.domain.gamification.B2.TODAY
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalTime

class GamificationServiceTest {
    private val repo = FakeGamificationRepository()
    private val tasks = FakeTaskRepository()
    private val focus = FakeFocusRepository()
    private val service = GamificationService(repo, tasks, focus, B2.timeAt())

    private fun keys() = repo.events.value.map { it.dedupeKey }
    private fun unlocked() = repo.achievements.value.map { it.id }

    @Test fun occurrenceXp_awardedOnce_andFirstTaskUnlockedOnce() = runTest {
        val t = B2.task(1, TaskKind.OPTIONAL, Priority.HIGH)
        val o = B2.occ(7, t, TODAY)
        tasks.setOccurrences(listOf(o))
        service.onOccurrenceCompleted(t, o.occurrence)
        service.onOccurrenceCompleted(t, o.occurrence)

        assertEquals(1, keys().count { it == "occ:7" })
        assertEquals(25, repo.events.value.first { it.dedupeKey == "occ:7" }.amount)
        assertEquals(1, unlocked().count { it == AchievementIds.FIRST_TASK })
        assertEquals(1, keys().count { it == "ach:${AchievementIds.FIRST_TASK}" })
    }

    @Test fun mandatoryDayCleared_awardedOncePerDate_onlyWhenAllDone() = runTest {
        val a = B2.task(1); val b = B2.task(2)
        val oa = B2.occ(1, a, TODAY, OccurrenceStatus.COMPLETED)
        val ob = B2.occ(2, b, TODAY, OccurrenceStatus.PENDING)
        tasks.setOccurrences(listOf(oa, ob))
        service.onOccurrenceCompleted(a, oa.occurrence)
        assertFalse("day:$TODAY" in keys())

        val obDone = B2.occ(2, b, TODAY, OccurrenceStatus.COMPLETED)
        tasks.setOccurrences(listOf(oa, obDone))
        service.onOccurrenceCompleted(b, obDone.occurrence)
        service.checkDayCleared(TODAY)
        assertEquals(1, keys().count { it == "day:$TODAY" })
        assertTrue(AchievementIds.FIRST_MANDATORY_DAY in unlocked())
    }

    @Test fun dayWithOnlySkips_doesNotAwardXp() = runTest {
        tasks.setOccurrences(listOf(B2.occ(1, B2.task(1), TODAY, OccurrenceStatus.SKIPPED)))
        service.checkDayCleared(TODAY)
        assertFalse("day:$TODAY" in keys())
    }

    @Test fun focusSession_xpAndTenSessionsAchievement() = runTest {
        val sessions = (1L..10L).map { B2.session(it, B2.at(TODAY.minusDays(it), 10), 30) }
        focus.sessions.value = sessions
        sessions.forEach { service.onFocusSessionFinished(it) }
        service.onFocusSessionFinished(sessions.first())
        assertEquals(10, keys().count { it.startsWith("focus:") })
        assertTrue(AchievementIds.FOCUS_10_SESSIONS in unlocked())
        assertFalse(AchievementIds.FOCUS_10_HOURS in unlocked())
    }

    @Test fun abandonedFocus_awardsNothing() = runTest {
        val s = B2.session(5, B2.at(TODAY, 9), 20, completed = false)
        focus.sessions.value = listOf(s)
        service.onFocusSessionFinished(s)
        assertTrue(keys().none { it.startsWith("focus:") })
    }

    @Test fun earlyBird_unlockedForCompletionBefore8() = runTest {
        val t = B2.task(1, TaskKind.OPTIONAL)
        val o = B2.occ(1, t, TODAY, completedAt = B2.at(TODAY, 6, 45))
        tasks.setOccurrences(listOf(o))
        service.onOccurrenceCompleted(t, o.occurrence)
        assertTrue(AchievementIds.EARLY_BIRD in unlocked())
    }

    @Test fun streakAndComebackAchievements_fromHistory() = runTest {
        val days = listOf(TODAY.minusDays(5) to OccurrenceStatus.MISSED) +
            (4L downTo 1L).map { TODAY.minusDays(it) to OccurrenceStatus.COMPLETED }
        tasks.setOccurrences(B2.mandatoryDays(*days.toTypedArray()))
        service.checkDayCleared(TODAY.minusDays(1))
        assertTrue(AchievementIds.STREAK_3 in unlocked())
        assertTrue(AchievementIds.COMEBACK in unlocked())
        assertFalse(AchievementIds.STREAK_7 in unlocked())
    }

    @Test fun levelAchievements_viaXpIncludingAchievementRewards() = runTest {
        // Level 5 needs 100+150+200+250 = 700 XP.
        repo.awardXp(XpEvent(at = B2.at(TODAY, 9), amount = 690, source = XpSource.STREAK_BONUS, dedupeKey = "seed"))
        val t = B2.task(1, TaskKind.OPTIONAL, Priority.LOW)
        val o = B2.occ(1, t, TODAY)
        tasks.setOccurrences(listOf(o))
        service.onOccurrenceCompleted(t, o.occurrence) // +10 => 700, plus first_task reward
        assertTrue(AchievementIds.LEVEL_5 in unlocked())
        assertFalse(AchievementIds.LEVEL_10 in unlocked())
    }

    @Test fun achievementsAreIdempotentAcrossManyEvaluations() = runTest {
        val t = B2.task(1, TaskKind.OPTIONAL)
        val o = B2.occ(1, t, TODAY)
        tasks.setOccurrences(listOf(o))
        repeat(5) { service.onOccurrenceCompleted(t, o.occurrence); service.checkDayCleared(TODAY) }
        assertEquals(unlocked().size, unlocked().toSet().size)
        assertEquals(keys().size, keys().toSet().size)
    }

    @Test fun weeklyReview_awardedOncePerWeek_andUnlocks() = runTest {
        service.onWeeklyReviewCompleted(TODAY.minusDays(3))
        service.onWeeklyReviewCompleted(TODAY.minusDays(3))
        assertEquals(1, keys().count { it.startsWith("review:") })
        assertTrue(AchievementIds.WEEKLY_REVIEW in unlocked())
    }

    @Test fun observeProgress_combinesXpAndStreak_andRecordsFreeze() = runTest {
        val days = (10L downTo 4L).map { TODAY.minusDays(it) to OccurrenceStatus.COMPLETED } +
            listOf(TODAY.minusDays(3) to OccurrenceStatus.PENDING, TODAY.minusDays(2) to OccurrenceStatus.COMPLETED)
        tasks.setOccurrences(B2.mandatoryDays(*days.toTypedArray()))
        repo.awardXp(XpEvent(at = B2.at(TODAY, 9), amount = 120, source = XpSource.TASK_COMPLETED, dedupeKey = "occ:x"))

        val p = service.observeProgress().first()
        assertEquals(120L, p.totalXp)
        assertEquals(2, p.level)
        assertEquals(20L, p.xpIntoLevel)
        assertEquals(8, p.currentStreakDays)
        assertEquals(0, p.streakFreezesAvailable)
        assertEquals(listOf(TODAY.minusDays(3)), repo.freezesUsed)
        service.observeProgress().first()
        assertEquals(1, repo.freezesUsed.size)
    }

    @Test fun observeProgress_ignoresHistoryOutsideWindow() = runTest {
        val old = TODAY.minusDays(GamificationService.WINDOW_DAYS + 5)
        tasks.setOccurrences(B2.mandatoryDays(old to OccurrenceStatus.COMPLETED))
        assertEquals(0, service.observeProgress().first().bestStreakDays)
    }

    @Test fun observeAchievements_mapsWholeCatalog() = runTest {
        repo.unlockAchievement(AchievementIds.STREAK_3, B2.at(TODAY, 9))
        val views = service.observeAchievements().first()
        assertEquals(AchievementCatalog.all.size, views.size)
        assertEquals(B2.at(TODAY, 9), views.first { it.def.id == AchievementIds.STREAK_3 }.unlockedAt)
        assertNull(views.first { it.def.id == AchievementIds.STREAK_30 }.unlockedAt)
    }
}

class WeeklyReviewTest {
    private val weekStart = TODAY.minusDays(3)
    private val shaming = listOf("נכשל", "כישלון", "עצלן", "גרוע", "מאכזב", "בושה")

    private fun assertSupportive(r: WeeklyReview) {
        (r.highlightsHe + r.suggestionsHe).forEach { line -> shaming.forEach { assertFalse("$line contains $it", line.contains(it)) } }
        assertTrue(r.highlightsHe.isNotEmpty())
        assertTrue(r.suggestionsHe.isNotEmpty())
    }

    @Test fun emptyWeek_noNaN_andEncouraging() {
        val r = WeeklyReviewCalculator.build(weekStart, TODAY, emptyList(), emptyList(), emptyList(), B2.ZONE)
        assertEquals(0, r.completed); assertEquals(0, r.total)
        assertEquals(0f, r.mandatoryCompletionRate)
        assertFalse(r.mandatoryCompletionRate.isNaN())
        assertNull(r.bestDay)
        assertSupportive(r)
    }

    @Test fun weekWithData_countsAndBestDay() {
        val m = B2.task(1); val o = B2.task(2, TaskKind.OPTIONAL)
        val occ = listOf(
            B2.occ(1, m, weekStart, OccurrenceStatus.COMPLETED),
            B2.occ(2, o, weekStart.plusDays(1), OccurrenceStatus.COMPLETED),
            B2.occ(3, m, weekStart.plusDays(1), OccurrenceStatus.COMPLETED),
            B2.occ(4, m, weekStart.plusDays(2), OccurrenceStatus.MISSED),
            B2.occ(5, o, weekStart.plusDays(2), OccurrenceStatus.SKIPPED),
            B2.occ(6, m, TODAY.plusDays(1), OccurrenceStatus.PENDING), // future: excluded
        )
        val sessions = listOf(B2.session(1, B2.at(weekStart, 10), 50), B2.session(2, B2.at(weekStart.minusDays(1), 10), 50))
        val events = listOf(
            XpEvent(at = B2.at(weekStart, 11), amount = 40, source = XpSource.TASK_COMPLETED, dedupeKey = "a"),
            XpEvent(at = B2.at(weekStart.minusDays(1), 11), amount = 999, source = XpSource.TASK_COMPLETED, dedupeKey = "b"),
        )
        val r = WeeklyReviewCalculator.build(weekStart, TODAY, occ, sessions, events, B2.ZONE)
        assertEquals(3, r.completed)
        assertEquals(4, r.total)
        assertEquals(2f / 3f, r.mandatoryCompletionRate, 1e-6f)
        assertEquals(50, r.focusMinutes)
        assertEquals(40, r.xpEarned)
        assertEquals(weekStart.plusDays(1), r.bestDay)
        assertSupportive(r)
    }

    @Test fun useCase_wiresRepositories() = runTest {
        val tasks = FakeTaskRepository().apply { setOccurrences(listOf(B2.occ(1, B2.task(1), weekStart))) }
        val r = WeeklyReviewUseCase(tasks, FakeFocusRepository(), FakeGamificationRepository(), B2.timeAt(TODAY, LocalTime.of(20, 0)))(weekStart).first()
        assertEquals(1, r.completed)
        assertEquals(1f, r.mandatoryCompletionRate)
    }
}
