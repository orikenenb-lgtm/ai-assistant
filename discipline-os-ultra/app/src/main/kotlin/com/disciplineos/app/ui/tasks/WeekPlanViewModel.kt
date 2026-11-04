package com.disciplineos.app.ui.tasks

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.app.ui.common.UiState
import com.disciplineos.app.ui.common.deferredFlow
import com.disciplineos.app.ui.common.safeCall
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.task.AvailabilityWindow
import com.disciplineos.core.domain.task.DayPlan
import com.disciplineos.core.domain.task.ObserveWeekUseCase
import com.disciplineos.core.domain.task.SmartScheduler
import com.disciplineos.core.domain.task.WeeklyPlan
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.Task
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.TemporalAdjusters
import javax.inject.Inject

sealed interface ProposalState {
    data object None : ProposalState
    data object Running : ProposalState
    /** Display-only suggestion. Nothing is written unless the user acts on individual tasks. */
    data class Ready(
        val plan: WeeklyPlan,
        /** taskId → task. */
        val tasks: Map<Long, Task>,
        /** occurrenceId → task. */
        val byOccurrence: Map<Long, Task>,
    ) : ProposalState
    data object NothingToPlan : ProposalState
    data object Failed : ProposalState
}

data class WeekPlanUiState(
    val today: LocalDate,
    val weekStart: LocalDate? = null,
    val days: UiState<List<DayPlan>> = UiState.Loading,
    val proposal: ProposalState = ProposalState.None,
)

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class WeekPlanViewModel @Inject constructor(
    settingsRepository: SettingsRepository,
    private val observeWeek: ObserveWeekUseCase,
    private val time: TimeProvider,
) : ViewModel() {

    private val weekOffset = MutableStateFlow(0L)
    private val proposal = MutableStateFlow<ProposalState>(ProposalState.None)

    private val firstDay = deferredFlow { settingsRepository.observeSettings() }
        .map { it.weekStart }
        .catch { emit(DayOfWeek.SUNDAY) }
        .distinctUntilChanged()

    private val weekStart = combine(firstDay, weekOffset) { first, offset ->
        time.today().with(TemporalAdjusters.previousOrSame(first)).plusWeeks(offset)
    }.distinctUntilChanged()

    private val days = weekStart.flatMapLatest { start ->
        deferredFlow { observeWeek(start) }
            .map<List<DayPlan>, Pair<LocalDate, UiState<List<DayPlan>>>> { start to UiState.Success(it.sortedBy { day -> day.date }) }
            .catch { emit(start to UiState.Error(it.message ?: it.javaClass.simpleName)) }
    }

    val uiState: StateFlow<WeekPlanUiState> = combine(days, proposal) { (start, days), proposal ->
        WeekPlanUiState(today = time.today(), weekStart = start, days = days, proposal = proposal)
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WeekPlanUiState(today = time.today()))

    fun previousWeek() = shiftWeek(-1)
    fun nextWeek() = shiftWeek(1)
    fun thisWeek() {
        weekOffset.value = 0
        proposal.value = ProposalState.None
    }

    private fun shiftWeek(delta: Long) {
        weekOffset.update { it + delta }
        proposal.value = ProposalState.None
    }

    fun dismissProposal() {
        proposal.value = ProposalState.None
    }

    /** Runs the deterministic SmartScheduler on the open items of the displayed week (today onward). */
    fun planSmart() {
        val days = (uiState.value.days as? UiState.Success)?.data ?: return
        if (proposal.value == ProposalState.Running) return
        proposal.value = ProposalState.Running
        viewModelScope.launch {
            val now = time.now().atZone(time.zone())
            val today = now.toLocalDate()
            val result = safeCall {
                withContext(Dispatchers.Default) {
                    val items: List<OccurrenceWithTask> = days
                        .filter { !it.date.isBefore(today) }
                        .flatMap { it.overdue + it.mandatory + it.optional }
                        .filter { it.occurrence.status == OccurrenceStatus.PENDING }
                        .distinctBy { it.occurrence.id }
                    val windows = days.mapNotNull { day -> defaultWindow(day.date, today, now.toLocalTime()) }
                    if (items.isEmpty() || windows.isEmpty()) {
                        null
                    } else {
                        ProposalState.Ready(
                            plan = SmartScheduler.plan(items, windows),
                            tasks = items.associate { it.task.id to it.task },
                            byOccurrence = items.associate { it.occurrence.id to it.task },
                        )
                    }
                }
            }
            proposal.value = result.fold(
                onSuccess = { ready -> ready ?: ProposalState.NothingToPlan },
                onFailure = { ProposalState.Failed },
            )
        }
    }

    companion object {
        val WINDOW_START: LocalTime = LocalTime.of(16, 0)
        val WINDOW_END: LocalTime = LocalTime.of(21, 0)

        /** Default availability 16:00–21:00; today starts at the next quarter hour if later than 16:00. */
        fun defaultWindow(date: LocalDate, today: LocalDate, nowTime: LocalTime): AvailabilityWindow? {
            if (date.isBefore(today)) return null
            if (date.isAfter(today)) return AvailabilityWindow(date, WINDOW_START, WINDOW_END)
            val minutes = nowTime.hour * 60 + nowTime.minute
            val roundedUp = ((minutes + 14) / 15) * 15
            if (roundedUp >= WINDOW_END.hour * 60 + WINDOW_END.minute - 15) return null
            val start = maxOf(WINDOW_START, LocalTime.of(roundedUp / 60, roundedUp % 60))
            return AvailabilityWindow(date, start, WINDOW_END)
        }
    }
}
