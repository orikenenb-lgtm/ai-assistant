package com.disciplineos.app.data.mapper

import com.disciplineos.app.data.local.entity.AchievementEntity
import com.disciplineos.app.data.local.entity.BlockedAppEntity
import com.disciplineos.app.data.local.entity.BypassSessionEntity
import com.disciplineos.app.data.local.entity.CategoryEntity
import com.disciplineos.app.data.local.entity.ChatMessageEntity
import com.disciplineos.app.data.local.entity.FocusSessionEntity
import com.disciplineos.app.data.local.entity.OccurrenceWithTaskRelation
import com.disciplineos.app.data.local.entity.SubTaskEntity
import com.disciplineos.app.data.local.entity.TaskEntity
import com.disciplineos.app.data.local.entity.TaskHistoryEntity
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import com.disciplineos.app.data.local.entity.TaskWithDependencies
import com.disciplineos.app.data.local.entity.XpEventEntity
import com.disciplineos.app.data.local.json.ChatActionsJson
import com.disciplineos.core.domain.task.RecurrenceCodec
import com.disciplineos.core.model.Achievement
import com.disciplineos.core.model.BlockedApp
import com.disciplineos.core.model.BypassReason
import com.disciplineos.core.model.BypassSession
import com.disciplineos.core.model.Category
import com.disciplineos.core.model.ChatMessage
import com.disciplineos.core.model.ChatRole
import com.disciplineos.core.model.FocusSession
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.SubTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskHistoryEntry
import com.disciplineos.core.model.TaskHistoryType
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.TaskOccurrence
import com.disciplineos.core.model.VerificationMethod
import com.disciplineos.core.model.XpEvent
import com.disciplineos.core.model.XpSource

/*
 * Entity <-> model mapping. Pure functions (no Android APIs) so they are covered by JVM unit tests.
 */

/** Parses an enum by name; unknown/blank names fall back to [default] instead of throwing. */
inline fun <reified E : Enum<E>> enumOr(name: String?, default: E): E =
    if (name == null) default else enumValues<E>().firstOrNull { it.name == name } ?: default

/** "10,30,60" <-> [10, 30, 60]. Invalid fragments are dropped; result is de-duplicated and sorted descending. */
object ReminderOffsetsCodec {
    fun encode(offsets: List<Int>): String = offsets.distinct().sortedDescending().joinToString(",")
    fun decode(value: String?): List<Int> =
        value.orEmpty().split(',').mapNotNull { it.trim().toIntOrNull() }.distinct().sortedDescending()
}

// ---------- categories ----------

fun CategoryEntity.toModel() = Category(id = id, name = name, colorHex = colorHex, iconKey = iconKey)
fun Category.toEntity() = CategoryEntity(id = id, name = name, colorHex = colorHex, iconKey = iconKey)

// ---------- tasks ----------

