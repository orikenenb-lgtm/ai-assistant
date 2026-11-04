package com.disciplineos.app.data.local.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Update
import androidx.room.Upsert
import com.disciplineos.app.data.local.entity.CategoryEntity
import com.disciplineos.app.data.local.entity.OccurrenceWithTaskRelation
import com.disciplineos.app.data.local.entity.SubTaskEntity
import com.disciplineos.app.data.local.entity.TaskDependencyEntity
import com.disciplineos.app.data.local.entity.TaskEntity
import com.disciplineos.app.data.local.entity.TaskHistoryEntity
import com.disciplineos.app.data.local.entity.TaskOccurrenceEntity
import com.disciplineos.app.data.local.entity.TaskWithDependencies
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate

/**
 * Tasks, dependencies, sub-tasks, occurrences, categories and history.
 *
 * IMPORTANT: tasks are never written with `OnConflictStrategy.REPLACE`. REPLACE deletes the old row first,
 * which would cascade-delete every occurrence, sub-task and dependency of the task. `@Upsert` updates in place.
 */
@Dao
interface TaskDao {

    // ---------- tasks ----------

    @Transaction
    @Query("SELECT * FROM tasks WHERE archived = 0 OR :includeArchived ORDER BY createdAt ASC, id ASC")
    fun observeTasks(includeArchived: Boolean): Flow<List<TaskWithDependencies>>

    @Transaction
    @Query("SELECT * FROM tasks WHERE id = :taskId")
    fun observeTask(taskId: Long): Flow<TaskWithDependencies?>

    @Transaction
    @Query("SELECT * FROM tasks WHERE id = :taskId")
    suspend fun getTask(taskId: Long): TaskWithDependencies?

    @Transaction
    @Query("SELECT * FROM tasks WHERE archived = 0 ORDER BY id ASC")
    suspend fun getAllActiveTasks(): List<TaskWithDependencies>

    @Query("SELECT id FROM tasks WHERE id IN (:ids)")
    suspend fun existingTaskIds(ids: List<Long>): List<Long>

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertTask(task: TaskEntity): Long

    @Update
    suspend fun updateTask(task: TaskEntity): Int

    @Query("DELETE FROM tasks WHERE id = :taskId")
    suspend fun deleteTask(taskId: Long): Int

    // ---------- dependencies ----------

    @Query("DELETE FROM task_dependencies WHERE taskId = :taskId")
    suspend fun deleteDependencies(taskId: Long)

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertDependencies(edges: List<TaskDependencyEntity>)

    // ---------- sub-tasks ----------

    @Query("SELECT * FROM sub_tasks WHERE taskId = :taskId ORDER BY position ASC, id ASC")
    fun observeSubTasks(taskId: Long): Flow<List<SubTaskEntity>>

    @Query("DELETE FROM sub_tasks WHERE taskId = :taskId")
    suspend fun deleteSubTasksForTask(taskId: Long)

    @Query("DELETE FROM sub_tasks WHERE taskId = :taskId AND id NOT IN (:keepIds)")
    suspend fun deleteSubTasksNotIn(taskId: Long, keepIds: List<Long>)

    @Upsert
    suspend fun upsertSubTasks(subTasks: List<SubTaskEntity>)

    @Query("UPDATE sub_tasks SET done = :done WHERE id = :subTaskId")
    suspend fun setSubTaskDone(subTaskId: Long, done: Boolean)

    // ---------- occurrences ----------

    @Transaction
    @Query(
        """
        SELECT * FROM task_occurrences
        WHERE localDate BETWEEN :from AND :to
        ORDER BY localDate ASC, (dueAt IS NULL) ASC, dueAt ASC, id ASC
        """,
    )
    fun observeOccurrences(from: LocalDate, to: LocalDate): Flow<List<OccurrenceWithTaskRelation>>

    /**
     * Open = not COMPLETED and not SKIPPED (i.e. PENDING or MISSED), on or before [onOrBefore], for tasks
     * that are not archived. Uses the (status, localDate) index.
     */
    @Transaction
    @Query(
        """
        SELECT o.* FROM task_occurrences AS o
        INNER JOIN tasks AS t ON t.id = o.taskId
        WHERE o.status IN ('PENDING', 'MISSED') AND o.localDate <= :onOrBefore AND t.archived = 0
        ORDER BY o.localDate ASC, (o.dueAt IS NULL) ASC, o.dueAt ASC, o.id ASC
        """,
    )
    fun observeOpenOccurrences(onOrBefore: LocalDate): Flow<List<OccurrenceWithTaskRelation>>

    @Query(
        """
        SELECT * FROM task_occurrences
        WHERE taskId = :taskId AND localDate BETWEEN :from AND :to
        ORDER BY localDate ASC
        """,
    )
    suspend fun getOccurrences(taskId: Long, from: LocalDate, to: LocalDate): List<TaskOccurrenceEntity>

    @Query("SELECT * FROM task_occurrences WHERE id = :occurrenceId")
    suspend fun getOccurrence(occurrenceId: Long): TaskOccurrenceEntity?

    /** Rows that collide with the unique (taskId, localDate) index are skipped; returns -1 for those. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertOccurrencesIgnore(occurrences: List<TaskOccurrenceEntity>): List<Long>

    @Query("DELETE FROM task_occurrences WHERE taskId = :taskId AND status = 'PENDING' AND localDate >= :from")
    suspend fun deletePendingOccurrencesFrom(taskId: Long, from: LocalDate): Int

    @Update
    suspend fun updateOccurrence(occurrence: TaskOccurrenceEntity): Int

    // ---------- categories ----------

    @Query("SELECT * FROM categories ORDER BY name COLLATE NOCASE ASC, id ASC")
    fun observeCategories(): Flow<List<CategoryEntity>>

    @Upsert
    suspend fun upsertCategory(category: CategoryEntity): Long

    // ---------- history ----------

    @Query("SELECT * FROM task_history WHERE taskId = :taskId ORDER BY at DESC, id DESC")
    fun observeHistory(taskId: Long): Flow<List<TaskHistoryEntity>>

    @Insert
    suspend fun insertHistory(entry: TaskHistoryEntity): Long
}
