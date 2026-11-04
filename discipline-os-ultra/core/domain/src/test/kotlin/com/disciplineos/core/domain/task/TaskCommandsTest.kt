package com.disciplineos.core.domain.task

import com.disciplineos.core.model.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate

class TaskCommandsTest {

    private val today = d("2026-11-04")
    private val repo = FakeTaskRepository()
    private val time = MutableTimeProvider(today.atTime(12, 0).atZone(JERUSALEM).toInstant())
    private val reminders = FakeReminderScheduler()
    private val gamification = RecordingGamification()
    private val materializer = OccurrenceMaterializer(repo, time)
    private val commands = TaskCommands(repo, time, materializer, gamification.onCompleted, gamification.onDayCheck, reminders)

    private fun input(
        title: String = "Read 20 pages",
        startDate: LocalDate = today,
        recurrence: RecurrenceRule = RecurrenceRule.None,
        kind: TaskKind = TaskKind.OPTIONAL,
        dependsOn: Set<Long> = emptySet(),
        verification: VerificationMethod = VerificationMethod.NONE,
        subTasks: List<String> = emptyList(),
        endDate: LocalDate? = null,
        reminders: List<Int> = emptyList(),
        estimate: Int? = null,
        notes: String = "",
        dueTime: java.time.LocalTime? = null,
    ) = TaskInput(
        title = title, notes = notes, kind = kind, startDate = startDate, dueTime = dueTime, endDate = endDate,
        recurrence = recurrence, reminderOffsetsMinutes = reminders, estimatedMinutes = estimate,
        verification = verification, dependsOn = dependsOn, subTasks = subTasks,
    )

    private suspend fun create(i: TaskInput = input()): Long =
        (commands.createTask(i) as TaskResult.Success).value

    private fun assertFailure(expected: TaskError, result: TaskResult<*>) =
        assertEquals(TaskResult.Failure(expected), result)

    private fun historyTypes(taskId: Long) = repo.history.filter { it.taskId == taskId }.map { it.type }

    // ------------------------------------------------------------------ create / validation

    @Test fun createTask_persistsTrimmedTask_materializes_logs_andReschedules() = runTest {
        val id = create(input(title = "  Gym  ", recurrence = RecurrenceRule.Daily(1), subTasks = listOf(" warm up ", "", "lift"),
            reminders = listOf(30, 10, 30)))
        val task = repo.getTask(id)!!
        assertEquals("Gym", task.title)
        assertEquals(JERUSALEM.id, task.zoneId)
        assertEquals(listOf(10, 30), task.reminderOffsetsMinutes)
        assertEquals(time.now(), task.createdAt)
        assertEquals(listOf("warm up", "lift"), repo.subTasksOf(id).map { it.title })
        assertEquals(15, repo.occurrencesOf(id).size) // today..today+14
        assertEquals(listOf(TaskHistoryType.CREATED), historyTypes(id))
        assertEquals(1, reminders.rescheduleCount)
    }

    @Test fun createTask_validationErrors() = runTest {
        assertFailure(TaskError.TITLE_BLANK, commands.createTask(input(title = "   ")))
        assertFailure(TaskError.TITLE_TOO_LONG, commands.createTask(input(title = "x".repeat(121))))
        assertTrue(commands.createTask(input(title = "  " + "x".repeat(120) + "  ")) is TaskResult.Success)
        assertFailure(TaskError.NOTES_TOO_LONG, commands.createTask(input(notes = "n".repeat(2001))))
        assertFailure(TaskError.INVALID_DATE_RANGE, commands.createTask(input(endDate = today.minusDays(1))))
        assertTrue(commands.createTask(input(endDate = today)) is TaskResult.Success)
        assertFailure(TaskError.INVALID_REMINDER, commands.createTask(input(reminders = listOf(-1))))
        assertFailure(TaskError.INVALID_REMINDER, commands.createTask(input(reminders = listOf(10081))))
        assertFailure(TaskError.INVALID_REMINDER, commands.createTask(input(reminders = listOf(1, 2, 3, 4, 5, 6))))
        assertTrue(commands.createTask(input(reminders = listOf(0, 10080, 5, 15, 60))) is TaskResult.Success)
        assertFailure(TaskError.INVALID_ESTIMATE, commands.createTask(input(estimate = 0)))
        assertFailure(TaskError.INVALID_ESTIMATE, commands.createTask(input(estimate = 721)))
        assertTrue(commands.createTask(input(estimate = 720)) is TaskResult.Success)
        assertFailure(TaskError.TOO_MANY_SUBTASKS, commands.createTask(input(subTasks = List(31) { "s$it" })))
        assertTrue(commands.createTask(input(subTasks = List(30) { "s$it" })) is TaskResult.Success)
        assertFailure(TaskError.DEPENDENCY_NOT_FOUND, commands.createTask(input(dependsOn = setOf(424242))))
    }

