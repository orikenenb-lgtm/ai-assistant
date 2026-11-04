package com.disciplineos.app.ui.dashboard

import android.content.Context
import androidx.annotation.StringRes
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.R
import com.disciplineos.app.ui.common.UiState
import com.disciplineos.app.ui.common.asResult
import com.disciplineos.app.ui.common.deferredFlow
import com.disciplineos.app.ui.common.messageRes
import com.disciplineos.app.ui.common.requiredMessageRes
import com.disciplineos.app.ui.common.safeCall
import com.disciplineos.app.ui.common.tickerFlow
import com.disciplineos.core.domain.blocker.BlockPolicyEngine
import com.disciplineos.core.domain.blocker.BlockPolicyInput
import com.disciplineos.core.domain.blocker.ObserveBlockPolicyInputUseCase
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.stats.ObserveStatisticsUseCase
import com.disciplineos.core.domain.stats.StatsRange
import com.disciplineos.core.domain.stats.StatsSnapshot
import com.disciplineos.core.domain.task.DayPlan
import com.disciplineos.core.domain.task.ObserveDayPlanUseCase
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskResult
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.AllowReason
import com.disciplineos.core.model.BlockDecision
import com.disciplineos.core.model.BlockReason
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.PlayerProgress
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
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

/** Package-agnostic blocker status for the dashboard card. */
sealed interface BlockerStatus {
    data object Unavailable : BlockerStatus
    data object Disabled : BlockerStatus
    data object Open : BlockerStatus
    data class Active(val pendingMandatory: Int, val focusDriven: Boolean) : BlockerStatus
    data class Recovery(val until: Instant?) : BlockerStatus
    data class Bypass(val until: Instant?) : BlockerStatus
}

data class DashboardUiState(
    val today: LocalDate,
    val hour: Int,
    val now: Instant,
    val plan: UiState<DayPlan> = UiState.Loading,
    val progress: PlayerProgress? = null,
    val blocker: BlockerStatus = BlockerStatus.Unavailable,
    val focus: FocusState? = null,
    val week: StatsSnapshot? = null,
    /** Occurrences with a complete/uncomplete call in flight (their checkbox is disabled). */
    val busyOccurrences: Set<Long> = emptySet(),
)

sealed interface DashboardEvent {
    /** A task command failed. When [openTaskId] is set the snackbar offers to open the task. */
    data class Message(@StringRes val text: Int, val openTaskId: Long? = null) : DashboardEvent
    data object OpenFocus : DashboardEvent
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class DashboardViewModel @Inject constructor(
    private val observeDayPlan: ObserveDayPlanUseCase,
    private val commands: TaskCommands,
    private val gamification: GamificationService,
    private val observeBlockPolicyInput: ObserveBlockPolicyInputUseCase,
    private val focusManager: FocusSessionManager,
    private val observeStatistics: ObserveStatisticsUseCase,
    private val time: TimeProvider,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    private val retry = MutableStateFlow(0)
    private val busy = MutableStateFlow<Set<Long>>(emptySet())
    private val eventChannel = Channel<DashboardEvent>(Channel.BUFFERED)
    val events: Flow<DashboardEvent> = eventChannel.receiveAsFlow()

    /** Re-evaluated every 30s so the greeting and "today" roll over without a restart. */
    private val clock: Flow<ClockTick> = tickerFlow(30_000).map { currentTick() }

    private fun currentTick(): ClockTick {
        val now = time.now()
        return ClockTick(today = now.atZone(time.zone()).toLocalDate(), hour = now.atZone(time.zone()).hour, now = now)
    }

    private val plan: Flow<UiState<DayPlan>> = combine(clock.map { it.today }.distinctUntilChanged(), retry) { day, _ -> day }
        .flatMapLatest { day ->
            deferredFlow { observeDayPlan(day) }
                .map<DayPlan, UiState<DayPlan>> { dayPlan ->
                    if (dayPlan.totalCount == 0 && dayPlan.overdue.isEmpty() &&
                        dayPlan.mandatory.isEmpty() && dayPlan.optional.isEmpty()
                    ) {
                        UiState.Empty
                    } else {
                        UiState.Success(dayPlan)
                    }
                }
                .catch { emit(UiState.Error(it.message ?: it.javaClass.simpleName)) }
        }

    private val progress: Flow<PlayerProgress?> = deferredFlow { gamification.observeProgress() }
        .asResult().map { it.getOrNull() }

    private val blocker: Flow<BlockerStatus> =
        deferredFlow { observeBlockPolicyInput(ownPackage = context.packageName, deviceProtected = emptySet()) }
            .map { input -> input.toStatus(BlockPolicyEngine.currentRestriction(input)) }
            .catch { emit(BlockerStatus.Unavailable) }
            .distinctUntilChanged()

    private val focus: Flow<FocusState?> = deferredFlow { focusManager.state }
        .asResult().map { it.getOrNull() }

    private val week: Flow<StatsSnapshot?> = deferredFlow { observeStatistics(StatsRange.WEEK) }
        .asResult().map { it.getOrNull() }

    private val initial = currentTick().let { DashboardUiState(today = it.today, hour = it.hour, now = it.now) }

    val uiState: StateFlow<DashboardUiState> = combine(clock, plan, progress, blocker, busy) { tick, plan, progress, blocker, busy ->
        initial.copy(
            today = tick.today,
            hour = tick.hour,
            now = tick.now,
            plan = plan,
            progress = progress,
            blocker = blocker,
            busyOccurrences = busy,
        )
    }
        .combine(focus) { state, focus -> state.copy(focus = focus) }
        .combine(week) { state, week -> state.copy(week = week) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), initial)

