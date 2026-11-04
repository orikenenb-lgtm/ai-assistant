package com.disciplineos.app.data.local.entity

import androidx.room.Embedded
import androidx.room.Relation

/** A task row plus its dependency ids (needed to build the domain `Task.dependsOn`). */
data class TaskWithDependencies(
    @Embedded val task: TaskEntity,
    @Relation(
        entity = TaskDependencyEntity::class,
        parentColumn = "id",
        entityColumn = "taskId",
        projection = ["dependsOnTaskId"],
    )
    val dependsOn: List<Long>,
)

/**
 * Occurrence + its task (with dependencies) + the task's sub-tasks. Loaded by `@Transaction` queries in
 * [com.disciplineos.app.data.local.dao.TaskDao]: Room runs one query for the occurrences and one batched
 * `IN (...)` query per relation, so this is O(1) queries regardless of row count.
 */
data class OccurrenceWithTaskRelation(
    @Embedded val occurrence: TaskOccurrenceEntity,
    @Relation(
        entity = TaskEntity::class,
        parentColumn = "taskId",
        entityColumn = "id",
    )
    val task: TaskWithDependencies,
    @Relation(
        parentColumn = "taskId",
        entityColumn = "taskId",
    )
    val subTasks: List<SubTaskEntity>,
)
