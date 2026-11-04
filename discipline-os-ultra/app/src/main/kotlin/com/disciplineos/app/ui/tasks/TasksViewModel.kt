package com.disciplineos.app.ui.tasks

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.ui.common.UiState
import com.disciplineos.app.ui.common.deferredFlow
import com.disciplineos.app.ui.common.messageRes
import com.disciplineos.app.ui.common.requiredMessageRes
import com.disciplineos.app.ui.common.safeCall
import com.disciplineos.app.ui.common.tickerFlow
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.Category
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskKind
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import javax.inject.Inject

enum class KindFilter { ALL, MANDATORY, OPTIONAL }

data class TasksFilter(
    val kind: KindFilter = KindFilter.ALL,
    val categoryId: Long? = null,
    val query: String = "",
) {
    val isActive: Boolean get() = kind != KindFilter.ALL || categoryId != null || query.isNotBlank()
}

data class TasksContent(
    val overdue: List<OccurrenceWithTask>,
    val today: List<OccurrenceWithTask>,
    val upcoming: List<OccurrenceWithTask>,
    /** One-off tasks that start beyond the materialized window (no occurrence yet). */
    val later: List<Task>,
    val recurring: List<Task>,
) {
    val isEmpty: Boolean get() = overdue.isEmpty() && today.isEmpty() && upcoming.isEmpty() && later.isEmpty() && recurring.isEmpty()
}

data class TasksUiState(
    val today: LocalDate,
    val now: Instant,
    val filter: TasksFilter = TasksFilter(),
    val categories: List<Category> = emptyList(),
    val content: UiState<TasksContent> = UiState.Loading,
    val busyOccurrences: Set<Long> = emptySet(),
)

sealed interface TasksEvent {
    data class Message(@StringRes val text: Int, val openTaskId: Long? = null) : TasksEvent
}

