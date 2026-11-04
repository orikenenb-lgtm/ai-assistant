package com.disciplineos.core.domain.task

import com.disciplineos.core.domain.repository.ReminderScheduler
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.ClockTimeProvider
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** In-memory [TaskRepository] mirroring the Room semantics the domain relies on. */
class FakeTaskRepository : TaskRepository {
    data class State(
        val tasks: Map<Long, Task> = emptyMap(),
        val subTasks: Map<Long, SubTask> = emptyMap(),
        val occurrences: Map<Long, TaskOccurrence> = emptyMap(),
        val categories: Map<Long, Category> = emptyMap(),
        val history: List<TaskHistoryEntry> = emptyList(),
    )

    val state = MutableStateFlow(State())
    private var nextId = 1L
    private fun newId() = nextId++

    var insertCalls = 0
        private set

    val tasks get() = state.value.tasks
    val occurrences get() = state.value.occurrences.values.sortedWith(compareBy({ it.taskId }, { it.localDate }))
    val history get() = state.value.history

    private fun join(s: State, occ: TaskOccurrence): OccurrenceWithTask? {
        val task = s.tasks[occ.taskId] ?: return null
        return OccurrenceWithTask(occ, task, s.subTasks.values.filter { it.taskId == task.id }.sortedBy { it.position })
    }

    override fun observeTasks(includeArchived: Boolean): Flow<List<Task>> =
        state.map { s -> s.tasks.values.filter { includeArchived || !it.archived }.sortedBy { it.id } }

    override fun observeTask(taskId: Long): Flow<Task?> = state.map { it.tasks[taskId] }

    override fun observeSubTasks(taskId: Long): Flow<List<SubTask>> =
        state.map { s -> s.subTasks.values.filter { it.taskId == taskId }.sortedBy { it.position } }

    override fun observeOccurrences(from: LocalDate, to: LocalDate): Flow<List<OccurrenceWithTask>> = state.map { s ->
        s.occurrences.values.filter { !it.localDate.isBefore(from) && !it.localDate.isAfter(to) }
            .sortedBy { it.id }.mapNotNull { join(s, it) }
    }

    override fun observeOpenOccurrences(onOrBefore: LocalDate): Flow<List<OccurrenceWithTask>> = state.map { s ->
        s.occurrences.values.filter {
            !it.localDate.isAfter(onOrBefore) &&
                it.status != OccurrenceStatus.COMPLETED && it.status != OccurrenceStatus.SKIPPED
        }.sortedBy { it.id }.mapNotNull { join(s, it) }
    }

    override fun observeCategories(): Flow<List<Category>> = state.map { it.categories.values.sortedBy { c -> c.id } }

    override fun observeHistory(taskId: Long): Flow<List<TaskHistoryEntry>> =
        state.map { s -> s.history.filter { it.taskId == taskId } }

    override suspend fun getTask(taskId: Long): Task? = state.value.tasks[taskId]

    override suspend fun getAllActiveTasks(): List<Task> = state.value.tasks.values.filter { !it.archived }.sortedBy { it.id }

    override suspend fun getOccurrences(taskId: Long, from: LocalDate, to: LocalDate): List<TaskOccurrence> =
        state.value.occurrences.values.filter {
            it.taskId == taskId && !it.localDate.isBefore(from) && !it.localDate.isAfter(to)
        }.sortedBy { it.localDate }

    override suspend fun getOccurrence(occurrenceId: Long): TaskOccurrence? = state.value.occurrences[occurrenceId]

    override suspend fun upsertTask(task: Task): Long {
        val id = if (task.id == 0L) newId() else task.id
        state.update { it.copy(tasks = it.tasks + (id to task.copy(id = id))) }
        return id
    }

    override suspend fun replaceSubTasks(taskId: Long, subTasks: List<SubTask>) {
        state.update { s ->
            val kept = s.subTasks.filterValues { it.taskId != taskId }
            val added = subTasks.map { st -> val id = if (st.id == 0L) newId() else st.id; id to st.copy(id = id, taskId = taskId) }
            s.copy(subTasks = kept + added)
        }
    }

    override suspend fun setSubTaskDone(subTaskId: Long, done: Boolean) {
        state.update { s ->
            val st = s.subTasks[subTaskId] ?: return@update s
            s.copy(subTasks = s.subTasks + (subTaskId to st.copy(done = done)))
        }
    }

    override suspend fun deleteTask(taskId: Long) {
        state.update { s ->
            s.copy(
                tasks = s.tasks - taskId,
                subTasks = s.subTasks.filterValues { it.taskId != taskId },
                occurrences = s.occurrences.filterValues { it.taskId != taskId },
            )
        }
    }

