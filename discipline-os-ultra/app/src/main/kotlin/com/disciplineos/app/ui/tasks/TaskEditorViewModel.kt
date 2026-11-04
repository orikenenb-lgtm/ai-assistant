package com.disciplineos.app.ui.tasks

import androidx.annotation.StringRes
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.ui.common.messageRes
import com.disciplineos.app.ui.common.safeCall
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskInput
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.Category
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.VerificationMethod
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import javax.inject.Inject

enum class RecurrenceType { NONE, DAILY, WEEKLY, MONTHLY }

enum class EditorField { TITLE, NOTES, DATES, RECURRENCE, REMINDERS, ESTIMATE, SUBTASKS, DEPENDENCIES }

data class EditorForm(
    val title: String = "",
    val notes: String = "",
    val kind: TaskKind = TaskKind.OPTIONAL,
    val priority: Priority = Priority.MEDIUM,
    val categoryId: Long? = null,
    val startDate: LocalDate,
    val dueTime: LocalTime? = null,
    val endDate: LocalDate? = null,
    val recurrenceType: RecurrenceType = RecurrenceType.NONE,
    val dailyEvery: Int = 1,
    val weeklyDays: Set<DayOfWeek> = setOf(startDate.dayOfWeek),
    val weeklyEvery: Int = 1,
    val reminderOffsets: Set<Int> = emptySet(),
    val estimateMinutes: Int? = null,
    val verification: VerificationMethod = VerificationMethod.NONE,
    val dependsOn: Set<Long> = emptySet(),
    val subTasks: List<String> = emptyList(),
)

data class TaskEditorUiState(
    val isNew: Boolean,
    val loading: Boolean,
    val notFound: Boolean = false,
    val form: EditorForm,
    val categories: List<Category> = emptyList(),
    /** Candidate dependencies: every other active task. */
    val otherTasks: List<Task> = emptyList(),
    val saving: Boolean = false,
    val fieldErrors: Map<EditorField, Int> = emptyMap(),
)

sealed interface TaskEditorEvent {
    data object Saved : TaskEditorEvent
    data class Message(@StringRes val text: Int) : TaskEditorEvent
}

