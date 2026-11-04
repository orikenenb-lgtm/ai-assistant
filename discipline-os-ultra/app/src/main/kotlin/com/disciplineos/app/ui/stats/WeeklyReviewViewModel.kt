package com.disciplineos.app.ui.stats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.core.domain.gamification.WeeklyReview
import com.disciplineos.core.domain.gamification.WeeklyReviewUseCase
import com.disciplineos.core.domain.repository.GamificationRepository
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.XpEvent
import com.disciplineos.core.model.XpSource
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.time.LocalDate
import javax.inject.Inject

enum class ReviewWeek { THIS_WEEK, LAST_WEEK }

sealed interface WeeklyReviewLoad {
    data object Loading : WeeklyReviewLoad
    data class Ready(val review: WeeklyReview, val alreadyCompleted: Boolean) : WeeklyReviewLoad
    data object Error : WeeklyReviewLoad
}

sealed interface FinishResult {
    data object Idle : FinishResult
    data object Saving : FinishResult
    data class Awarded(val xp: Int) : FinishResult
    data object AlreadyDone : FinishResult
    data object Failed : FinishResult
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class WeeklyReviewViewModel @Inject constructor(
    private val weeklyReview: WeeklyReviewUseCase,
    private val gamificationRepository: GamificationRepository,
    settingsRepository: SettingsRepository,
    private val time: TimeProvider,
) : ViewModel() {

    private val _week = MutableStateFlow(ReviewWeek.THIS_WEEK)
    val week: StateFlow<ReviewWeek> = _week.asStateFlow()

    private val _finish = MutableStateFlow<FinishResult>(FinishResult.Idle)
    val finish: StateFlow<FinishResult> = _finish.asStateFlow()

    private val retry = MutableStateFlow(0)

    private val weekStart = combine(
        settingsRepository.observeSettings().map { it.weekStart }.distinctUntilChanged(),
        _week,
    ) { start, which ->
        val thisWeek = ChartMath.weekStartFor(time.today(), start)
        if (which == ReviewWeek.THIS_WEEK) thisWeek else thisWeek.minusWeeks(1)
    }.distinctUntilChanged()

    val state: StateFlow<WeeklyReviewLoad> = combine(weekStart, retry) { start, _ -> start }
        .flatMapLatest { start ->
            combine(
                weeklyReview(start),
                gamificationRepository.observeXpEvents().map { events -> events.any { it.dedupeKey == dedupeKey(start) } },
            ) { review, done -> WeeklyReviewLoad.Ready(review, done) as WeeklyReviewLoad }
                .onStart { emit(WeeklyReviewLoad.Loading) }
                .catch { emit(WeeklyReviewLoad.Error) }
        }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WeeklyReviewLoad.Loading)

    fun selectWeek(week: ReviewWeek) {
        _week.value = week
        _finish.value = FinishResult.Idle
    }

    fun retry() {
        retry.value += 1
    }

    /**
     * Marks the review as done by awarding a one-time WEEKLY_REVIEW XP event. Idempotent: the dedupe key
     * ("review:<weekStart>") guarantees the same week is never rewarded twice.
     */
    fun finishReview() {
        val current = state.value as? WeeklyReviewLoad.Ready ?: return
        if (_finish.value == FinishResult.Saving) return
        val start = current.review.weekStart
        viewModelScope.launch {
            _finish.value = FinishResult.Saving
            _finish.value = runCatching {
                gamificationRepository.awardXp(
                    XpEvent(
                        at = time.now(),
                        amount = WEEKLY_REVIEW_XP,
                        source = XpSource.WEEKLY_REVIEW,
                        dedupeKey = dedupeKey(start),
                    ),
                )
            }.fold(
                onSuccess = { awarded -> if (awarded) FinishResult.Awarded(WEEKLY_REVIEW_XP) else FinishResult.AlreadyDone },
                onFailure = { FinishResult.Failed },
            )
        }
    }

    companion object {
        /** No domain constant exists for this yet (reported to the Orchestrator); kept small and encouraging. */
        const val WEEKLY_REVIEW_XP = 30
        fun dedupeKey(weekStart: LocalDate) = "review:$weekStart"
    }
}
