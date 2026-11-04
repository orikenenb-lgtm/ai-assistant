package com.disciplineos.core.domain.task

import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.take
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ObservePlanUseCasesTest {

    private val today = d("2026-11-04")
    private val repo = FakeTaskRepository()
    private val time = fixedTime(today)
    private val materializer = OccurrenceMaterializer(repo, time)
    private val dayPlan = ObserveDayPlanUseCase(repo, time)
    private val week = ObserveWeekUseCase(repo, time)

    private suspend fun add(t: Task): Long = repo.upsertTask(t).also { materializer.rematerializeTask(it) }

    private suspend fun setStatus(taskId: Long, date: java.time.LocalDate, status: OccurrenceStatus) {
        repo.updateOccurrence(repo.occurrence(taskId, date).copy(status = status))
    }

    @Test fun dayPlan_splitsAndSorts() = runTest {
        val optHigh = add(task(title = "opt-high", startDate = today, priority = Priority.HIGH))
        val manLowEarly = add(task(title = "man-low-early", startDate = today, kind = TaskKind.MANDATORY, priority = Priority.LOW, dueTime = t("07:00")))
        val manHighLate = add(task(title = "man-high-late", startDate = today, kind = TaskKind.MANDATORY, priority = Priority.HIGH, dueTime = t("20:00")))
        val manHighEarly = add(task(title = "man-high-early", startDate = today, kind = TaskKind.MANDATORY, priority = Priority.HIGH, dueTime = t("08:00")))
        val manHighNoTime = add(task(title = "man-high-anytime", startDate = today, kind = TaskKind.MANDATORY, priority = Priority.HIGH))
        val optLow = add(task(title = "opt-low", startDate = today, priority = Priority.LOW))
        add(task(title = "tomorrow", startDate = today.plusDays(1), kind = TaskKind.MANDATORY))

        val plan = dayPlan(today).first()
        assertEquals(listOf(manHighEarly, manHighLate, manHighNoTime, manLowEarly), plan.mandatory.map { it.task.id })
        assertEquals(listOf(optHigh, optLow), plan.optional.map { it.task.id })
        assertTrue(plan.overdue.isEmpty())
        assertEquals(0, plan.completedCount)
        assertEquals(6, plan.totalCount)
    }

    @Test fun dayPlan_overdueMandatoryCarryOver_onlyPendingMandatoryFromEarlierDays() = runTest {
        val man = add(task(title = "man", startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1), kind = TaskKind.MANDATORY))
        val opt = add(task(title = "opt", startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow(d("2026-11-01"), today)
        setStatus(man, d("2026-11-02"), OccurrenceStatus.COMPLETED)
        setStatus(man, d("2026-11-03"), OccurrenceStatus.MISSED)

        val plan = dayPlan(today).first()
        assertEquals(listOf(d("2026-11-01")), plan.overdue.map { it.occurrence.localDate })
        assertTrue(plan.overdue.all { it.task.id == man })
        assertFalse(plan.allMandatoryDone)
        assertEquals(listOf(man), plan.mandatory.map { it.task.id })
        assertEquals(listOf(opt), plan.optional.map { it.task.id })
    }

    @Test fun dayPlan_counts_excludeSkippedFromTotal() = runTest {
        val a = add(task(title = "a", startDate = today, kind = TaskKind.MANDATORY))
        val b = add(task(title = "b", startDate = today))
        val c = add(task(title = "c", startDate = today))
        add(task(title = "d", startDate = today))
        setStatus(a, today, OccurrenceStatus.COMPLETED)
        setStatus(b, today, OccurrenceStatus.SKIPPED)
        setStatus(c, today, OccurrenceStatus.COMPLETED)
        val plan = dayPlan(today).first()
        assertEquals(2, plan.completedCount)
        assertEquals(3, plan.totalCount)
        assertEquals(2f / 3f, plan.progress, 0.0001f)
        assertTrue(plan.allMandatoryDone)
    }

    @Test fun dayPlan_emptyDay() = runTest {
        val plan = dayPlan(today).first()
        assertEquals(DayPlan(today, emptyList(), emptyList(), emptyList(), 0, 0), plan)
        assertEquals(0f, plan.progress)
        assertTrue(plan.allMandatoryDone)
    }

    @Test fun dayPlan_reEmitsOnRepositoryChange() = runTest(UnconfinedTestDispatcher()) {
        val id = add(task(title = "x", startDate = today, kind = TaskKind.MANDATORY))
        val emissions = mutableListOf<DayPlan>()
        val job = launch { dayPlan(today).take(2).toList(emissions) }
        setStatus(id, today, OccurrenceStatus.COMPLETED)
        job.join()
        assertEquals(listOf(0, 1), emissions.map { it.completedCount })
    }

    @Test fun week_returnsSevenPlans_withPerDayContent() = runTest {
        val weekStart = d("2026-11-01")
        val daily = add(task(title = "daily", startDate = weekStart, recurrence = RecurrenceRule.Daily(1), kind = TaskKind.MANDATORY))
        materializer.materializeWindow(weekStart, weekStart.plusDays(6))
        add(task(title = "fri", startDate = d("2026-11-06")))
        setStatus(daily, d("2026-11-02"), OccurrenceStatus.COMPLETED)

        val plans = week(weekStart).first()
        assertEquals((0L..6L).map { weekStart.plusDays(it) }, plans.map { it.date })
        assertTrue(plans.all { p -> p.mandatory.single().occurrence.localDate == p.date })
        assertEquals(1, plans[1].completedCount)
        assertEquals(2, plans[5].totalCount) // Friday: daily + one-off
        // Sunday 1 Nov left pending → overdue on Mon 2..Wed 4 (today); future days carry only already-overdue items.
        assertTrue(plans[0].overdue.isEmpty())
        assertEquals(listOf(d("2026-11-01")), plans[1].overdue.map { it.occurrence.localDate })
        assertEquals(listOf(d("2026-11-01"), d("2026-11-03")), plans[3].overdue.map { it.occurrence.localDate })
        assertEquals(listOf(d("2026-11-01"), d("2026-11-03")), plans[6].overdue.map { it.occurrence.localDate })
    }

    @Test fun week_matchesDayPlanForToday() = runTest {
        add(task(title = "a", startDate = d("2026-11-02"), kind = TaskKind.MANDATORY))
        add(task(title = "b", startDate = today, priority = Priority.CRITICAL))
        val plans = week(d("2026-11-01")).first()
        assertEquals(dayPlan(today).first(), plans[3])
    }
}