@HiltViewModel
class TaskEditorViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val repo: TaskRepository,
    private val commands: TaskCommands,
    time: TimeProvider,
) : ViewModel() {

    private val taskId: Long = savedStateHandle.get<Long>("taskId") ?: -1L
    private val isNew = taskId <= 0L

    private val _state = MutableStateFlow(
        TaskEditorUiState(isNew = isNew, loading = !isNew, form = EditorForm(startDate = time.today())),
    )
    val state: StateFlow<TaskEditorUiState> = _state.asStateFlow()

    private val eventChannel = Channel<TaskEditorEvent>(Channel.BUFFERED)
    val events: Flow<TaskEditorEvent> = eventChannel.receiveAsFlow()

    init {
        viewModelScope.launch {
            runCatchingFlow { repo.observeCategories() }.collect { list -> _state.update { it.copy(categories = list) } }
        }
        viewModelScope.launch {
            runCatchingFlow { repo.observeTasks(includeArchived = false) }.collect { list ->
                _state.update { s -> s.copy(otherTasks = list.filter { it.id != taskId }.sortedBy { it.title }) }
            }
        }
        if (!isNew) load()
    }

    private fun <T> runCatchingFlow(block: () -> Flow<List<T>>): Flow<List<T>> =
        com.disciplineos.app.ui.common.deferredFlow(block).catch { emit(emptyList()) }

    private fun load() {
        viewModelScope.launch {
            val loaded = safeCall {
                val task = repo.getTask(taskId) ?: return@safeCall null
                val subTasks = repo.observeSubTasks(taskId).first().sortedBy { it.position }.map { it.title }
                task to subTasks
            }
            val pair = loaded.getOrNull()
            if (pair == null) {
                _state.update { it.copy(loading = false, notFound = true) }
                if (loaded.isFailure) eventChannel.send(TaskEditorEvent.Message(R.string.core_error_generic))
                return@launch
            }
            val (task, subTasks) = pair
            _state.update { it.copy(loading = false, form = task.toForm(subTasks)) }
        }
    }

    fun update(transform: (EditorForm) -> EditorForm) {
        _state.update { s ->
            val next = transform(s.form)
            s.copy(form = next, fieldErrors = s.fieldErrors.clearedFor(s.form, next))
        }
    }

    fun createCategory(name: String, colorHex: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        viewModelScope.launch {
            safeCall { commands.createCategory(trimmed, colorHex, "label") }.fold(
                onSuccess = { result ->
                    when (result) {
                        is TaskResult.Success -> update { it.copy(categoryId = result.value) }
                        is TaskResult.Failure -> eventChannel.send(TaskEditorEvent.Message(result.error.messageRes()))
                    }
                },
                onFailure = { eventChannel.send(TaskEditorEvent.Message(R.string.core_error_generic)) },
            )
        }
    }

    fun save() {
        val current = _state.value
        if (current.saving || current.loading || current.notFound) return
        val form = current.form
        val localErrors = validate(form)
        if (localErrors.isNotEmpty()) {
            _state.update { it.copy(fieldErrors = localErrors) }
            viewModelScope.launch { eventChannel.send(TaskEditorEvent.Message(R.string.core_editor_fix_errors)) }
            return
        }
        _state.update { it.copy(saving = true, fieldErrors = emptyMap()) }
        viewModelScope.launch {
            val input = form.toInput()
            val outcome = safeCall {
                if (isNew) {
                    when (val r = commands.createTask(input)) {
                        is TaskResult.Success -> null
                        is TaskResult.Failure -> r.error
                    }
                } else {
                    when (val r = commands.updateTask(taskId, input)) {
                        is TaskResult.Success -> null
                        is TaskResult.Failure -> r.error
                    }
                }
            }
            outcome.fold(
                onSuccess = { error ->
                    if (error == null) {
                        _state.update { it.copy(saving = false) }
                        eventChannel.send(TaskEditorEvent.Saved)
                    } else {
                        val field = error.field()
                        _state.update { s ->
                            s.copy(saving = false, fieldErrors = if (field != null) mapOf(field to error.messageRes()) else emptyMap())
                        }
                        eventChannel.send(TaskEditorEvent.Message(error.messageRes()))
                    }
                },
                onFailure = {
                    _state.update { it.copy(saving = false) }
                    eventChannel.send(TaskEditorEvent.Message(R.string.core_error_generic))
                },
            )
        }
    }

    private fun validate(form: EditorForm): Map<EditorField, Int> = buildMap {
        if (form.title.isBlank()) put(EditorField.TITLE, R.string.core_err_title_blank)
        if (form.title.length > TITLE_MAX) put(EditorField.TITLE, R.string.core_err_title_too_long)
        if (form.notes.length > NOTES_MAX) put(EditorField.NOTES, R.string.core_err_notes_too_long)
        val end = form.endDate
        if (form.recurrenceType != RecurrenceType.NONE && end != null && end.isBefore(form.startDate)) {
            put(EditorField.DATES, R.string.core_err_invalid_date_range)
        }
        if (form.recurrenceType == RecurrenceType.WEEKLY && form.weeklyDays.isEmpty()) {
            put(EditorField.RECURRENCE, R.string.core_editor_weekly_days_required)
        }
        if (form.subTasks.size > SUBTASKS_MAX) put(EditorField.SUBTASKS, R.string.core_err_too_many_subtasks)
    }

    private fun Map<EditorField, Int>.clearedFor(old: EditorForm, new: EditorForm): Map<EditorField, Int> {
        if (isEmpty()) return this
        val cleared = toMutableMap()
        if (old.title != new.title) cleared.remove(EditorField.TITLE)
        if (old.notes != new.notes) cleared.remove(EditorField.NOTES)
        if (old.startDate != new.startDate || old.endDate != new.endDate || old.recurrenceType != new.recurrenceType) cleared.remove(EditorField.DATES)
        if (old.weeklyDays != new.weeklyDays || old.recurrenceType != new.recurrenceType) cleared.remove(EditorField.RECURRENCE)
        if (old.reminderOffsets != new.reminderOffsets || old.dueTime != new.dueTime) cleared.remove(EditorField.REMINDERS)
        if (old.estimateMinutes != new.estimateMinutes) cleared.remove(EditorField.ESTIMATE)
        if (old.subTasks != new.subTasks) cleared.remove(EditorField.SUBTASKS)
        if (old.dependsOn != new.dependsOn) cleared.remove(EditorField.DEPENDENCIES)
        return cleared
    }

    companion object {
        const val TITLE_MAX = 120
        const val NOTES_MAX = 2_000
        const val SUBTASKS_MAX = 20
        const val SUBTASK_TITLE_MAX = 120
        val REMINDER_OPTIONS = listOf(0, 5, 10, 15, 30, 60, 120, 1_440)
        val ESTIMATE_OPTIONS = listOf(10, 15, 25, 30, 45, 60, 90, 120, 180)
    }
}

