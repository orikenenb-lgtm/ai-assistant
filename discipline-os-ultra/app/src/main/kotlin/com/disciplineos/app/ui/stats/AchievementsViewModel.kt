package com.disciplineos.app.ui.stats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.disciplineos.core.domain.gamification.AchievementView
import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.model.PlayerProgress
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

sealed interface AchievementsLoad {
    data object Loading : AchievementsLoad
    data class Ready(val progress: PlayerProgress, val achievements: List<AchievementView>) : AchievementsLoad {
        val unlockedCount: Int get() = achievements.count { it.unlockedAt != null }
    }
    data object Error : AchievementsLoad
}

@OptIn(ExperimentalCoroutinesApi::class)
@HiltViewModel
class AchievementsViewModel @Inject constructor(
    private val gamification: GamificationService,
) : ViewModel() {

    private val retry = MutableStateFlow(0)

    val state: StateFlow<AchievementsLoad> = retry.flatMapLatest {
        combine(gamification.observeProgress(), gamification.observeAchievements()) { p, a ->
            // Unlocked first (most recent first), then locked in catalog order.
            val sorted = a.sortedWith(
                compareBy<AchievementView> { it.unlockedAt == null }.thenByDescending { it.unlockedAt },
            )
            AchievementsLoad.Ready(p, sorted) as AchievementsLoad
        }
            .onStart { emit(AchievementsLoad.Loading) }
            .catch { emit(AchievementsLoad.Error) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AchievementsLoad.Loading)

    fun retry() {
        retry.value += 1
    }
}
