package com.disciplineos.app.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime

@Entity(tableName = "categories")
data class CategoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val colorHex: String,
    val iconKey: String,
)

/**
 * Task template. Enum-typed model fields are stored as their `name` (TEXT).
 * [recurrence] holds `RecurrenceCodec.encode(rule)`; [reminderOffsets] is a comma-separated list of minutes.
 */
@Entity(
    tableName = "tasks",
    foreignKeys = [
        ForeignKey(
            entity = CategoryEntity::class,
            parentColumns = ["id"],
            childColumns = ["categoryId"],
            onDelete = ForeignKey.SET_NULL,
        ),
    ],
    indices = [Index("categoryId")],
)
data class TaskEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val title: String,
    val notes: String,
    val kind: String,
    val priority: String,
    val categoryId: Long?,
    val startDate: LocalDate,
    val dueTime: LocalTime?,
    val endDate: LocalDate?,
    val zoneId: String,
    val recurrence: String,
    val reminderOffsets: String,
    val estimatedMinutes: Int?,
    val verification: String,
    val archived: Boolean,
    val createdAt: Instant,
    val updatedAt: Instant,
)

/** Edge "taskId depends on dependsOnTaskId". Both ends cascade, so deleting either task removes the edge. */
@Entity(
    tableName = "task_dependencies",
    primaryKeys = ["taskId", "dependsOnTaskId"],
    foreignKeys = [
        ForeignKey(
            entity = TaskEntity::class,
            parentColumns = ["id"],
            childColumns = ["taskId"],
            onDelete = ForeignKey.CASCADE,
        ),
        ForeignKey(
            entity = TaskEntity::class,
            parentColumns = ["id"],
            childColumns = ["dependsOnTaskId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("dependsOnTaskId")],
)
data class TaskDependencyEntity(
    val taskId: Long,
    val dependsOnTaskId: Long,
)

@Entity(
    tableName = "sub_tasks",
    foreignKeys = [
        ForeignKey(
            entity = TaskEntity::class,
            parentColumns = ["id"],
            childColumns = ["taskId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index("taskId")],
)
data class SubTaskEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val taskId: Long,
    val title: String,
    val done: Boolean,
    val position: Int,
)

/**
 * One concrete instance of a task on a local date.
 * - Unique (taskId, localDate) makes materialisation idempotent (`INSERT OR IGNORE`).
 * - (status, localDate) serves the "open occurrences on or before date" query used by the blocker.
 * - [snoozeCount] and [verificationNote] were added in schema version 2 (see Migrations.kt).
 */
@Entity(
    tableName = "task_occurrences",
    foreignKeys = [
        ForeignKey(
            entity = TaskEntity::class,
            parentColumns = ["id"],
            childColumns = ["taskId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        Index(value = ["taskId", "localDate"], unique = true),
        Index(value = ["status", "localDate"]),
    ],
)
data class TaskOccurrenceEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val taskId: Long,
    val localDate: LocalDate,
    val dueAt: Instant?,
    val status: String,
    val completedAt: Instant?,
    val snoozedUntil: Instant?,
    @ColumnInfo(defaultValue = "0") val snoozeCount: Int = 0,
    val verificationNote: String? = null,
)

/**
 * Audit trail. Deliberately has NO foreign key to `tasks`: a DELETED entry must survive the task row.
 * "Delete all my data" (DataWipeRepository) clears it together with everything else.
 */
@Entity(
    tableName = "task_history",
    indices = [Index("taskId")],
)
data class TaskHistoryEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val taskId: Long,
    val occurrenceId: Long?,
    val type: String,
    val at: Instant,
    val detail: String,
)
