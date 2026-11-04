package com.disciplineos.app.data

import com.disciplineos.app.work.ReminderPlanner
import com.disciplineos.app.work.ReminderSpec
import com.disciplineos.app.work.WorkTiming
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskOccurrence
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ReminderPlannerTest {
    private val zone = ZoneId.of("Asia/Jerusalem")
    private val now = ZonedDateTime.of(2026, 11, 4, 9, 0, 0, 0, zone).toInstant()
    private val endOfDay: (LocalDate, ZoneId) -> Instant = { d, z -> d.plusDays(1).atStartOfDay(z).toInstant() }

    private fun item(
        occId: Long,
        dueAt: Instant?,
        offsets: List<Int>,
        status: OccurrenceStatus = OccurrenceStatus.PENDING,
        snoozedUntil: Instant? = null,
        archived: Boolean = false,
        date: LocalDate = LocalDate.of(2026, 11, 4),
    ) = OccurrenceWithTask(
        occurrence = TaskOccurrence(occId, 1, date, dueAt, status, snoozedUntil = snoozedUntil),
        task = Task(id = 1, title = "t", startDate = date, zoneId = zone.id, reminderOffsetsMinutes = offsets, archived = archived, createdAt = now, updatedAt = now),
    )

    @Test
    fun schedulesOffsetsBeforeDueAt_andSkipsPastOnes() {
        val due = now.plus(Duration.ofHours(1))
        val plan = ReminderPlanner.plan(listOf(item(5, due, listOf(10, 120))), now, endOfDay = endOfDay)
        assertEquals(listOf(ReminderSpec(5, 1, "10", due.minusSeconds(600))), plan)
        assertEquals("reminder-5-10", plan.single().uniqueName)
    }

    @Test
    fun noDueTime_usesEndOfLocalDay() {
        val plan = ReminderPlanner.plan(listOf(item(6, null, listOf(60))), now, endOfDay = endOfDay)
        val expected = ZonedDateTime.of(2026, 11, 4, 23, 0, 0, 0, zone).toInstant()
        assertEquals(expected, plan.single().fireAt)
    }

    @Test
    fun ignoresResolvedArchivedAndBeyondHorizon() {
        val due = now.plus(Duration.ofHours(3))
        val items = listOf(
            item(1, due, listOf(10), status = OccurrenceStatus.COMPLETED),
            item(2, due, listOf(10), status = OccurrenceStatus.SKIPPED),
            item(3, due, listOf(10), archived = true),
            item(4, now.plus(Duration.ofHours(60)), listOf(10)),
            item(5, due, emptyList()),
        )
        assertTrue(ReminderPlanner.plan(items, now, endOfDay = endOfDay).isEmpty())
    }

    @Test
    fun snoozed_getsWakeUp_andSuppressesEarlierOffsets() {
        val due = now.plus(Duration.ofHours(2))
        val snooze = now.plus(Duration.ofMinutes(30))
        val plan = ReminderPlanner.plan(listOf(item(7, due, listOf(100, 10), snoozedUntil = snooze)), now, endOfDay = endOfDay)
        // offset 100 -> fires at +20m, before the snooze end -> dropped.
        assertEquals(listOf("snooze", "10"), plan.map { it.offsetKey })
        assertEquals(snooze, plan.first().fireAt)
    }

    @Test
    fun delayUntilNext_isAlwaysInFuture_andDstAware() {
        val at = LocalTime.of(20, 30)
        val before = ZonedDateTime.of(2026, 11, 4, 20, 0, 0, 0, zone)
        assertEquals(Duration.ofMinutes(30), WorkTiming.delayUntilNext(before, at))
        val exactly = ZonedDateTime.of(2026, 11, 4, 20, 30, 0, 0, zone)
        assertEquals(Duration.ofHours(24), WorkTiming.delayUntilNext(exactly, at))
        // Israel leaves DST on Sunday 2026-10-25 (02:00 -> 01:00): 00:15 Sat -> 00:15 Sun is 24h,
        // but 20:30 Sat -> 20:30 Sun spans the change and is 25h.
        val sat = ZonedDateTime.of(2026, 10, 24, 20, 30, 0, 0, zone)
        assertEquals(Duration.ofHours(25), WorkTiming.delayUntilNext(sat, at))
    }
}
