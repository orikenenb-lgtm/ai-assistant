package com.disciplineos.core.domain.gamification

import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.GamificationRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject

data class AchievementDef(val id: String, val titleHe: String, val descriptionHe: String, val xpReward: Int, val iconKey: String)
data class AchievementView(val def: AchievementDef, val unlockedAt: Instant?)

enum class DayOutcome { CLEARED, FAILED, NEUTRAL, FROZEN }
data class StreakResult(val current: Int, val best: Int)

object LevelCurve {
    /** XP needed to go from [level] to level+1. Gentle, monotonic. */
    fun xpToNext(level: Int): Long = TODO()
    fun progressFor(totalXp: Long, currentStreak: Int, bestStreak: Int, freezes: Int): PlayerProgress = TODO()
}

object XpRules {
    fun forOccurrence(task: Task, occurrence: TaskOccurrence): Int = TODO()
    fun forFocus(session: FocusSession): Int = TODO()
    const val MANDATORY_DAY_CLEARED = 50
}

/** Streak = consecutive CLEARED days; NEUTRAL (no mandatory work) and FROZEN days don't break it. No punishment beyond reset. */
object StreakCalculator {
    fun compute(outcomes: Map<LocalDate, DayOutcome>, today: LocalDate): StreakResult = TODO()
}

object AchievementCatalog {
    val all: List<AchievementDef> = emptyList() // Gamification agent fills (Hebrew copy)
}

class GamificationService @Inject constructor(
    private val repo: GamificationRepository,
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val time: TimeProvider,
) {
    fun observeProgress(): Flow<PlayerProgress> = TODO()
    fun observeAchievements(): Flow<List<AchievementView>> = TODO()
    suspend fun onOccurrenceCompleted(task: Task, occurrence: TaskOccurrence): Unit = TODO()
    suspend fun onFocusSessionFinished(session: FocusSession): Unit = TODO()
    /** Awards MANDATORY_DAY_CLEARED once per date if every mandatory occurrence of [date] is done. */
    suspend fun checkDayCleared(date: LocalDate): Unit = TODO()
}

data class WeeklyReview(
    val weekStart: LocalDate,
    val completed: Int,
    val total: Int,
    val mandatoryCompletionRate: Float,
    val focusMinutes: Int,
    val xpEarned: Int,
    val bestDay: LocalDate?,
    val highlightsHe: List<String>,
    val suggestionsHe: List<String>,
)

class WeeklyReviewUseCase @Inject constructor(
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val gamificationRepo: GamificationRepository,
    private val time: TimeProvider,
) {
    operator fun invoke(weekStart: LocalDate): Flow<WeeklyReview> = TODO()
}