    fun retry() = retry.update { it + 1 }

    /** Quick-complete from the dashboard. Verification is enforced by the domain; we explain failures. */
    fun setCompleted(item: OccurrenceWithTask, completed: Boolean) {
        val id = item.occurrence.id
        if (id in busy.value) return
        busy.update { it + id }
        viewModelScope.launch {
            val result = safeCall {
                if (completed) commands.completeOccurrence(id) else commands.uncompleteOccurrence(id)
            }
            result.fold(
                onSuccess = { taskResult ->
                    if (taskResult is TaskResult.Failure) {
                        eventChannel.send(failureEvent(taskResult.error, item))
                    }
                },
                onFailure = { eventChannel.send(DashboardEvent.Message(R.string.core_error_generic)) },
            )
            busy.update { it - id }
        }
    }

    fun startFocus() {
        viewModelScope.launch {
            val active = uiState.value.focus?.let { it.phase != FocusPhase.IDLE } ?: false
            if (!active) {
                safeCall { focusManager.start(null) }
            }
            eventChannel.send(DashboardEvent.OpenFocus)
        }
    }

    private fun failureEvent(error: TaskError, item: OccurrenceWithTask): DashboardEvent = when (error) {
        TaskError.VERIFICATION_REQUIRED ->
            DashboardEvent.Message(item.task.verification.requiredMessageRes(), openTaskId = item.task.id)
        TaskError.DEPENDENCIES_INCOMPLETE ->
            DashboardEvent.Message(error.messageRes(), openTaskId = item.task.id)
        else -> DashboardEvent.Message(error.messageRes())
    }
}

private data class ClockTick(val today: LocalDate, val hour: Int, val now: Instant)

private fun BlockPolicyInput.toStatus(decision: BlockDecision): BlockerStatus {
    if (!config.enabled) return BlockerStatus.Disabled
    return when (decision) {
        is BlockDecision.Allow -> when (decision.reason) {
            AllowReason.BLOCKER_DISABLED -> BlockerStatus.Disabled
            AllowReason.RECOVERY_MODE -> BlockerStatus.Recovery(config.recoveryUntil)
            AllowReason.BYPASS_ACTIVE -> BlockerStatus.Bypass(activeBypass?.endsAt)
            AllowReason.NOT_TARGETED,
            AllowReason.PROTECTED_PACKAGE,
            AllowReason.NO_ACTIVE_MANDATORY,
            -> BlockerStatus.Open
        }
        is BlockDecision.Block -> BlockerStatus.Active(
            pendingMandatory = decision.pending.size,
            focusDriven = decision.reason == BlockReason.FOCUS_SESSION_ACTIVE,
        )
    }
}

/** Open (pending) mandatory items for today plus carry-over. */
internal fun DayPlan.remainingMandatory(): Int =
    overdue.size + mandatory.count { it.occurrence.status == OccurrenceStatus.PENDING }
