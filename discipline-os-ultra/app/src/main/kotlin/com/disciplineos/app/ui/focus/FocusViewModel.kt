package com.disciplineos.app.ui.focus

import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.focus.FocusTimerStateMachine
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.TaskKind
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

data class FocusTaskOption(val taskId: Long, val title: String, val mandatory: Boolean)

data class FocusUiState(
    val loading: Boolean = true,
    val phase: FocusPhase = FocusPhase.IDLE,
    val paused: Boolean = false,
    val remainingMillis: Long = 0L,
    val totalMillis: Long = 0L,
    val completedWorkSessions: Int = 0,
    val config: FocusConfig = FocusConfig(),
    val activeTaskId: Long? = null,
    val selectedTaskId: Long? = null,
    val openTasks: List<FocusTaskOption> = emptyList(),
    val blockerConfig: BlockerConfig = BlockerConfig(),
    val busy: Boolean = false,
    @StringRes val errorRes: Int? = null,
) {
    val running: Boolean get() = phase != FocusPhase.IDLE && !paused
    val elapsedFraction: Float get() = FocusFormat.elapsedFraction(remainingMillis, totalMillis)
    val filledDots: Int get() = FocusFormat.filledDots(completedWorkSessions, config.sessionsBeforeLongBreak, phase)
    /** The task shown as "working on": the live session's task, or the user's pick while idle. */
    val displayTaskTitle: String?
        get() {
            val id = if (phase == FocusPhase.IDLE) selectedTaskId else activeTaskId
            return openTasks.firstOrNull { it.taskId == id }?.title
        }
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class FocusViewModel @Inject constructor(
    private val manager: FocusSessionManager,
    private val focusRepository: FocusRepository,
    taskRepository: TaskRepository,
    blockerRepository: BlockerRepository,
    private val time: TimeProvider,
) : ViewModel() {

    private val selectedTaskId = MutableStateFlow<Long?>(null)
    private val busy = MutableStateFlow(false)
    private val error = MutableStateFlow<Int?>(null)

    /**
     * Re-emits the timer state once per second, but ONLY while running and while the UI collects it
     * (collectAsStateWithLifecycle + WhileSubscribed stop the ticker when the screen is not visible).
     * The remaining time is always derived from timestamps, never from a counter.
     */
    private val tickingState: Flow<Pair<FocusState, Instant>> = manager.state.flatMapLatest { s ->
        if (s.phase != FocusPhase.IDLE && !s.paused) {
            flow {
                while (true) {
                    val now = time.now()
                    emit(s to now)
                    // Align to the next whole second so the display changes exactly on the second boundary.
                    delay(1_000L - (now.toEpochMilli() % 1_000L).coerceIn(0L, 999L))
                }
            }
        } else {
            flowOf(s to time.now())
        }
    }

    private val openTasks: Flow<List<FocusTaskOption>> = flow {
        val today = time.today()
        emit(today)
    }.flatMapLatest { today ->
        taskRepository.observeOccurrences(today, today).map { list ->
            list.asSequence()
                .filter { it.occurrence.status == OccurrenceStatus.PENDING && !it.task.archived }
                .distinctBy { it.task.id }
                .sortedWith(compareBy({ it.task.kind != TaskKind.MANDATORY }, { -it.task.priority.weight }))
                .map { FocusTaskOption(it.task.id, it.task.title, it.task.kind == TaskKind.MANDATORY) }
                .toList()
        }
    }.catch { emit(emptyList()) }

    private val controls = combine(selectedTaskId, busy, error) { sel, b, e -> Triple(sel, b, e) }

    val uiState: StateFlow<FocusUiState> = combine(
        tickingState,
        focusRepository.observeConfig().catch { emit(FocusConfig()) },
        openTasks,
        blockerRepository.observeConfig().catch { emit(BlockerConfig()) },
        controls,
    ) { (state, now), config, tasks, blockerConfig, (sel, b, e) ->
        val remaining = if (state.phase == FocusPhase.IDLE) {
            FocusFormat.phaseTotalMillis(FocusPhase.WORK, config)
        } else {
            FocusTimerStateMachine.remaining(state, now).toMillis().coerceAtLeast(0L)
        }
        val total = if (state.phase == FocusPhase.IDLE) remaining else FocusFormat.phaseTotalMillis(state.phase, config)
        FocusUiState(
            loading = false,
            phase = state.phase,
            paused = state.paused,
            remainingMillis = remaining,
            totalMillis = total,
            completedWorkSessions = state.completedWorkSessions,
            config = config,
            activeTaskId = state.taskId,
            selectedTaskId = sel,
            openTasks = tasks,
            blockerConfig = blockerConfig,
            busy = b,
            errorRes = e,
        )
    }
        .catch { emit(FocusUiState(loading = false, errorRes = R.string.feat_focus_error_load)) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FocusUiState())

    fun selectTask(taskId: Long?) {
        selectedTaskId.value = taskId
    }

    fun start() = launchAction { manager.start(selectedTaskId.value) }
    fun pause() = launchAction { manager.pause() }
    fun resume() = launchAction { manager.resume() }
    fun skip() = launchAction { manager.skip() }
    fun stop() = launchAction { manager.stop() }

    fun dismissError() {
        error.value = null
    }

    fun updateConfig(config: FocusConfig) {
        viewModelScope.launch {
            runCatching { focusRepository.updateConfig { FocusFormat.sanitize(config) } }
                .onFailure { error.value = R.string.feat_focus_error_action }
        }
    }

    private fun launchAction(block: suspend () -> Unit) {
        if (busy.value) return
        viewModelScope.launch {
            busy.value = true
            try {
                runCatching { block() }.onFailure { error.value = R.string.feat_focus_error_action }
            } finally {
                busy.value = false
            }
        }
    }
}
