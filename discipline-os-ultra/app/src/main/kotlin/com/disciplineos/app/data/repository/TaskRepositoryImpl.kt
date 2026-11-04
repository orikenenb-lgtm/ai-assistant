package com.disciplineos.app.data.repository

import androidx.room.withTransaction
import com.disciplineos.app.data.local.DisciplineDatabase
import com.disciplineos.app.data.local.dao.TaskDao
import com.disciplineos.app.data.local.entity.TaskDependencyEntity
import com.disciplineos.app.data.mapper.toEntity
import com.disciplineos.app.data.mapper.toModel
import com.disciplineos.app.di.IoDispatcher
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.model.Category
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.SubTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskHistoryEntry
import com.disciplineos.core.model.TaskOccurrence
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import java.time.LocalDate
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Room-backed [TaskRepository]. Room's suspend/Flow APIs already run queries off the main thread; mapping of
 * emitted lists is moved to [io] with `flowOn` so large lists never map on the collector's (UI) thread.
 * Multi-statement writes run in `withTransaction` so observers never see half-applied state.
 */
@Singleton
class TaskRepositoryImpl @Inject constructor(
    private val db: DisciplineDatabase,
    private val dao: TaskDao,
    @IoDispatcher private val io: CoroutineDispatcher,
) : TaskRepository {

    override fun observeTasks(includeArchived: Boolean): Flow<List<Task>> =
        dao.observeTasks(includeArchived).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeTask(taskId: Long): Flow<Task?> =
        dao.observeTask(taskId).map { it?.toModel() }.distinctUntilChanged().flowOn(io)

    override fun observeSubTasks(taskId: Long): Flow<List<SubTask>> =
        dao.observeSubTasks(taskId).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeOccurrences(from: LocalDate, to: LocalDate): Flow<List<OccurrenceWithTask>> =
        dao.observeOccurrences(from, to).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeOpenOccurrences(onOrBefore: LocalDate): Flow<List<OccurrenceWithTask>> =
        dao.observeOpenOccurrences(onOrBefore).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeCategories(): Flow<List<Category>> =
        dao.observeCategories().map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override fun observeHistory(taskId: Long): Flow<List<TaskHistoryEntry>> =
        dao.observeHistory(taskId).map { rows -> rows.map { it.toModel() } }.flowOn(io)

    override suspend fun getTask(taskId: Long): Task? = dao.getTask(taskId)?.toModel()

    override suspend fun getAllActiveTasks(): List<Task> = dao.getAllActiveTasks().map { it.toModel() }

    override suspend fun getOccurrences(taskId: Long, from: LocalDate, to: LocalDate): List<TaskOccurrence> =
        dao.getOccurrences(taskId, from, to).map { it.toModel() }

    override suspend fun getOccurrence(occurrenceId: Long): TaskOccurrence? = dao.getOccurrence(occurrenceId)?.toModel()

    /**
     * Inserts when `id == 0` (or the id does not exist yet), otherwise updates in place (never REPLACE — see
     * TaskDao). Dependencies are rewritten in the same transaction; self-edges and ids of tasks that do not
     * exist are dropped (validation of cycles/existence is the domain's job; this only keeps FKs valid).
     */
    override suspend fun upsertTask(task: Task): Long = db.withTransaction {
        val entity = task.toEntity()
        val id = if (task.id == 0L) {
            dao.insertTask(entity.copy(id = 0))
        } else {
            if (dao.updateTask(entity) == 0) dao.insertTask(entity) else task.id
        }
        dao.deleteDependencies(id)
        val wanted = task.dependsOn.filter { it != id && it > 0 }.distinct()
        if (wanted.isNotEmpty()) {
            val existing = dao.existingTaskIds(wanted).toSet()
            dao.insertDependencies(wanted.filter { it in existing }.map { TaskDependencyEntity(id, it) })
        }
        id
    }

    /** Keeps rows whose id is in [subTasks] (preserving ids), inserts new ones (id == 0), deletes the rest. */
    override suspend fun replaceSubTasks(taskId: Long, subTasks: List<SubTask>) {
        db.withTransaction {
            val keepIds = subTasks.map { it.id }.filter { it != 0L }
            if (keepIds.isEmpty()) dao.deleteSubTasksForTask(taskId) else dao.deleteSubTasksNotIn(taskId, keepIds)
            if (subTasks.isNotEmpty()) {
                dao.upsertSubTasks(subTasks.mapIndexed { index, s -> s.toEntity(taskIdOverride = taskId).copy(position = index) })
            }
        }
    }

    override suspend fun setSubTaskDone(subTaskId: Long, done: Boolean) {
        dao.setSubTaskDone(subTaskId, done)
    }

    /** FK cascades remove sub-tasks, occurrences and dependency edges. History is kept (no FK). */
    override suspend fun deleteTask(taskId: Long) {
        dao.deleteTask(taskId)
    }

    override suspend fun insertOccurrencesIfAbsent(occurrences: List<TaskOccurrence>) {
        if (occurrences.isEmpty()) return
        // id = 0 so Room assigns ids; the unique (taskId, localDate) index makes duplicates no-ops.
        dao.insertOccurrencesIgnore(occurrences.map { it.toEntity().copy(id = 0) })
    }

    override suspend fun deletePendingOccurrencesFrom(taskId: Long, from: LocalDate) {
        dao.deletePendingOccurrencesFrom(taskId, from)
    }

    override suspend fun updateOccurrence(occurrence: TaskOccurrence) {
        dao.updateOccurrence(occurrence.toEntity())
    }

    override suspend fun upsertCategory(category: Category): Long {
        val rowId = dao.upsertCategory(category.toEntity())
        // @Upsert returns -1 when it updated an existing row.
        return if (rowId == -1L) category.id else rowId
    }

    override suspend fun appendHistory(entry: TaskHistoryEntry) {
        dao.insertHistory(entry.toEntity().copy(id = 0))
    }
}
