package com.disciplineos.core.domain.task

import com.disciplineos.core.model.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class OccurrenceMaterializerTest {

    private val today = d("2026-11-04")
    private val repo = FakeTaskRepository()
    private val time = fixedTime(today)
    private val materializer = OccurrenceMaterializer(repo, time)

    @Test fun materializeWindow_defaultWindowIsYesterdayToTwoWeeksAhead() = runTest {
        val id = repo.upsertTask(task(startDate = d("2026-10-01"), recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow()
        val dates = repo.occurrencesOf(id).map { it.localDate }
        assertEquals(today.minusDays(1), dates.first())
        assertEquals(today.plusDays(14), dates.last())
        assertEquals(16, dates.size)
    }

    @Test fun materializeWindow_isIdempotent() = runTest {
        val id = repo.upsertTask(task(startDate = today, recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow(today, today.plusDays(3))
        val first = repo.occurrencesOf(id)
        materializer.materializeWindow(today, today.plusDays(3))
        materializer.materializeWindow(today.plusDays(1), today.plusDays(5))
        assertEquals(first, repo.occurrencesOf(id).take(4))
        assertEquals(6, repo.occurrencesOf(id).size)
    }

    @Test fun materializeWindow_doesNotOverwriteCompletedOccurrence() = runTest {
        val id = repo.upsertTask(task(startDate = today, recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow(today, today)
        val occ = repo.occurrence(id, today)
        repo.updateOccurrence(occ.copy(status = OccurrenceStatus.COMPLETED, completedAt = Instant.EPOCH))
        materializer.materializeWindow(today, today)
        assertEquals(OccurrenceStatus.COMPLETED, repo.occurrence(id, today).status)
    }

    @Test fun materializeWindow_skipsArchivedAndRespectsEndDate() = runTest {
        val archived = repo.upsertTask(task(startDate = today, recurrence = RecurrenceRule.Daily(1), archived = true))
        val ending = repo.upsertTask(task(startDate = today, endDate = today.plusDays(1), recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow(today, today.plusDays(5))
        assertTrue(repo.occurrencesOf(archived).isEmpty())
        assertEquals(listOf(today, today.plusDays(1)), repo.occurrencesOf(ending).map { it.localDate })
    }

    @Test fun materializeWindow_resolvesDueAtInTaskZone_acrossDst() = runTest {
        // Task created in New York; device is in Jerusalem. dueAt must follow the task's zone.
        val id = repo.upsertTask(
            task(startDate = d("2026-10-31"), recurrence = RecurrenceRule.Daily(1), dueTime = t("09:00"), zoneId = NEW_YORK.id)
        )
        materializer.materializeWindow(d("2026-10-31"), d("2026-11-02"))
        val due = repo.occurrencesOf(id).map { it.dueAt }
        assertEquals(
            listOf(Instant.parse("2026-10-31T13:00:00Z"), Instant.parse("2026-11-01T14:00:00Z"), Instant.parse("2026-11-02T14:00:00Z")),
            due,
        )
    }

    @Test fun materializeWindow_gapTimeInJerusalem() = runTest {
        val id = repo.upsertTask(task(startDate = d("2026-03-26"), recurrence = RecurrenceRule.Daily(1), dueTime = t("02:30")))
        materializer.materializeWindow(d("2026-03-26"), d("2026-03-28"))
        assertEquals(
            listOf(Instant.parse("2026-03-26T00:30:00Z"), Instant.parse("2026-03-27T00:30:00Z"), Instant.parse("2026-03-27T23:30:00Z")),
            repo.occurrencesOf(id).map { it.dueAt },
        )
    }

    @Test fun materializeWindow_noDueTime_dueAtNull() = runTest {
        val id = repo.upsertTask(task(startDate = today))
        materializer.materializeWindow()
        assertNull(repo.occurrence(id, today).dueAt)
    }

    @Test fun materializeWindow_invalidZone_fallsBackToDeviceZone() = runTest {
        val id = repo.upsertTask(task(startDate = today, dueTime = t("09:00"), zoneId = "Not/AZone"))
        materializer.materializeWindow()
        assertEquals(Instant.parse("2026-11-04T07:00:00Z"), repo.occurrence(id, today).dueAt)
    }

    @Test fun rematerializeTask_replacesFuturePending_keepsHistory() = runTest {
        val id = repo.upsertTask(task(startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow(d("2026-11-01"), today.plusDays(14))
        // Yesterday completed, today completed, 2 Nov left pending (overdue).
        repo.updateOccurrence(repo.occurrence(id, d("2026-11-03")).copy(status = OccurrenceStatus.COMPLETED))
        repo.updateOccurrence(repo.occurrence(id, today).copy(status = OccurrenceStatus.COMPLETED))

        // Change to Mondays only.
        repo.upsertTask(repo.getTask(id)!!.copy(recurrence = RecurrenceRule.Weekly(setOf(java.time.DayOfWeek.MONDAY))))
        materializer.rematerializeTask(id)

        val occ = repo.occurrencesOf(id)
        assertEquals(OccurrenceStatus.PENDING, occ.single { it.localDate == d("2026-11-02") }.status) // past untouched
        assertEquals(OccurrenceStatus.COMPLETED, occ.single { it.localDate == d("2026-11-03") }.status)
        assertEquals(OccurrenceStatus.COMPLETED, occ.single { it.localDate == today }.status) // completed today kept
        val future = occ.filter { it.localDate.isAfter(today) }.map { it.localDate }
        assertEquals(listOf(d("2026-11-09"), d("2026-11-16")), future)
    }

    @Test fun rematerializeTask_carriesSnoozeCountForSameDate() = runTest {
        val id = repo.upsertTask(task(startDate = today, recurrence = RecurrenceRule.Daily(1), dueTime = t("09:00")))
        materializer.materializeWindow(today, today)
        repo.updateOccurrence(repo.occurrence(id, today).copy(snoozeCount = 3, snoozedUntil = time.now().plusSeconds(600)))
        repo.upsertTask(repo.getTask(id)!!.copy(dueTime = t("10:00")))
        materializer.rematerializeTask(id)
        val occ = repo.occurrence(id, today)
        assertEquals(3, occ.snoozeCount)
        assertEquals(time.now().plusSeconds(600), occ.snoozedUntil)
        assertEquals(Instant.parse("2026-11-04T08:00:00Z"), occ.dueAt)
    }

    @Test fun rematerializeTask_oneOff_movesPendingOccurrenceEvenFromPast() = runTest {
        val id = repo.upsertTask(task(startDate = d("2026-11-01")))
        materializer.rematerializeTask(id)
        assertEquals(listOf(d("2026-11-01")), repo.occurrencesOf(id).map { it.localDate })
        repo.upsertTask(repo.getTask(id)!!.copy(startDate = d("2026-11-06")))
        materializer.rematerializeTask(id)
        assertEquals(listOf(d("2026-11-06")), repo.occurrencesOf(id).map { it.localDate })
    }

    @Test fun rematerializeTask_oneOff_completedIsNotRecreated() = runTest {
        val id = repo.upsertTask(task(startDate = today))
        materializer.rematerializeTask(id)
        repo.updateOccurrence(repo.occurrence(id, today).copy(status = OccurrenceStatus.COMPLETED))
        repo.upsertTask(repo.getTask(id)!!.copy(startDate = today.plusDays(2)))
        materializer.rematerializeTask(id)
        assertEquals(listOf(today to OccurrenceStatus.COMPLETED), repo.occurrencesOf(id).map { it.localDate to it.status })
    }

    @Test fun rematerializeTask_archived_onlyDeletesFuturePending() = runTest {
        val id = repo.upsertTask(task(startDate = d("2026-11-01"), recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow(d("2026-11-01"), today.plusDays(3))
        repo.upsertTask(repo.getTask(id)!!.copy(archived = true))
        materializer.rematerializeTask(id)
        assertEquals(listOf(d("2026-11-01"), d("2026-11-02"), d("2026-11-03")), repo.occurrencesOf(id).map { it.localDate })
    }

    @Test fun rematerializeTask_unknownTask_isNoOp() = runTest {
        materializer.rematerializeTask(999)
        assertTrue(repo.occurrences.isEmpty())
    }

    @Test fun sweepPast_withCarryOver_marksOptionalMissed_keepsMandatoryPending() = runTest {
        val opt = repo.upsertTask(task(startDate = d("2026-11-02"), recurrence = RecurrenceRule.Daily(1)))
        val man = repo.upsertTask(task(startDate = d("2026-11-02"), recurrence = RecurrenceRule.Daily(1), kind = TaskKind.MANDATORY))
        materializer.materializeWindow(d("2026-11-02"), today)
        repo.updateOccurrence(repo.occurrence(opt, d("2026-11-03")).copy(status = OccurrenceStatus.COMPLETED))

        materializer.sweepPast(carryOverMandatory = true)

        assertEquals(OccurrenceStatus.MISSED, repo.occurrence(opt, d("2026-11-02")).status)
        assertEquals(OccurrenceStatus.COMPLETED, repo.occurrence(opt, d("2026-11-03")).status)
        assertEquals(OccurrenceStatus.PENDING, repo.occurrence(opt, today).status) // today is not past
        assertEquals(OccurrenceStatus.PENDING, repo.occurrence(man, d("2026-11-02")).status)
        assertEquals(OccurrenceStatus.PENDING, repo.occurrence(man, d("2026-11-03")).status)
        val missed = repo.history.filter { it.type == TaskHistoryType.MISSED }
        assertEquals(1, missed.size)
        assertEquals(opt, missed.single().taskId)
    }

    @Test fun sweepPast_withoutCarryOver_marksMandatoryMissedToo_andIsIdempotent() = runTest {
        val man = repo.upsertTask(task(startDate = d("2026-11-02"), recurrence = RecurrenceRule.Daily(1), kind = TaskKind.MANDATORY))
        materializer.materializeWindow(d("2026-11-02"), today)
        materializer.sweepPast(carryOverMandatory = false)
        materializer.sweepPast(carryOverMandatory = false)
        assertEquals(OccurrenceStatus.MISSED, repo.occurrence(man, d("2026-11-02")).status)
        assertEquals(OccurrenceStatus.MISSED, repo.occurrence(man, d("2026-11-03")).status)
        assertEquals(OccurrenceStatus.PENDING, repo.occurrence(man, today).status)
        assertEquals(2, repo.history.count { it.type == TaskHistoryType.MISSED })
    }
}