private fun TaskError.field(): EditorField? = when (this) {
    TaskError.TITLE_BLANK, TaskError.TITLE_TOO_LONG -> EditorField.TITLE
    TaskError.NOTES_TOO_LONG -> EditorField.NOTES
    TaskError.INVALID_DATE_RANGE -> EditorField.DATES
    TaskError.INVALID_REMINDER -> EditorField.REMINDERS
    TaskError.INVALID_ESTIMATE -> EditorField.ESTIMATE
    TaskError.TOO_MANY_SUBTASKS -> EditorField.SUBTASKS
    TaskError.DEPENDENCY_NOT_FOUND, TaskError.DEPENDENCY_CYCLE, TaskError.DEPENDENCIES_INCOMPLETE -> EditorField.DEPENDENCIES
    else -> null
}

private fun Task.toForm(subTasks: List<String>): EditorForm {
    val base = EditorForm(
        title = title,
        notes = notes,
        kind = kind,
        priority = priority,
        categoryId = categoryId,
        startDate = startDate,
        dueTime = dueTime,
        endDate = endDate,
        reminderOffsets = reminderOffsetsMinutes.toSet(),
        estimateMinutes = estimatedMinutes,
        verification = verification,
        dependsOn = dependsOn,
        subTasks = subTasks,
    )
    return when (val rule = recurrence) {
        RecurrenceRule.None -> base
        is RecurrenceRule.Daily -> base.copy(recurrenceType = RecurrenceType.DAILY, dailyEvery = rule.everyNDays)
        is RecurrenceRule.Weekly -> base.copy(recurrenceType = RecurrenceType.WEEKLY, weeklyDays = rule.daysOfWeek, weeklyEvery = rule.everyNWeeks)
        is RecurrenceRule.Monthly -> base.copy(recurrenceType = RecurrenceType.MONTHLY)
    }
}

internal fun EditorForm.recurrenceRule(): RecurrenceRule = when (recurrenceType) {
    RecurrenceType.NONE -> RecurrenceRule.None
    RecurrenceType.DAILY -> RecurrenceRule.Daily(dailyEvery.coerceIn(1, 365))
    RecurrenceType.WEEKLY -> RecurrenceRule.Weekly(weeklyDays.ifEmpty { setOf(startDate.dayOfWeek) }, weeklyEvery.coerceIn(1, 52))
    RecurrenceType.MONTHLY -> RecurrenceRule.Monthly(startDate.dayOfMonth)
}

private fun EditorForm.toInput(): TaskInput = TaskInput(
    title = title.trim(),
    notes = notes.trim(),
    kind = kind,
    priority = priority,
    categoryId = categoryId,
    startDate = startDate,
    dueTime = dueTime,
    endDate = if (recurrenceType == RecurrenceType.NONE) null else endDate,
    recurrence = recurrenceRule(),
    // Reminders are offsets before the due time, so they only apply when a time is set.
    reminderOffsetsMinutes = if (dueTime == null) emptyList() else reminderOffsets.sorted(),
    estimatedMinutes = estimateMinutes,
    verification = verification,
    dependsOn = dependsOn,
    subTasks = subTasks.map { it.trim() }.filter { it.isNotEmpty() },
)
