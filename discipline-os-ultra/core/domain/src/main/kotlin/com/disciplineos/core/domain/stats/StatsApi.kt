package com.disciplineos.core.domain.stats

import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import java.time.LocalDate
import javax.inject.Inject

enum class StatsRange(val days: Int) { WEEK(7), MONTH(30), QUARTER(90) }

data class DayStat(val date: LocalDate, val completed: Int, val total: Int, val mandatoryCompleted: Int, val mandatoryTotal: Int, val focusMinutes: Int)
data class CategoryStat(val categoryId: Long?, val name: String, val colorHex: String, val completed: Int)

data class StatsSnapshot(
    val range: StatsRange,
    val days: List<DayStat>,
    val completionRate: Float,
    val mandatoryCompletionRate: Float,
    val focusMinutesTotal: Int,
    val focusSessionsCompleted: Int,
    val byCategory: List<CategoryStat>,
    val bypassCount: Int,
    /** Change in completion rate vs. the previous equal-length period, in percentage points. */
    val trendDeltaPoints: Float,
    val currentStreak: Int,
    val bestStreak: Int,
)

object StatisticsCalculator {
    fun compute(
        range: StatsRange,
        today: LocalDate,
        occurrences: List<OccurrenceWithTask>,
        previousPeriod: List<OccurrenceWithTask>,
        focusSessions: List<FocusSession>,
        bypasses: List<BypassSession>,
        categories: List<Category>,
        zone: java.time.ZoneId,
    ): StatsSnapshot = TODO()
}

class ObserveStatisticsUseCase @Inject constructor(
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val blockerRepo: BlockerRepository,
    private val time: TimeProvider,
) {
    operator fun invoke(range: StatsRange): Flow<StatsSnapshot> = TODO()
}
