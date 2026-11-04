package com.disciplineos.app.ui.tasks

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.ui.common.deferredFlow
import com.disciplineos.app.ui.common.messageRes
import com.disciplineos.app.ui.common.requiredMessageRes
import com.disciplineos.app.ui.common.safeCall
import com.disciplineos.app.ui.common.tickerFlow
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.Category
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.SubTask
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskHistoryEntry
import com.disciplineos.core.model.TaskOccurrence
import com.disciplineos.core.model.VerificationMethod
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
import javax.inject.Inject

data class TaskDetailUiState(
    val loading: Boolean = true,
    val error: Boolean = false,
    val notFound: Boolean = false,
    val task: Task? = null,
    val subTasks: List<SubTask> = emptyList(),
    /** Occurrences around today (−30 … +60 days), sorted by date. */
    val occurrences: List<TaskOccurrence> = emptyList(),
    val selected: TaskOccurrence? = null,
    val history: List<TaskHistoryEntry> = emptyList(),
    val categoryName: String? = null,
    val dependencyTitles: List<String> = emptyList(),
    val busy: Boolean = false,
    val today: LocalDate,
    val now: Instant,
)

sealed interface TaskDetailEvent {
    data class Message(@StringRes val text: Int, val offerFocus: Boolean = false) : TaskDetailEvent
    data object Closed : TaskDetailEvent
    data object OpenFocus : TaskDetailEvent
}

internal data class TaskData(
    val task: Task?,
    val subTasks: List<SubTask>,
    val occurrences: List<TaskOccurrence>,
    val history: List<TaskHistoryEntry>,
)