    @Test fun createTask_failedValidation_hasNoSideEffects() = runTest {
        commands.createTask(input(title = ""))
        assertTrue(repo.tasks.isEmpty())
        assertTrue(repo.history.isEmpty())
        assertEquals(0, reminders.rescheduleCount)
    }

    // ------------------------------------------------------------------ dependencies

    @Test fun updateTask_rejectsSelfDependency() = runTest {
        val a = create()
        assertFailure(TaskError.DEPENDENCY_CYCLE, commands.updateTask(a, input(dependsOn = setOf(a))))
    }

    @Test fun updateTask_detectsIndirectCycle() = runTest {
        val a = create(input(title = "A"))
        val b = create(input(title = "B", dependsOn = setOf(a)))
        val c = create(input(title = "C", dependsOn = setOf(b)))
        // A -> C would close A -> C -> B -> A.
        assertFailure(TaskError.DEPENDENCY_CYCLE, commands.updateTask(a, input(title = "A", dependsOn = setOf(c))))
        // A diamond is fine: D depends on B and C (both reach A), no cycle.
        val dd = create(input(title = "D", dependsOn = setOf(b, c)))
        assertTrue(commands.updateTask(dd, input(title = "D", dependsOn = setOf(a, b, c))) is TaskResult.Success)
        assertEquals(emptySet<Long>(), repo.getTask(a)!!.dependsOn)
    }

