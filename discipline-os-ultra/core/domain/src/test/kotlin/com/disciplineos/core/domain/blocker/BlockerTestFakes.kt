package com.disciplineos.core.domain.blocker

import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

val TEST_ZONE: ZoneId = ZoneId.of("Asia/Jerusalem")

fun localInstant(y: Int, m: Int, d: Int, h: Int, min: Int = 0): Instant =
    LocalDateTime.of(y, m, d, h, min).atZone(TEST_ZONE).toInstant()

fun task(
    id: Long,
    kind: TaskKind = TaskKind.MANDATORY,
    priority: Priority = Priority.MEDIUM,
    archived: Boolean = false,
    title: String = "task-$id",
): Task = Task(
    id = id,
    title = title,
    kind = kind,
    priority = priority,
    startDate = LocalDate.of(2026, 1, 1),
    zoneId = TEST_ZONE.id,
    archived = archived,
    createdAt = Instant.EPOCH,
    updatedAt = Instant.EPOCH,
)

fun occ(
    id: Long,
    task: Task,
    date: LocalDate,
    status: OccurrenceStatus = OccurrenceStatus.PENDING,
    dueAt: Instant? = null,
    snoozedUntil: Instant? = null,
): OccurrenceWithTask = OccurrenceWithTask(
    occurrence = TaskOccurrence(
        id = id,
        taskId = task.id,
        localDate = date,
        dueAt = dueAt,
        status = status,
        snoozedUntil = snoozedUntil,
        snoozeCount = if (snoozedUntil != null) 1 else 0,
    ),
    task = task,
)

class FakeBlockerRepository(config: BlockerConfig = BlockerConfig(enabled = true)) : BlockerRepository {
    val config = MutableStateFlow(config)
    val apps = MutableStateFlow<List<BlockedApp>>(emptyList())
    val bypasses = MutableStateFlow<List<BypassSession>>(emptyList())
    val observedSince = mutableListOf<Instant>()
    private var nextId = 1L

    override fun observeConfig(): Flow<BlockerConfig> = config
    override fun observeBlockedApps(): Flow<List<BlockedApp>> = apps
    override fun observeBypasses(since: Instant): Flow<List<BypassSession>> {
        observedSince += since
        return bypasses.map { list -> list.filter { !it.startedAt.isBefore(since) } }
    }

    override suspend fun updateConfig(transform: (BlockerConfig) -> BlockerConfig) = config.update(transform)
    override suspend fun setBlockedApps(apps: List<BlockedApp>) {
        this.apps.value = apps
    }

    override suspend fun setAppEnabled(packageName: String, enabled: Boolean) =
        apps.update { list -> list.map { if (it.packageName == packageName) it.copy(enabled = enabled) else it } }

    override suspend fun insertBypass(session: BypassSession): Long {
        val id = nextId++
        bypasses.update { it + session.copy(id = id) }
        return id
    }

    override suspend fun endBypassEarly(id: Long, at: Instant) =
        bypasses.update { list -> list.map { if (it.id == id) it.copy(endedEarlyAt = at) else it } }
}

/** Only [observeOpenOccurrences] is used by the blocker; everything else is unsupported. */
class FakeTaskRepository : TaskRepository {
    val occurrences = MutableStateFlow<List<OccurrenceWithTask>>(emptyList())
    val subscribedDates = mutableListOf<LocalDate>()

    override fun observeOpenOccurrences(onOrBefore: LocalDate): Flow<List<OccurrenceWithTask>> {
        subscribedDates += onOrBefore
        return occurrences.map { list -> list.filter { !it.occurrence.localDate.isAfter(onOrBefore) } }
    }

    private fun no(): Nothing = throw UnsupportedOperationException("not used by blocker")
    override fun observeTasks(includeArchived: Boolean): Flow<List<Task>> = no()
    override fun observeTask(taskId: Long): Flow<Task?> = no()
    override fun observeSubTasks(taskId: Long): Flow<List<SubTask>> = no()
    override fun observeOccurrences(from: LocalDate, to: LocalDate): Flow<List<OccurrenceWithTask>> = no()
    override fun observeCategories(): Flow<List<Category>> = no()
    override fun observeHistory(taskId: Long): Flow<List<TaskHistoryEntry>> = no()
    override suspend fun getTask(taskId: Long): Task? = no()
    override suspend fun getAllActiveTasks(): List<Task> = no()
    override suspend fun getOccurrences(taskId: Long, from: LocalDate, to: LocalDate): List<TaskOccurrence> = no()
    override suspend fun getOccurrence(occurrenceId: Long): TaskOccurrence? = no()
    override suspend fun upsertTask(task: Task): Long = no()
    override suspend fun replaceSubTasks(taskId: Long, subTasks: List<SubTask>) = no()
    override suspend fun setSubTaskDone(subTaskId: Long, done: Boolean) = no()
    override suspend fun deleteTask(taskId: Long) = no()
    override suspend fun insertOccurrencesIfAbsent(occurrences: List<TaskOccurrence>) = no()
    override suspend fun deletePendingOccurrencesFrom(taskId: Long, from: LocalDate) = no()
    override suspend fun updateOccurrence(occurrence: TaskOccurrence) = no()
    override suspend fun upsertCategory(category: Category): Long = no()
    override suspend fun appendHistory(entry: TaskHistoryEntry) = no()
}