fun TaskEntity.toModel(dependsOn: Collection<Long>): Task = Task(
    id = id,
    title = title,
    notes = notes,
    kind = enumOr(kind, TaskKind.OPTIONAL),
    priority = enumOr(priority, Priority.MEDIUM),
    categoryId = categoryId,
    startDate = startDate,
    dueTime = dueTime,
    endDate = endDate,
    zoneId = zoneId,
    recurrence = RecurrenceCodec.decode(recurrence),
    reminderOffsetsMinutes = ReminderOffsetsCodec.decode(reminderOffsets),
    estimatedMinutes = estimatedMinutes,
    verification = enumOr(verification, VerificationMethod.NONE),
    dependsOn = dependsOn.toSet(),
    archived = archived,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

fun TaskWithDependencies.toModel(): Task = task.toModel(dependsOn)

/** [Task.dependsOn] is stored in `task_dependencies`, not in this row. */
fun Task.toEntity() = TaskEntity(
    id = id,
    title = title,
    notes = notes,
    kind = kind.name,
    priority = priority.name,
    categoryId = categoryId,
    startDate = startDate,
    dueTime = dueTime,
    endDate = endDate,
    zoneId = zoneId,
    recurrence = RecurrenceCodec.encode(recurrence),
    reminderOffsets = ReminderOffsetsCodec.encode(reminderOffsetsMinutes),
    estimatedMinutes = estimatedMinutes,
    verification = verification.name,
    archived = archived,
    createdAt = createdAt,
    updatedAt = updatedAt,
)

// ---------- sub-tasks ----------

fun SubTaskEntity.toModel() = SubTask(id = id, taskId = taskId, title = title, done = done, position = position)
fun SubTask.toEntity(taskIdOverride: Long = taskId) =
    SubTaskEntity(id = id, taskId = taskIdOverride, title = title, done = done, position = position)

// ---------- occurrences ----------

fun TaskOccurrenceEntity.toModel() = TaskOccurrence(
    id = id,
    taskId = taskId,
    localDate = localDate,
    dueAt = dueAt,
    status = enumOr(status, OccurrenceStatus.PENDING),
    completedAt = completedAt,
    snoozedUntil = snoozedUntil,
    snoozeCount = snoozeCount,
    verificationNote = verificationNote,
)

fun TaskOccurrence.toEntity() = TaskOccurrenceEntity(
    id = id,
    taskId = taskId,
    localDate = localDate,
    dueAt = dueAt,
    status = status.name,
    completedAt = completedAt,
    snoozedUntil = snoozedUntil,
    snoozeCount = snoozeCount,
    verificationNote = verificationNote,
)

fun OccurrenceWithTaskRelation.toModel() = OccurrenceWithTask(
    occurrence = occurrence.toModel(),
    task = task.toModel(),
    subTasks = subTasks.sortedWith(compareBy({ it.position }, { it.id })).map { it.toModel() },
)

// ---------- history ----------

fun TaskHistoryEntity.toModel() = TaskHistoryEntry(
    id = id,
    taskId = taskId,
    occurrenceId = occurrenceId,
    type = enumOr(type, TaskHistoryType.EDITED),
    at = at,
    detail = detail,
)

fun TaskHistoryEntry.toEntity() = TaskHistoryEntity(
    id = id,
    taskId = taskId,
    occurrenceId = occurrenceId,
    type = type.name,
    at = at,
    detail = detail,
)

// ---------- blocker ----------

fun BlockedAppEntity.toModel() =
    BlockedApp(packageName = packageName, label = label, enabled = enabled, suggestedByDefault = suggestedByDefault)

fun BlockedApp.toEntity() =
    BlockedAppEntity(packageName = packageName, label = label, enabled = enabled, suggestedByDefault = suggestedByDefault)

fun BypassSessionEntity.toModel() = BypassSession(
    id = id,
    startedAt = startedAt,
    endsAt = endsAt,
    reason = enumOr(reason, BypassReason.OTHER),
    note = note,
    endedEarlyAt = endedEarlyAt,
)

fun BypassSession.toEntity() = BypassSessionEntity(
    id = id,
    startedAt = startedAt,
    endsAt = endsAt,
    reason = reason.name,
    note = note,
    endedEarlyAt = endedEarlyAt,
)

// ---------- focus ----------

fun FocusSessionEntity.toModel() = FocusSession(
    id = id,
    taskId = taskId,
    startedAt = startedAt,
    endedAt = endedAt,
    plannedSeconds = plannedSeconds,
    focusedSeconds = focusedSeconds,
    completed = completed,
    interruptions = interruptions,
)

fun FocusSession.toEntity() = FocusSessionEntity(
    id = id,
    taskId = taskId,
    startedAt = startedAt,
    endedAt = endedAt,
    plannedSeconds = plannedSeconds,
    focusedSeconds = focusedSeconds,
    completed = completed,
    interruptions = interruptions,
)

// ---------- gamification ----------

/** Unknown XP sources keep their amount (totals stay correct) and are attributed to TASK_COMPLETED. */
fun XpEventEntity.toModel() = XpEvent(
    id = id,
    at = at,
    amount = amount,
    source = enumOr(source, XpSource.TASK_COMPLETED),
    dedupeKey = dedupeKey,
)

fun XpEvent.toEntity() = XpEventEntity(id = id, at = at, amount = amount, source = source.name, dedupeKey = dedupeKey)

fun AchievementEntity.toModel() = Achievement(id = id, unlockedAt = unlockedAt)

// ---------- chat ----------

fun ChatMessageEntity.toModel() = ChatMessage(
    id = id,
    role = enumOr(role, ChatRole.NOTICE),
    text = text,
    createdAt = createdAt,
    actions = ChatActionsJson.decode(actionsJson),
)

fun ChatMessage.toEntity() = ChatMessageEntity(
    id = id,
    role = role.name,
    text = text,
    createdAt = createdAt,
    actionsJson = ChatActionsJson.encode(actions),
)