internal data class Lookups(val categories: List<Category>, val allTasks: List<Task>)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class TaskDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repo: TaskRepository,
    private val commands: TaskCommands,
    private val focusManager: FocusSessionManager,
    private val time: TimeProvider,
) : ViewModel() {

    val taskId: Long = savedStateHandle.get<Long>("taskId") ?: -1L

    private val selectedId = MutableStateFlow<Long?>(null)
    private val busy = MutableStateFlow(false)
    private val eventChannel = Channel<TaskDetailEvent>(Channel.BUFFERED)
    val events: Flow<TaskDetailEvent> = eventChannel.receiveAsFlow()

    private val now: Flow<Instant> = tickerFlow(60_000).map { time.now() }
    private val today: Flow<LocalDate> = now.map { it.atZone(time.zone()).toLocalDate() }.distinctUntilChanged()

    private val data: Flow<Result<TaskData>> = today.flatMapLatest { day ->
        combine(
            deferredFlow { repo.observeTask(taskId) },
            deferredFlow { repo.observeSubTasks(taskId) },
            deferredFlow { repo.observeOccurrences(day.minusDays(30), day.plusDays(60)) },
            deferredFlow { repo.observeHistory(taskId) },
        ) { task, subTasks, window, history ->
            Result.success(
                TaskData(
                    task = task,
                    subTasks = subTasks.sortedBy { it.position },
                    occurrences = window.filter { it.task.id == taskId }.map { it.occurrence }.distinctBy { it.id }.sortedBy { it.localDate },
                    history = history.sortedByDescending { it.at },
                ),
            )
        }.catch { emit(Result.failure(it)) }
    }

    private val lookups: Flow<Lookups> = combine(
        deferredFlow { repo.observeCategories() }.catch { emit(emptyList()) },
        deferredFlow { repo.observeTasks(includeArchived = true) }.catch { emit(emptyList()) },
    ) { categories, tasks -> Lookups(categories, tasks) }

    private val initial = time.now().let { TaskDetailUiState(today = it.atZone(time.zone()).toLocalDate(), now = it) }

    val uiState: StateFlow<TaskDetailUiState> = combine(now, data, lookups, selectedId, busy) { now, data, lookups, selectedId, busy ->
        val day = now.atZone(time.zone()).toLocalDate()
        data.fold(
            onSuccess = { d ->
                val task = d.task
                if (task == null) {
                    TaskDetailUiState(loading = false, notFound = true, today = day, now = now)
                } else {
                    TaskDetailUiState(
                        loading = false,
                        task = task,
                        subTasks = d.subTasks,
                        occurrences = d.occurrences,
                        selected = d.occurrences.firstOrNull { it.id == selectedId } ?: defaultOccurrence(d.occurrences, day),
                        history = d.history,
                        categoryName = task.categoryId?.let { id -> lookups.categories.firstOrNull { it.id == id }?.name },
                        dependencyTitles = task.dependsOn.mapNotNull { id -> lookups.allTasks.firstOrNull { it.id == id }?.title },
                        busy = busy,
                        today = day,
                        now = now,
                    )
                }
            },
            onFailure = { TaskDetailUiState(loading = false, error = true, today = day, now = now) },
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)

    fun select(occurrenceId: Long) = selectedId.update { occurrenceId }

    fun complete(note: String? = null) = withSelected { occ ->
        val result = commands.completeOccurrence(occ.id, note?.trim()?.takeIf { it.isNotEmpty() })
        if (result is TaskResult.Failure) {
            val method = uiState.value.task?.verification ?: VerificationMethod.NONE
            if (result.error == TaskError.VERIFICATION_REQUIRED) {
                eventChannel.send(TaskDetailEvent.Message(method.requiredMessageRes(), offerFocus = method == VerificationMethod.FOCUS_TIMER))
            } else {
                eventChannel.send(TaskDetailEvent.Message(result.error.messageRes()))
            }
        } else {
            eventChannel.send(TaskDetailEvent.Message(R.string.core_detail_completed_msg))
        }
    }

    fun uncomplete() = withSelected { occ -> report(commands.uncompleteOccurrence(occ.id)) }

    fun snooze(minutes: Int) = withSelected { occ ->
        val result = commands.snoozeOccurrence(occ.id, minutes)
        if (result is TaskResult.Success) eventChannel.send(TaskDetailEvent.Message(R.string.core_detail_snoozed_msg)) else report(result)
    }

    fun skip(reason: String) = withSelected { occ -> report(commands.skipOccurrence(occ.id, reason.trim())) }

    fun toggleSubTask(subTaskId: Long, done: Boolean) {
        viewModelScope.launch {
            safeCall { commands.toggleSubTask(subTaskId, done) }
                .onFailure { eventChannel.send(TaskDetailEvent.Message(R.string.core_error_generic)) }
        }
    }

    fun delete() = runTaskCommand { commands.deleteTask(taskId) }

    fun archive() = runTaskCommand { commands.archiveTask(taskId) }

    fun startFocus() {
        viewModelScope.launch {
            safeCall { focusManager.start(taskId) }
            eventChannel.send(TaskDetailEvent.OpenFocus)
        }
    }

    private fun runTaskCommand(block: suspend () -> TaskResult<Unit>) {
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            safeCall { block() }.fold(
                onSuccess = { result ->
                    when (result) {
                        is TaskResult.Success -> eventChannel.send(TaskDetailEvent.Closed)
                        is TaskResult.Failure -> eventChannel.send(TaskDetailEvent.Message(result.error.messageRes()))
                    }
                },
                onFailure = { eventChannel.send(TaskDetailEvent.Message(R.string.core_error_generic)) },
            )
            busy.value = false
        }
    }

    private fun withSelected(block: suspend (TaskOccurrence) -> Unit) {
        val occ = uiState.value.selected ?: return
        if (busy.value) return
        busy.value = true
        viewModelScope.launch {
            safeCall { block(occ) }.onFailure { eventChannel.send(TaskDetailEvent.Message(R.string.core_error_generic)) }
            busy.value = false
        }
    }

    private suspend fun report(result: TaskResult<Unit>) {
        if (result is TaskResult.Failure) eventChannel.send(TaskDetailEvent.Message(result.error.messageRes()))
    }

    private fun defaultOccurrence(list: List<TaskOccurrence>, today: LocalDate): TaskOccurrence? =
        // Oldest still-open occurrence up to today (carry-over), else today's, else the next upcoming, else the latest past.
        list.firstOrNull { it.status == OccurrenceStatus.PENDING && !it.localDate.isAfter(today) }
            ?: list.firstOrNull { it.localDate == today }
            ?: list.firstOrNull { it.localDate.isAfter(today) }
            ?: list.lastOrNull()
}
