package com.disciplineos.core.domain.stats

import com.disciplineos.core.domain.gamification.StreakEngine
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
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

/**
 * Pure statistics. Conventions:
 * - The range is the [StatsRange.days] local dates ending with (and including) [today]; future occurrences are ignored.
 * - Rates are fractions in 0..1. SKIPPED occurrences are excluded from both numerator and denominator.
 *   An empty denominator yields 0 (never NaN).
 * - Focus minutes are attributed to the local date (in [zone]) on which the session started.
 * - [StatsSnapshot.trendDeltaPoints] = (rate - previousRate) * 100; 0 when the previous period has no countable data.
 * - Streaks use the same engine (incl. automatic freezes) as gamification, over current + previous period data.
 */
object StatisticsCalculator {
    const val UNCATEGORIZED_NAME = "ללא קטגוריה"
    const val UNCATEGORIZED_COLOR = "#9E9E9E"

    fun compute(
        range: StatsRange,
        today: LocalDate,
        occurrences: List<OccurrenceWithTask>,
        previousPeriod: List<OccurrenceWithTask>,
        focusSessions: List<FocusSession>,
        bypasses: List<BypassSession>,
        categories: List<Category>,
        zone: java.time.ZoneId,
    ): StatsSnapshot {
        val start = today.minusDays(range.days - 1L)
        val prevStart = start.minusDays(range.days.toLong())
        val prevEnd = start.minusDays(1)

        fun inRange(d: LocalDate, from: LocalDate, to: LocalDate) = !d.isBefore(from) && !d.isAfter(to)

        val current = occurrences.filter { inRange(it.occurrence.localDate, start, today) }
        val previous = previousPeriod.filter { inRange(it.occurrence.localDate, prevStart, prevEnd) }
        val countable = current.filter { it.occurrence.status != OccurrenceStatus.SKIPPED }
        val byDate = countable.groupBy { it.occurrence.localDate }

        val focusInRange = focusSessions.filter { inRange(it.startedAt.atZone(zone).toLocalDate(), start, today) }
        val focusSecondsByDate = focusInRange.groupBy { it.startedAt.atZone(zone).toLocalDate() }
            .mapValues { (_, list) -> list.sumOf { it.focusedSeconds.coerceAtLeast(0) } }

        val days = (0 until range.days).map { offset ->
            val date = start.plusDays(offset.toLong())
            val list = byDate[date].orEmpty()
            val mandatory = list.filter { it.task.kind == TaskKind.MANDATORY }
            DayStat(
                date = date,
                completed = list.count { it.isCompleted() },
                total = list.size,
                mandatoryCompleted = mandatory.count { it.isCompleted() },
                mandatoryTotal = mandatory.size,
                focusMinutes = ((focusSecondsByDate[date] ?: 0L) / 60).toInt(),
            )
        }

        val completionRate = rate(days.sumOf { it.completed }, days.sumOf { it.total })
        val mandatoryRate = rate(days.sumOf { it.mandatoryCompleted }, days.sumOf { it.mandatoryTotal })

        val prevCountable = previous.filter { it.occurrence.status != OccurrenceStatus.SKIPPED }
        val trend = if (prevCountable.isEmpty()) {
            0f
        } else {
            (completionRate - rate(prevCountable.count { it.isCompleted() }, prevCountable.size)) * 100f
        }

        val categoryById = categories.associateBy { it.id }
        val byCategory = countable.filter { it.isCompleted() }
            .groupingBy { it.task.categoryId }.eachCount()
            .map { (id, count) ->
                val cat = id?.let { categoryById[it] }
                CategoryStat(id, cat?.name ?: UNCATEGORIZED_NAME, cat?.colorHex ?: UNCATEGORIZED_COLOR, count)
            }
            .sortedWith(compareByDescending<CategoryStat> { it.completed }.thenBy { it.name })

        val bypassCount = bypasses.count { inRange(it.startedAt.atZone(zone).toLocalDate(), start, today) }

        val streak = StreakEngine.evaluate(current + previous, today).streak

        return StatsSnapshot(
            range = range,
            days = days,
            completionRate = completionRate,
            mandatoryCompletionRate = mandatoryRate,
            focusMinutesTotal = (focusInRange.sumOf { it.focusedSeconds.coerceAtLeast(0) } / 60).toInt(),
            focusSessionsCompleted = focusInRange.count { it.completed },
            byCategory = byCategory,
            bypassCount = bypassCount,
            trendDeltaPoints = trend,
            currentStreak = streak.current,
            bestStreak = streak.best,
        )
    }

    private fun OccurrenceWithTask.isCompleted() = occurrence.status == OccurrenceStatus.COMPLETED

    private fun rate(done: Int, total: Int): Float = if (total <= 0) 0f else done.toFloat() / total
}

class ObserveStatisticsUseCase @Inject constructor(
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val blockerRepo: BlockerRepository,
    private val time: TimeProvider,
) {
    operator fun invoke(range: StatsRange): Flow<StatsSnapshot> {
        val today = time.today()
        val zone = time.zone()
        val start = today.minusDays(range.days - 1L)
        val prevStart = start.minusDays(range.days.toLong())
        val startInstant = start.atStartOfDay(zone).toInstant()
        return combine(
            taskRepo.observeOccurrences(start, today),
            taskRepo.observeOccurrences(prevStart, start.minusDays(1)),
            focusRepo.observeSessions(startInstant),
            blockerRepo.observeBypasses(startInstant),
            taskRepo.observeCategories(),
        ) { current, previous, sessions, bypasses, categories ->
            StatisticsCalculator.compute(range, today, current, previous, sessions, bypasses, categories, zone)
        }
    }
}