    @Test fun completion_blockedUntilSameDayDependencyResolved() = runTest {
        val a = create(input(title = "A", recurrence = RecurrenceRule.Daily(1)))
        val b = create(input(title = "B", recurrence = RecurrenceRule.Daily(1), dependsOn = setOf(a)))
        val bToday = repo.occurrence(b, today).id
        assertFailure(TaskError.DEPENDENCIES_INCOMPLETE, commands.completeOccurrence(bToday))
        // Completing A tomorrow does not unlock B today.
        commands.completeOccurrence(repo.occurrence(a, today.plusDays(1)).id)
        assertFailure(TaskError.DEPENDENCIES_INCOMPLETE, commands.completeOccurrence(bToday))
        commands.completeOccurrence(repo.occurrence(a, today).id)
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(bToday))
    }

    @Test fun completion_skippedRecurringDependencyCountsAsResolved() = runTest {
        val a = create(input(title = "A", recurrence = RecurrenceRule.Daily(1)))
        val b = create(input(title = "B", recurrence = RecurrenceRule.Daily(1), dependsOn = setOf(a)))
        commands.skipOccurrence(repo.occurrence(a, today).id, "sick")
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(repo.occurrence(b, today).id))
    }

    @Test fun completion_recurringDependencyNotScheduledThatDay_doesNotBlock() = runTest {
        // A only on Mondays; B daily. Today is Wednesday.
        val a = create(input(title = "A", recurrence = RecurrenceRule.Weekly(setOf(DayOfWeek.MONDAY))))
        val b = create(input(title = "B", recurrence = RecurrenceRule.Daily(1), dependsOn = setOf(a)))
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(repo.occurrence(b, today).id))
        // But on Monday it does block.
        assertFailure(TaskError.DEPENDENCIES_INCOMPLETE, commands.completeOccurrence(repo.occurrence(b, d("2026-11-09")).id))
    }

    @Test fun completion_oneOffDependency_anyCompletedOccurrence() = runTest {
        val a = create(input(title = "Buy shoes", startDate = today.plusDays(3)))
        val b = create(input(title = "Run", recurrence = RecurrenceRule.Daily(1), dependsOn = setOf(a)))
        val bToday = repo.occurrence(b, today).id
        assertFailure(TaskError.DEPENDENCIES_INCOMPLETE, commands.completeOccurrence(bToday))
        // Skipping a one-off dependency does not satisfy it (spec: completed only).
        val aOcc = repo.occurrencesOf(a).single().id
        commands.skipOccurrence(aOcc, "changed plans")
        assertFailure(TaskError.DEPENDENCIES_INCOMPLETE, commands.completeOccurrence(bToday))
        commands.uncompleteOccurrence(aOcc)
        commands.completeOccurrence(aOcc) // completed early, on a different date
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(bToday))
    }

    @Test fun deleteTask_removesDanglingDependencyEdges() = runTest {
        val a = create(input(title = "A"))
        val b = create(input(title = "B", dependsOn = setOf(a)))
        assertEquals(TaskResult.Success(Unit), commands.deleteTask(a))
        assertNull(repo.getTask(a))
        assertEquals(emptySet<Long>(), repo.getTask(b)!!.dependsOn)
        assertEquals(listOf(a), reminders.cancelled)
        assertTrue(repo.occurrencesOf(a).isEmpty())
        assertTrue(TaskHistoryType.DELETED in historyTypes(a))
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(repo.occurrencesOf(b).single().id))
    }

    @Test fun deleteTask_unknown_isNotFound() = runTest {
        assertFailure(TaskError.NOT_FOUND, commands.deleteTask(99))
    }

    // ------------------------------------------------------------------ verification

    @Test fun checklist_requiresAllSubtasksDone() = runTest {
        val id = create(input(verification = VerificationMethod.CHECKLIST, subTasks = listOf("a", "b")))
        val occ = repo.occurrencesOf(id).single().id
        val subs = repo.subTasksOf(id)
        commands.toggleSubTask(subs[0].id, true)
        assertFailure(TaskError.VERIFICATION_REQUIRED, commands.completeOccurrence(occ))
        commands.toggleSubTask(subs[1].id, true)
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(occ))
    }

    @Test fun reflectionNote_requiresTenChars() = runTest {
        val id = create(input(verification = VerificationMethod.REFLECTION_NOTE))
        val occ = repo.occurrencesOf(id).single().id
        assertFailure(TaskError.VERIFICATION_REQUIRED, commands.completeOccurrence(occ))
        assertFailure(TaskError.VERIFICATION_REQUIRED, commands.completeOccurrence(occ, "   short    "))
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(occ, "  learned a lot  "))
        assertEquals("learned a lot", repo.getOccurrence(occ)!!.verificationNote)
    }

    @Test fun focusTimer_isSelfReported_noteOptional() = runTest {
        val id = create(input(verification = VerificationMethod.FOCUS_TIMER))
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(repo.occurrencesOf(id).single().id))
    }

    // ------------------------------------------------------------------ completion lifecycle

    @Test fun complete_updatesOccurrence_history_gamification_reminders() = runTest {
        val id = create(input(kind = TaskKind.MANDATORY))
        val occ = repo.occurrencesOf(id).single()
        val before = reminders.rescheduleCount
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(occ.id))
        val done = repo.getOccurrence(occ.id)!!
        assertEquals(OccurrenceStatus.COMPLETED, done.status)
        assertEquals(time.now(), done.completedAt)
        assertEquals(listOf(TaskHistoryType.CREATED, TaskHistoryType.COMPLETED), historyTypes(id))
        assertEquals(1, gamification.completed.size)
        assertEquals(id, gamification.completed.single().first.id)
        assertEquals(done, gamification.completed.single().second)
        assertEquals(listOf(today), gamification.dayChecks)
        assertEquals(before + 1, reminders.rescheduleCount)
    }

    @Test fun complete_twice_isAlreadyResolved_andAwardsOnce() = runTest {
        val occ = repo.occurrencesOf(create()).single().id
        commands.completeOccurrence(occ)
        assertFailure(TaskError.ALREADY_RESOLVED, commands.completeOccurrence(occ))
        assertEquals(1, gamification.completed.size)
    }

    @Test fun complete_missedOccurrence_isAllowedLate() = runTest {
        val id = create(input(startDate = today.minusDays(2)))
        val occ = repo.occurrencesOf(id).single()
        repo.updateOccurrence(occ.copy(status = OccurrenceStatus.MISSED))
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(occ.id))
        assertEquals(listOf(today.minusDays(2)), gamification.dayChecks)
        assertEquals("late", repo.history.last().detail)
    }

    @Test fun complete_unknownOccurrence_isNotFound() = runTest {
        assertFailure(TaskError.NOT_FOUND, commands.completeOccurrence(12345))
    }

    @Test fun uncomplete_revertsToPending_withoutRevokingXp() = runTest {
        val id = create()
        val occ = repo.occurrencesOf(id).single().id
        commands.completeOccurrence(occ)
        assertEquals(TaskResult.Success(Unit), commands.uncompleteOccurrence(occ))
        val o = repo.getOccurrence(occ)!!
        assertEquals(OccurrenceStatus.PENDING, o.status)
        assertNull(o.completedAt)
        assertEquals(TaskHistoryType.UNCOMPLETED, historyTypes(id).last())
        assertEquals(1, gamification.completed.size) // nothing revoked, nothing extra
        assertFailure(TaskError.ALREADY_RESOLVED, commands.uncompleteOccurrence(occ)) // already pending
        // Re-completing reports again; gamification dedupes by key.
        commands.completeOccurrence(occ)
        assertEquals(2, gamification.completed.size)
    }

    // ------------------------------------------------------------------ snooze

    @Test fun snooze_validRange_andLimitOfThree() = runTest {
        val occ = repo.occurrencesOf(create()).single().id
        assertFailure(TaskError.INVALID_SNOOZE, commands.snoozeOccurrence(occ, 4))
        assertFailure(TaskError.INVALID_SNOOZE, commands.snoozeOccurrence(occ, 1441))
        assertEquals(TaskResult.Success(Unit), commands.snoozeOccurrence(occ, 5))
        assertEquals(time.now().plusSeconds(300), repo.getOccurrence(occ)!!.snoozedUntil)
        assertEquals(TaskResult.Success(Unit), commands.snoozeOccurrence(occ, 60))
        assertEquals(TaskResult.Success(Unit), commands.snoozeOccurrence(occ, 1440))
        val o = repo.getOccurrence(occ)!!
        assertEquals(3, o.snoozeCount)
        assertEquals(time.now().plusSeconds(1440 * 60L), o.snoozedUntil)
        assertFailure(TaskError.SNOOZE_LIMIT_REACHED, commands.snoozeOccurrence(occ, 10))
        assertEquals(3, repo.history.count { it.type == TaskHistoryType.SNOOZED })
    }

    @Test fun snoozeLimit_cannotBeResetByMovingOneOffStartDate() = runTest {
        val id = create()
        val occ = repo.occurrencesOf(id).single().id
        repeat(3) { assertEquals(TaskResult.Success(Unit), commands.snoozeOccurrence(occ, 10)) }
        assertEquals(TaskResult.Success(Unit), commands.updateTask(id, input(startDate = today.plusDays(1))))
        val moved = repo.occurrencesOf(id).single()
        assertEquals(today.plusDays(1), moved.localDate)
        assertEquals(3, moved.snoozeCount)
        assertFailure(TaskError.SNOOZE_LIMIT_REACHED, commands.snoozeOccurrence(moved.id, 10))
    }

    @Test fun snooze_completedOccurrence_isAlreadyResolved() = runTest {
        val occ = repo.occurrencesOf(create()).single().id
        commands.completeOccurrence(occ)
        assertFailure(TaskError.ALREADY_RESOLVED, commands.snoozeOccurrence(occ, 10))
    }

    @Test fun complete_clearsSnooze() = runTest {
        val occ = repo.occurrencesOf(create()).single().id
        commands.snoozeOccurrence(occ, 30)
        commands.completeOccurrence(occ)
        assertNull(repo.getOccurrence(occ)!!.snoozedUntil)
    }

    // ------------------------------------------------------------------ skip

    @Test fun skip_requiresReason_logsHistory_noXp() = runTest {
        val id = create(input(kind = TaskKind.MANDATORY))
        val occ = repo.occurrencesOf(id).single().id
        assertFailure(TaskError.VERIFICATION_REQUIRED, commands.skipOccurrence(occ, "   "))
        assertEquals(TaskResult.Success(Unit), commands.skipOccurrence(occ, "  doctor appointment "))
        assertEquals(OccurrenceStatus.SKIPPED, repo.getOccurrence(occ)!!.status)
        val entry = repo.history.last()
        assertEquals(TaskHistoryType.SKIPPED, entry.type)
        assertEquals("doctor appointment", entry.detail)
        assertEquals(occ, entry.occurrenceId)
        assertTrue(gamification.completed.isEmpty())
        assertTrue(gamification.dayChecks.isEmpty())
        assertFailure(TaskError.ALREADY_RESOLVED, commands.skipOccurrence(occ, "again"))
    }

    @Test fun skip_tooLongReason_rejected() = runTest {
        val occ = repo.occurrencesOf(create()).single().id
        assertFailure(TaskError.NOTES_TOO_LONG, commands.skipOccurrence(occ, "r".repeat(501)))
    }

    // ------------------------------------------------------------------ update / archive

    @Test fun updateTask_scheduleChange_rematerializes_keepingCompletedHistory() = runTest {
        val id = create(input(recurrence = RecurrenceRule.Daily(1), startDate = today))
        commands.completeOccurrence(repo.occurrence(id, today).id)
        val r = commands.updateTask(id, input(recurrence = RecurrenceRule.Weekly(setOf(DayOfWeek.MONDAY)), startDate = today))
        assertEquals(TaskResult.Success(Unit), r)
        val occ = repo.occurrencesOf(id)
        assertEquals(OccurrenceStatus.COMPLETED, occ.single { it.localDate == today }.status)
        assertEquals(listOf(d("2026-11-09"), d("2026-11-16")), occ.filter { it.localDate.isAfter(today) }.map { it.localDate })
        assertEquals(TaskHistoryType.EDITED, historyTypes(id).last())
    }

    @Test fun updateTask_nonScheduleChange_keepsOccurrencesAndSnoozeState() = runTest {
        val id = create(input(recurrence = RecurrenceRule.Daily(1)))
        val occ = repo.occurrence(id, today).id
        commands.snoozeOccurrence(occ, 10)
        commands.updateTask(id, input(title = "Renamed", recurrence = RecurrenceRule.Daily(1)))
        assertEquals("Renamed", repo.getTask(id)!!.title)
        assertEquals(1, repo.getOccurrence(occ)!!.snoozeCount)
    }

    @Test fun updateTask_keepsCreatedAtZoneAndSubtaskDoneState() = runTest {
        val id = create(input(subTasks = listOf("a", "b")))
        val created = repo.getTask(id)!!
        commands.toggleSubTask(repo.subTasksOf(id).first { it.title == "b" }.id, true)
        time.instant = time.instant.plusSeconds(3600)
        commands.updateTask(id, input(title = "New", subTasks = listOf("b", "c")))
        val updated = repo.getTask(id)!!
        assertEquals(created.createdAt, updated.createdAt)
        assertEquals(created.zoneId, updated.zoneId)
        assertEquals(time.now(), updated.updatedAt)
        assertEquals(listOf("b" to true, "c" to false), repo.subTasksOf(id).map { it.title to it.done })
    }

    @Test fun updateTask_unknown_isNotFound_andValidates() = runTest {
        assertFailure(TaskError.NOT_FOUND, commands.updateTask(77, input()))
        val id = create()
        assertFailure(TaskError.TITLE_BLANK, commands.updateTask(id, input(title = "")))
    }

    @Test fun archiveTask_removesFuturePending_keepsPast_andIsIdempotent() = runTest {
        val id = create(input(recurrence = RecurrenceRule.Daily(1), startDate = today))
        commands.completeOccurrence(repo.occurrence(id, today).id)
        assertEquals(TaskResult.Success(Unit), commands.archiveTask(id))
        assertTrue(repo.getTask(id)!!.archived)
        assertEquals(listOf(today), repo.occurrencesOf(id).map { it.localDate })
        assertEquals(TaskResult.Success(Unit), commands.archiveTask(id))
        assertEquals(1, repo.history.count { it.type == TaskHistoryType.ARCHIVED })
        assertFailure(TaskError.NOT_FOUND, commands.archiveTask(1234))
    }

    // ------------------------------------------------------------------ categories

    @Test fun createCategory_validatesAndNormalizes() = runTest {
        assertFailure(TaskError.TITLE_BLANK, commands.createCategory("  ", "#FF0000", "x"))
        assertFailure(TaskError.TITLE_TOO_LONG, commands.createCategory("c".repeat(41), "#FF0000", "x"))
        val id = (commands.createCategory(" בריאות ", "#ff0000", "") as TaskResult.Success).value
        val bad = (commands.createCategory("Work", "red", "briefcase") as TaskResult.Success).value
        val cats = repo.state.value.categories
        assertEquals(Category(id, "בריאות", "#FF0000", "default"), cats[id])
        assertEquals(TaskCommands.DEFAULT_CATEGORY_COLOR, cats[bad]!!.colorHex)
    }

    // ------------------------------------------------------------------ misc

    @Test fun everyMutation_appendsHistory() = runTest {
        val id = create(input(recurrence = RecurrenceRule.Daily(1)))
        val o1 = repo.occurrence(id, today).id
        val o2 = repo.occurrence(id, today.plusDays(1)).id
        val o3 = repo.occurrence(id, today.plusDays(2)).id
        commands.completeOccurrence(o1)
        commands.uncompleteOccurrence(o1)
        commands.snoozeOccurrence(o2, 15)
        commands.skipOccurrence(o3, "travel")
        commands.updateTask(id, input(title = "x", recurrence = RecurrenceRule.Daily(1)))
        commands.archiveTask(id)
        assertEquals(
            listOf(TaskHistoryType.CREATED, TaskHistoryType.COMPLETED, TaskHistoryType.UNCOMPLETED, TaskHistoryType.SNOOZED,
                TaskHistoryType.SKIPPED, TaskHistoryType.EDITED, TaskHistoryType.ARCHIVED),
            historyTypes(id),
        )
        assertTrue(repo.history.all { it.at == time.now() })
        assertEquals(7, reminders.rescheduleCount)
    }

    @Test fun createTask_pastOneOff_isMaterialized() = runTest {
        val id = create(input(startDate = today.minusDays(5)))
        assertEquals(listOf(today.minusDays(5)), repo.occurrencesOf(id).map { it.localDate })
    }

    @Test fun createTask_dueTimeInGap_resolvedForward() = runTest {
        val gapDay = d("2026-03-27")
        time.instant = gapDay.atTime(0, 0).atZone(JERUSALEM).toInstant()
        val id = create(input(startDate = gapDay, dueTime = t("02:30")))
        assertEquals(Instant.parse("2026-03-27T00:30:00Z"), repo.occurrencesOf(id).single().dueAt)
    }

    @Test fun completion_ofArchivedTaskPastOccurrence_stillPossible() = runTest {
        val id = create(input(startDate = today.minusDays(1), recurrence = RecurrenceRule.Daily(1)))
        materializer.materializeWindow()
        commands.archiveTask(id)
        val past = repo.occurrence(id, today.minusDays(1))
        assertNotNull(past)
        assertEquals(TaskResult.Success(Unit), commands.completeOccurrence(past.id))
        assertFalse(gamification.completed.isEmpty())
    }
}
