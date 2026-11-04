package com.disciplineos.core.domain.task

import com.disciplineos.core.model.*
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

// ===== PUBLIC CONTRACT (owned by Task Engine agent; signature changes must be reported) =====

data class TaskInput(
    val title: String,
    val notes: String = "",
    val kind: TaskKind = TaskKind.OPTIONAL,
    val priority: Priority = Priority.MEDIUM,
    val categoryId: Long? = null,
    val startDate: LocalDate,
    val dueTime: LocalTime? = null,
    val endDate: LocalDate? = null,
    val recurrence: RecurrenceRule = RecurrenceRule.None,
    val reminderOffsetsMinutes: List<Int> = emptyList(),
    val estimatedMinutes: Int? = null,
    val verification: VerificationMethod = VerificationMethod.NONE,
    val dependsOn: Set<Long> = emptySet(),
    val subTasks: List<String> = emptyList(),
)

enum class TaskError {
    TITLE_BLANK, TITLE_TOO_LONG, NOTES_TOO_LONG, INVALID_DATE_RANGE, INVALID_REMINDER, INVALID_ESTIMATE,
    TOO_MANY_SUBTASKS, DEPENDENCY_NOT_FOUND, DEPENDENCY_CYCLE, DEPENDENCIES_INCOMPLETE,
    VERIFICATION_REQUIRED, SNOOZE_LIMIT_REACHED, INVALID_SNOOZE, NOT_FOUND, ALREADY_RESOLVED,
}

sealed interface TaskResult<out T> {
    data class Success<T>(val value: T) : TaskResult<T>
    data class Failure(val error: TaskError) : TaskResult<Nothing>
}

/** A day's work, as shown on the dashboard. */
data class DayPlan(
    val date: LocalDate,
    val mandatory: List<OccurrenceWithTask>,
    val optional: List<OccurrenceWithTask>,
    /** Overdue open MANDATORY occurrences from earlier days (carry-over). */
    val overdue: List<OccurrenceWithTask>,
    val completedCount: Int,
    val totalCount: Int,
) {
    val progress: Float get() = if (totalCount == 0) 0f else completedCount.toFloat() / totalCount
    val allMandatoryDone: Boolean
        get() = overdue.isEmpty() && mandatory.all { it.occurrence.status != OccurrenceStatus.PENDING }
}

/** Pure recurrence math, per local date. */
interface RecurrenceEngineApi {
    fun occurrenceDates(task: Task, from: LocalDate, to: LocalDate): List<LocalDate>
}

/** Resolves local date+time in a zone to an Instant, DST-safe (gap → shifted forward, overlap → earlier offset). */
interface DueInstantResolverApi {
    fun resolve(date: LocalDate, time: LocalTime?, zone: ZoneId): Instant?
    /** End of the local day (start of next day) — the deadline when no time is set. */
    fun endOfDay(date: LocalDate, zone: ZoneId): Instant
}

/** Smart weekly planning output. */
data class ScheduledBlock(val occurrenceId: Long, val taskId: Long, val date: LocalDate, val start: LocalTime, val end: LocalTime)
data class WeeklyPlan(val blocks: List<ScheduledBlock>, val unscheduled: List<Long>)
data class AvailabilityWindow(val date: LocalDate, val start: LocalTime, val end: LocalTime)