internal data class RawTasks(
    val window: List<OccurrenceWithTask>,
    val open: List<OccurrenceWithTask>,
    val tasks: List<Task>,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class TasksViewModel @Inject constructor(
    private val repo: TaskRepository,
    private val commands: TaskCommands,
    private val time: TimeProvider,
) : ViewModel() {

    private val filter = MutableStateFlow(TasksFilter())
    private val busy = MutableStateFlow<Set<Long>>(emptySet())
    private val retryTrigger = MutableStateFlow(0)
    private val eventChannel = Channel<TasksEvent>(Channel.BUFFERED)
    val events: Flow<TasksEvent> = eventChannel.receiveAsFlow()

    private val now: Flow<Instant> = tickerFlow(60_000).map { time.now() }
    private val todayFlow: Flow<LocalDate> = now.map { it.atZone(time.zone()).toLocalDate() }.distinctUntilChanged()

    private val categories: Flow<List<Category>> = deferredFlow { repo.observeCategories() }
        .catch { emit(emptyList()) }

    private val raw: Flow<Result<RawTasks>> = combine(todayFlow, retryTrigger) { day, _ -> day }.flatMapLatest { day ->
        combine(
            deferredFlow { repo.observeOccurrences(day, day.plusDays(WINDOW_DAYS)) },
            deferredFlow { repo.observeOpenOccurrences(day.minusDays(1)) },
            deferredFlow { repo.observeTasks(includeArchived = false) },
        ) { window, open, tasks -> Result.success(RawTasks(window, open, tasks)) }
            .catch { emit(Result.failure(it)) }
    }

    private val initial = time.now().let { TasksUiState(today = it.atZone(time.zone()).toLocalDate(), now = it) }

    val uiState: StateFlow<TasksUiState> = combine(now, filter, categories, raw, busy) { now, filter, categories, raw, busy ->
        val day = now.atZone(time.zone()).toLocalDate()
        val content: UiState<TasksContent> = raw.fold(
            onSuccess = { data ->
                val all = buildContent(data, day)
                val filtered = all.filtered(filter)
                when {
                    all.isEmpty -> UiState.Empty
                    else -> UiState.Success(filtered)
                }
            },
            onFailure = { UiState.Error(it.message ?: it.javaClass.simpleName) },
        )
        TasksUiState(today = day, now = now, filter = filter, categories = categories, content = content, busyOccurrences = busy)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)

    fun setKind(kind: KindFilter) = filter.update { it.copy(kind = kind) }
    fun setCategory(categoryId: Long?) = filter.update { it.copy(categoryId = if (it.categoryId == categoryId) null else categoryId) }
    fun setQuery(query: String) = filter.update { it.copy(query = query) }
    fun clearFilters() = filter.update { TasksFilter() }
    fun retry() = retryTrigger.update { it + 1 }

    fun setCompleted(item: OccurrenceWithTask, completed: Boolean) {
        val id = item.occurrence.id
        if (id in busy.value) return
        busy.update { it + id }
        viewModelScope.launch {
            safeCall { if (completed) commands.completeOccurrence(id) else commands.uncompleteOccurrence(id) }.fold(
                onSuccess = { result ->
                    if (result is TaskResult.Failure) {
                        val event = when (result.error) {
                            TaskError.VERIFICATION_REQUIRED ->
                                TasksEvent.Message(item.task.verification.requiredMessageRes(), item.task.id)
                            TaskError.DEPENDENCIES_INCOMPLETE -> TasksEvent.Message(result.error.messageRes(), item.task.id)
                            else -> TasksEvent.Message(result.error.messageRes())
                        }
                        eventChannel.send(event)
                    }
                },
                onFailure = { eventChannel.send(TasksEvent.Message(R.string.core_error_generic)) },
            )
            busy.update { it - id }
        }
    }

    private fun buildContent(data: RawTasks, today: LocalDate): TasksContent {
        val overdue = data.open
            .filter { it.occurrence.status == OccurrenceStatus.PENDING && it.occurrence.localDate.isBefore(today) }
            .distinctBy { it.occurrence.id }
            .sortedWith(compareBy<OccurrenceWithTask> { it.occurrence.localDate }.thenBy { it.task.dueTime ?: LocalTime.MAX })
        val todayItems = data.window
            .filter { it.occurrence.localDate == today }
            .sortedWith(
                compareBy<OccurrenceWithTask> { it.occurrence.status != OccurrenceStatus.PENDING }
                    .thenBy { it.task.kind != TaskKind.MANDATORY }
                    .thenBy { it.task.dueTime ?: LocalTime.MAX }
                    .thenByDescending { it.task.priority.weight },
            )
        val upcoming = data.window
            .filter { it.occurrence.localDate.isAfter(today) && it.task.recurrence == RecurrenceRule.None }
            .sortedWith(compareBy<OccurrenceWithTask> { it.occurrence.localDate }.thenBy { it.task.dueTime ?: LocalTime.MAX })
        val windowEnd = today.plusDays(WINDOW_DAYS)
        val later = data.tasks
            .filter { it.recurrence == RecurrenceRule.None && it.startDate.isAfter(windowEnd) }
            .sortedBy { it.startDate }
        val recurring = data.tasks
            .filter { it.recurrence != RecurrenceRule.None }
            .sortedWith(compareBy<Task> { it.kind != TaskKind.MANDATORY }.thenBy { it.title })
        return TasksContent(overdue, todayItems, upcoming, later, recurring)
    }

    private fun TasksContent.filtered(filter: TasksFilter): TasksContent {
        if (!filter.isActive) return this
        val q = filter.query.trim()
        fun matches(task: Task): Boolean {
            val kindOk = when (filter.kind) {
                KindFilter.ALL -> true
                KindFilter.MANDATORY -> task.kind == TaskKind.MANDATORY
                KindFilter.OPTIONAL -> task.kind == TaskKind.OPTIONAL
            }
            val categoryOk = filter.categoryId == null || task.categoryId == filter.categoryId
            val queryOk = q.isEmpty() || task.title.contains(q, ignoreCase = true) || task.notes.contains(q, ignoreCase = true)
            return kindOk && categoryOk && queryOk
        }
        return TasksContent(
            overdue = overdue.filter { matches(it.task) },
            today = this.today.filter { matches(it.task) },
            upcoming = upcoming.filter { matches(it.task) },
            later = later.filter(::matches),
            recurring = recurring.filter(::matches),
        )
    }

    private companion object {
        const val WINDOW_DAYS = 14L
    }
}
