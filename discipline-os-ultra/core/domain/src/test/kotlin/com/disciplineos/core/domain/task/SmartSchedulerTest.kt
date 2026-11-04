package com.disciplineos.core.domain.task

import com.disciplineos.core.model.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class SmartSchedulerTest {

    private val mon = d("2026-11-02")
    private val tue = d("2026-11-03")

    private fun item(
        occId: Long,
        taskId: Long = occId,
        date: LocalDate = mon,
        minutes: Int? = 30,
        kind: TaskKind = TaskKind.OPTIONAL,
        priority: Priority = Priority.MEDIUM,
        dueAt: Instant? = null,
        dependsOn: Set<Long> = emptySet(),
        recurrence: RecurrenceRule = RecurrenceRule.Daily(1),
        status: OccurrenceStatus = OccurrenceStatus.PENDING,
    ) = OccurrenceWithTask(
        TaskOccurrence(id = occId, taskId = taskId, localDate = date, dueAt = dueAt, status = status),
        task(id = taskId, title = "t$taskId", kind = kind, priority = priority, estimatedMinutes = minutes,
            dependsOn = dependsOn, recurrence = recurrence, startDate = date),
    )

    private fun window(date: LocalDate, start: String, end: String) = AvailabilityWindow(date, t(start), t(end))

    private fun WeeklyPlan.order() = blocks.map { it.occurrenceId }
    private fun WeeklyPlan.block(occId: Long) = blocks.single { it.occurrenceId == occId }

    @Test fun empty_inputs() {
        assertEquals(WeeklyPlan(emptyList(), emptyList()), SmartScheduler.plan(emptyList(), emptyList()))
        assertEquals(WeeklyPlan(emptyList(), listOf(1L)), SmartScheduler.plan(listOf(item(1)), emptyList()))
    }

    @Test fun ordering_mandatoryThenPriorityThenDueThenEstimate() {
        val items = listOf(
            item(1, priority = Priority.LOW),
            item(2, kind = TaskKind.MANDATORY, priority = Priority.LOW),
            item(3, priority = Priority.CRITICAL),
            item(4, kind = TaskKind.MANDATORY, priority = Priority.HIGH, dueAt = Instant.parse("2026-11-02T15:00:00Z")),
            item(5, kind = TaskKind.MANDATORY, priority = Priority.HIGH, dueAt = Instant.parse("2026-11-02T10:00:00Z")),
            item(6, kind = TaskKind.MANDATORY, priority = Priority.HIGH, dueAt = Instant.parse("2026-11-02T15:00:00Z"), minutes = 15),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "08:00", "18:00")))
        assertEquals(listOf(5L, 6L, 4L, 2L, 3L, 1L), plan.order())
        assertEquals(t("08:00"), plan.block(5).start)
        assertEquals(t("08:30"), plan.block(5).end)
        assertEquals(t("08:30"), plan.block(6).start)
        assertEquals(t("08:45"), plan.block(6).end)
        assertTrue(plan.unscheduled.isEmpty())
    }

    @Test fun dependencies_comeFirst_evenAgainstPriority() {
        val items = listOf(
            item(1, taskId = 10, kind = TaskKind.MANDATORY, priority = Priority.CRITICAL, dependsOn = setOf(20)),
            item(2, taskId = 20, priority = Priority.LOW),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "12:00")))
        assertEquals(listOf(2L, 1L), plan.order())
        assertTrue(!plan.block(1).start.isBefore(plan.block(2).end))
    }

    @Test fun dependency_startsAfterPrerequisiteEnds_evenIfEarlierGapExists() {
        // Prerequisite only fits in the second window; dependent must start after it although window 1 has room.
        val items = listOf(
            item(1, taskId = 10, dependsOn = setOf(20), minutes = 30),
            item(2, taskId = 20, minutes = 90),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "08:00", "09:00"), window(mon, "13:00", "15:00")))
        assertEquals(t("13:00"), plan.block(2).start)
        assertEquals(t("14:30"), plan.block(1).start)
    }

    @Test fun dependency_onDifferentDateRecurring_isNotAnEdge() {
        val items = listOf(
            item(1, taskId = 10, date = mon, dependsOn = setOf(20), priority = Priority.HIGH),
            item(2, taskId = 20, date = tue),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "10:00"), window(tue, "09:00", "10:00")))
        assertEquals(mon, plan.block(1).date)
        assertEquals(tue, plan.block(2).date)
    }

    @Test fun oneOffDependency_onLaterDate_pushesDependentLater() {
        val items = listOf(
            item(1, taskId = 10, date = mon, dependsOn = setOf(20)),
            item(2, taskId = 20, date = tue, recurrence = RecurrenceRule.None),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "10:00"), window(tue, "09:00", "11:00")))
        assertEquals(tue, plan.block(2).date)
        assertEquals(tue, plan.block(1).date)
        assertEquals(t("09:30"), plan.block(1).start)
    }

    @Test fun unschedulableDependency_makesDependentUnscheduled() {
        val items = listOf(
            item(1, taskId = 10, dependsOn = setOf(20), minutes = 15),
            item(2, taskId = 20, minutes = 600),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "12:00")))
        assertTrue(plan.blocks.isEmpty())
        assertEquals(listOf(2L, 1L), plan.unscheduled)
    }

    @Test fun cycle_isHandledDeterministically() {
        val items = listOf(
            item(1, taskId = 10, dependsOn = setOf(20), priority = Priority.HIGH),
            item(2, taskId = 20, dependsOn = setOf(10)),
        )
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "12:00")))
        assertEquals(listOf(1L, 2L), plan.order())
    }

    @Test fun neverPlacesBeforeOccurrenceDate_andNeverOverlaps() {
        val items = (1L..6L).map { item(it, date = if (it % 2 == 0L) tue else mon, minutes = 45) }
        val windows = listOf(window(mon, "09:00", "10:30"), window(tue, "09:00", "12:00"))
        val plan = SmartScheduler.plan(items, windows)
        for (b in plan.blocks) {
            val occDate = items.single { it.occurrence.id == b.occurrenceId }.occurrence.localDate
            assertTrue(!b.date.isBefore(occDate))
        }
        plan.blocks.groupBy { it.date }.values.forEach { day ->
            day.sortedBy { it.start }.zipWithNext().forEach { (a, b) -> assertTrue("$a overlaps $b", !b.start.isBefore(a.end)) }
        }
        // Mon fits 2×45; third Monday item spills into Tuesday; Tue fits 4×45 total → 6 placed? 3 Tue items + 1 spill = 4 = 180 min.
        assertEquals(6, plan.blocks.size)
        assertTrue(plan.unscheduled.isEmpty())
    }

    @Test fun unfittable_goesToUnscheduled_smallerItemsStillFit() {
        val items = listOf(item(1, minutes = 120, priority = Priority.HIGH), item(2, minutes = 30))
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "10:00")))
        assertEquals(listOf(1L), plan.unscheduled)
        assertEquals(t("09:00"), plan.block(2).start)
    }

    @Test fun defaultMinutes_usedWhenNoEstimate() {
        val plan = SmartScheduler.plan(listOf(item(1, minutes = null)), listOf(window(mon, "09:00", "10:00")), defaultMinutes = 50)
        assertEquals(t("09:50"), plan.block(1).end)
    }

    @Test fun overlappingWindows_areMerged_invalidWindowsIgnored() {
        val items = listOf(item(1, minutes = 90))
        val windows = listOf(window(mon, "09:00", "10:00"), window(mon, "09:30", "10:30"), window(mon, "12:00", "11:00"))
        val plan = SmartScheduler.plan(items, windows)
        assertEquals(t("09:00"), plan.block(1).start)
        assertEquals(t("10:30"), plan.block(1).end)
    }

    @Test fun nonPendingItems_areIgnored() {
        val items = listOf(item(1, status = OccurrenceStatus.COMPLETED), item(2, status = OccurrenceStatus.SKIPPED), item(3))
        val plan = SmartScheduler.plan(items, listOf(window(mon, "09:00", "10:00")))
        assertEquals(listOf(3L), plan.order())
        assertTrue(plan.unscheduled.isEmpty())
    }

    @Test fun isDeterministic_regardlessOfInputOrder() {
        val items = (1L..8L).map { item(it, priority = Priority.values()[(it % 4).toInt()], minutes = (it * 10).toInt()) }
        val windows = listOf(window(mon, "09:00", "11:00"), window(tue, "09:00", "10:00"))
        val a = SmartScheduler.plan(items, windows)
        val b = SmartScheduler.plan(items.reversed(), windows.reversed())
        assertEquals(a, b)
    }

    @Test fun blockEndingAtMidnight() {
        val plan = SmartScheduler.plan(listOf(item(1, minutes = 60)), listOf(AvailabilityWindow(mon, t("23:00"), java.time.LocalTime.MAX)))
        assertEquals(t("23:00"), plan.block(1).start)
    }
}
