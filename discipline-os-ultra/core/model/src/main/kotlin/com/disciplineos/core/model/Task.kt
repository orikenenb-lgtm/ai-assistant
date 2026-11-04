package com.disciplineos.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

/** Mandatory tasks drive the blocker; optional tasks never block anything. */
enum class TaskKind { MANDATORY, OPTIONAL }

enum class Priority(val weight: Int) { LOW(1), MEDIUM(2), HIGH(3), CRITICAL(4) }

/** How the user proves a task was done. Proof is self-reported; the app never claims to verify reality. */
enum class VerificationMethod { NONE, CHECKLIST, FOCUS_TIMER, REFLECTION_NOTE }

data class Category(
    val id: Long = 0,
    val name: String,
    val colorHex: String,
    val iconKey: String,
)

/**
 * A task template. Wall-clock fields ([dueDate], [dueTime]) are stored together with [zoneId] so that
 * recurrence and DST are computed per *local date* — never by adding fixed 24h durations.
 */
data class Task(
    val id: Long = 0,
    val title: String,
    val notes: String = "",
    val kind: TaskKind = TaskKind.OPTIONAL,
    val priority: Priority = Priority.MEDIUM,
    val categoryId: Long? = null,
    /** First local date the task applies to (start date for recurring tasks). */
    val startDate: LocalDate,
    /** Optional local due time-of-day. Null = "any time that day" (end of day for overdue purposes). */
    val dueTime: LocalTime? = null,
    /** Optional end of a recurrence series (inclusive). */
    val endDate: LocalDate? = null,
    val zoneId: String,
    val recurrence: RecurrenceRule = RecurrenceRule.None,
    /** Minutes before due time to remind. Empty = no reminder. */
    val reminderOffsetsMinutes: List<Int> = emptyList(),
    val estimatedMinutes: Int? = null,
    val verification: VerificationMethod = VerificationMethod.NONE,
    /** Ids of tasks that must be completed (same local date occurrence, or ever for one-off) before this one. */
    val dependsOn: Set<Long> = emptySet(),
    val archived: Boolean = false,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class SubTask(
    val id: Long = 0,
    val taskId: Long,
    val title: String,
    val done: Boolean = false,
    val position: Int = 0,
)

enum class OccurrenceStatus { PENDING, COMPLETED, SKIPPED, MISSED }

/**
 * One concrete instance of a task on a local date. One-off tasks have exactly one occurrence.
 * Snoozed = PENDING with [snoozedUntil] in the future.
 */
data class TaskOccurrence(
    val id: Long = 0,
    val taskId: Long,
    val localDate: LocalDate,
    /** Absolute due instant resolved from localDate + dueTime + zone (DST-safe). Null = end of local day. */
    val dueAt: Instant?,
    val status: OccurrenceStatus = OccurrenceStatus.PENDING,
    val completedAt: Instant? = null,
    val snoozedUntil: Instant? = null,
    val snoozeCount: Int = 0,
    val verificationNote: String? = null,
)

/** Convenience projection used by UI and policy. */
data class OccurrenceWithTask(
    val occurrence: TaskOccurrence,
    val task: Task,
    val subTasks: List<SubTask> = emptyList(),
)

enum class TaskHistoryType { CREATED, EDITED, COMPLETED, UNCOMPLETED, SNOOZED, SKIPPED, MISSED, DELETED, ARCHIVED }

data class TaskHistoryEntry(
    val id: Long = 0,
    val taskId: Long,
    val occurrenceId: Long?,
    val type: TaskHistoryType,
    val at: Instant,
    val detail: String = "",
)
