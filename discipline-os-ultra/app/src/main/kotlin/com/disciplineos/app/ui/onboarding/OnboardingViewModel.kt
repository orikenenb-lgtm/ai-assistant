package com.disciplineos.app.ui.onboarding

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskInput
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.TaskKind
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class OnboardingUiState(
    val taskTitle: String = "",
    val taskDaily: Boolean = true,
    val creatingTask: Boolean = false,
    val createdTaskTitle: String? = null,
    @StringRes val taskErrorRes: Int? = null,
    val finishing: Boolean = false,
    @StringRes val finishErrorRes: Int? = null,
)

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val taskCommands: TaskCommands,
    private val time: TimeProvider,
) : ViewModel() {

    private val _state = MutableStateFlow(OnboardingUiState())
    val state: StateFlow<OnboardingUiState> = _state.asStateFlow()

    fun onTitleChange(title: String) {
        _state.value = _state.value.copy(taskTitle = title.take(OnboardingLogic.MAX_TITLE), taskErrorRes = null)
    }

    fun onDailyChange(daily: Boolean) {
        _state.value = _state.value.copy(taskDaily = daily)
    }

    /** Creates the first mandatory task. [onDone] runs only on success. Blank title → nothing to create. */
    fun createFirstTask(onDone: () -> Unit) {
        val s = _state.value
        if (s.creatingTask) return
        if (!OnboardingLogic.isTitleValid(s.taskTitle)) {
            _state.value = s.copy(taskErrorRes = R.string.feat_onb_task_error_blank)
            return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(creatingTask = true, taskErrorRes = null)
            val input = TaskInput(
                title = s.taskTitle.trim(),
                kind = TaskKind.MANDATORY,
                priority = Priority.HIGH,
                startDate = time.today(),
                recurrence = if (s.taskDaily) RecurrenceRule.Daily() else RecurrenceRule.None,
            )
            val result = runCatching { taskCommands.createTask(input) }.getOrNull()
            _state.value = when (result) {
                is TaskResult.Success -> _state.value.copy(creatingTask = false, createdTaskTitle = input.title, taskTitle = "")
                is TaskResult.Failure -> _state.value.copy(creatingTask = false, taskErrorRes = errorFor(result.error))
                null -> _state.value.copy(creatingTask = false, taskErrorRes = R.string.feat_onb_task_error_generic)
            }
            if (result is TaskResult.Success) onDone()
        }
    }

    fun finish(onFinished: () -> Unit) {
        if (_state.value.finishing) return
        viewModelScope.launch {
            _state.value = _state.value.copy(finishing = true, finishErrorRes = null)
            val ok = runCatching { settingsRepository.updateSettings { it.copy(onboardingCompleted = true) } }.isSuccess
            _state.value = _state.value.copy(finishing = false, finishErrorRes = if (ok) null else R.string.feat_onb_finish_error)
            if (ok) onFinished()
        }
    }

    private fun errorFor(error: TaskError): Int = when (error) {
        TaskError.TITLE_BLANK -> R.string.feat_onb_task_error_blank
        TaskError.TITLE_TOO_LONG -> R.string.feat_onb_task_error_long
        else -> R.string.feat_onb_task_error_generic
    }
}