    override suspend fun insertOccurrencesIfAbsent(occurrences: List<TaskOccurrence>) {
        insertCalls++
        state.update { s ->
            val map = s.occurrences.toMutableMap()
            for (o in occurrences) {
                if (map.values.any { it.taskId == o.taskId && it.localDate == o.localDate }) continue
                val id = newId()
                map[id] = o.copy(id = id)
            }
            s.copy(occurrences = map)
        }
    }

    override suspend fun deletePendingOccurrencesFrom(taskId: Long, from: LocalDate) {
        state.update { s ->
            s.copy(occurrences = s.occurrences.filterValues {
                !(it.taskId == taskId && it.status == OccurrenceStatus.PENDING && !it.localDate.isBefore(from))
            })
        }
    }

    override suspend fun updateOccurrence(occurrence: TaskOccurrence) {
        state.update { s ->
            require(occurrence.id in s.occurrences) { "unknown occurrence ${occurrence.id}" }
            s.copy(occurrences = s.occurrences + (occurrence.id to occurrence))
        }
    }

    override suspend fun upsertCategory(category: Category): Long {
        val id = if (category.id == 0L) newId() else category.id
        state.update { it.copy(categories = it.categories + (id to category.copy(id = id))) }
        return id
    }

    override suspend fun appendHistory(entry: TaskHistoryEntry) {
        state.update { it.copy(history = it.history + entry.copy(id = (it.history.size + 1).toLong())) }
    }

    // ---- test helpers ----
    fun occurrence(taskId: Long, date: LocalDate): TaskOccurrence =
        state.value.occurrences.values.single { it.taskId == taskId && it.localDate == date }

    fun occurrencesOf(taskId: Long): List<TaskOccurrence> = occurrences.filter { it.taskId == taskId }

    fun subTasksOf(taskId: Long): List<SubTask> =
        state.value.subTasks.values.filter { it.taskId == taskId }.sortedBy { it.position }
}

class FakeReminderScheduler : ReminderScheduler {
    var rescheduleCount = 0
    val cancelled = mutableListOf<Long>()
    override suspend fun rescheduleAll() { rescheduleCount++ }
    override suspend fun cancelForTask(taskId: Long) { cancelled += taskId }
}

/** Records what TaskCommands reports to gamification. */
class RecordingGamification {
    val completed = mutableListOf<Pair<Task, TaskOccurrence>>()
    val dayChecks = mutableListOf<LocalDate>()
    val onCompleted: suspend (Task, TaskOccurrence) -> Unit = { t, o -> completed += t to o }
    val onDayCheck: suspend (LocalDate) -> Unit = { d -> dayChecks += d }
}

val JERUSALEM: ZoneId = ZoneId.of("Asia/Jerusalem")
val NEW_YORK: ZoneId = ZoneId.of("America/New_York")

/** Fixed clock at [date] [time] in [zone]. */
fun fixedTime(date: LocalDate, time: LocalTime = LocalTime.NOON, zone: ZoneId = JERUSALEM): TimeProvider =
    ClockTimeProvider(Clock.fixed(date.atTime(time).atZone(zone).toInstant(), zone))

/** Mutable clock for tests that need time to move. */
class MutableTimeProvider(var instant: Instant, private val zone: ZoneId = JERUSALEM) : TimeProvider {
    override fun now(): Instant = instant
    override fun zone(): ZoneId = zone
}

val T0: Instant = Instant.parse("2026-01-01T00:00:00Z")

fun task(
    id: Long = 0,
    title: String = "Task $id",
    startDate: LocalDate = LocalDate.of(2026, 11, 4),
    recurrence: RecurrenceRule = RecurrenceRule.None,
    endDate: LocalDate? = null,
    dueTime: LocalTime? = null,
    kind: TaskKind = TaskKind.OPTIONAL,
    priority: Priority = Priority.MEDIUM,
    zoneId: String = JERUSALEM.id,
    archived: Boolean = false,
    dependsOn: Set<Long> = emptySet(),
    estimatedMinutes: Int? = null,
    verification: VerificationMethod = VerificationMethod.NONE,
) = Task(
    id = id, title = title, startDate = startDate, recurrence = recurrence, endDate = endDate, dueTime = dueTime,
    kind = kind, priority = priority, zoneId = zoneId, archived = archived, dependsOn = dependsOn,
    estimatedMinutes = estimatedMinutes, verification = verification, createdAt = T0, updatedAt = T0,
)

fun d(s: String): LocalDate = LocalDate.parse(s)
fun t(s: String): LocalTime = LocalTime.parse(s)
