package com.disciplineos.core.domain.gamification

import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.repository.GamificationRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.LOCAL_DATE_TICK_MILLIS
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.domain.time.observeLocalDate
import com.disciplineos.core.model.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject

data class AchievementDef(val id: String, val titleHe: String, val descriptionHe: String, val xpReward: Int, val iconKey: String)
data class AchievementView(val def: AchievementDef, val unlockedAt: Instant?)

enum class DayOutcome { CLEARED, FAILED, NEUTRAL, FROZEN }
data class StreakResult(val current: Int, val best: Int)

object LevelCurve {
    /** XP needed to go from [level] to level+1. Gentle, monotonic: 100, 150, 200, ... (level < 1 is treated as 1). */
    fun xpToNext(level: Int): Long = 100L + 50L * (level.coerceAtLeast(1) - 1)

    fun progressFor(totalXp: Long, currentStreak: Int, bestStreak: Int, freezes: Int): PlayerProgress {
        val total = totalXp.coerceAtLeast(0)
        var level = 1
        var remaining = total
        while (remaining >= xpToNext(level)) {
            remaining -= xpToNext(level)
            level++
        }
        return PlayerProgress(
            totalXp = total,
            level = level,
            xpIntoLevel = remaining,
            xpForNextLevel = xpToNext(level),
            currentStreakDays = currentStreak.coerceAtLeast(0),
            bestStreakDays = bestStreak.coerceAtLeast(currentStreak).coerceAtLeast(0),
            streakFreezesAvailable = freezes.coerceAtLeast(0),
        )
    }
}

object XpRules {
    const val MANDATORY_DAY_CLEARED = 50
    const val WEEKLY_REVIEW = 30
    const val MANDATORY_BONUS = 10
    const val MAX_FOCUS_XP = 60

    fun forOccurrence(task: Task, occurrence: TaskOccurrence): Int {
        val base = when (task.priority) {
            Priority.LOW -> 10
            Priority.MEDIUM -> 15
            Priority.HIGH -> 25
            Priority.CRITICAL -> 40
        }
        return base + if (task.kind == TaskKind.MANDATORY) MANDATORY_BONUS else 0
    }

    /** 1 XP per fully focused minute, capped at 60; abandoned sessions earn nothing (but are never penalised). */
    fun forFocus(session: FocusSession): Int {
        if (!session.completed) return 0
        return (session.focusedSeconds.coerceAtLeast(0) / 60).coerceAtMost(MAX_FOCUS_XP.toLong()).toInt()
    }
}

/**
 * Streak = consecutive CLEARED days; NEUTRAL (no mandatory work) and FROZEN days don't break it. No punishment beyond reset.
 *
 * Rules:
 * - Only dates up to [today] count; future entries are ignored. Missing dates are NEUTRAL.
 * - CLEARED adds 1. FAILED (strictly before today) resets the run.
 * - NEUTRAL and FROZEN preserve the run without adding to it (a freeze "covers" a day, it does not earn it).
 * - Today is still in progress: if it is CLEARED it counts, otherwise it is ignored (it never breaks the streak).
 * - best = the longest run anywhere in [outcomes] (always >= current).
 */
object StreakCalculator {
    fun compute(outcomes: Map<LocalDate, DayOutcome>, today: LocalDate): StreakResult {
        val relevant = outcomes.filterKeys { !it.isAfter(today) }
        if (relevant.isEmpty()) return StreakResult(0, 0)
        val earliest = relevant.keys.min()

        // Current: walk backwards from today until the first (past) FAILED day.
        var current = 0
        var d = today
        while (!d.isBefore(earliest)) {
            when (relevant[d] ?: DayOutcome.NEUTRAL) {
                DayOutcome.CLEARED -> current++
                DayOutcome.FAILED -> if (d != today) break
                DayOutcome.NEUTRAL, DayOutcome.FROZEN -> Unit
            }
            d = d.minusDays(1)
        }

        // Best: chronological scan.
        var best = 0
        var run = 0
        d = earliest
        while (!d.isAfter(today)) {
            when (relevant[d] ?: DayOutcome.NEUTRAL) {
                DayOutcome.CLEARED -> { run++; if (run > best) best = run }
                DayOutcome.FAILED -> if (d != today) run = 0
                DayOutcome.NEUTRAL, DayOutcome.FROZEN -> Unit
            }
            d = d.plusDays(1)
        }
        return StreakResult(current, maxOf(best, current))
    }
}

/** Result of evaluating day outcomes + automatic streak freezes over a window of history. */
internal data class StreakEvaluation(
    val rawOutcomes: Map<LocalDate, DayOutcome>,
    val outcomes: Map<LocalDate, DayOutcome>,
    val frozenDates: List<LocalDate>,
    val freezesAvailable: Int,
    val streak: StreakResult,
)

/**
 * Pure, deterministic day-outcome and streak-freeze engine shared by gamification and statistics.
 *
 * Day outcome (mandatory occurrences only):
 * - NEUTRAL: no mandatory occurrence that date.
 * - CLEARED: >= 1 mandatory occurrence and every one is COMPLETED or SKIPPED.
 * - FAILED: a past date (before today) with a mandatory occurrence still PENDING or MISSED.
 * - Today is CLEARED once done, otherwise NEUTRAL (still in progress).
 *
 * Freezes: one is earned each time the running streak reaches a multiple of 7 (max 2 banked). A FAILED past day is
 * automatically converted to FROZEN while a freeze is available (oldest failures first), preserving the streak.
 */
internal object StreakEngine {
    const val MAX_FREEZES = 2
    const val FREEZE_MILESTONE = 7

    fun rawOutcomes(occurrences: List<OccurrenceWithTask>, today: LocalDate): Map<LocalDate, DayOutcome> =
        occurrences
            .asSequence()
            .filter { it.task.kind == TaskKind.MANDATORY && !it.occurrence.localDate.isAfter(today) }
            .groupBy { it.occurrence.localDate }
            .mapValues { (date, list) ->
                val allDone = list.all {
                    it.occurrence.status == OccurrenceStatus.COMPLETED || it.occurrence.status == OccurrenceStatus.SKIPPED
                }
                when {
                    allDone -> DayOutcome.CLEARED
                    date == today -> DayOutcome.NEUTRAL
                    else -> DayOutcome.FAILED
                }
            }

    fun evaluate(occurrences: List<OccurrenceWithTask>, today: LocalDate): StreakEvaluation {
        val raw = rawOutcomes(occurrences, today)
        if (raw.isEmpty()) return StreakEvaluation(raw, raw, emptyList(), 0, StreakResult(0, 0))
        val result = HashMap<LocalDate, DayOutcome>(raw)
        val frozen = ArrayList<LocalDate>()
        var available = 0
        var run = 0
        var d = raw.keys.min()
        while (!d.isAfter(today)) {
            when (raw[d] ?: DayOutcome.NEUTRAL) {
                DayOutcome.CLEARED -> {
                    run++
                    if (run % FREEZE_MILESTONE == 0) available = minOf(MAX_FREEZES, available + 1)
                }
                DayOutcome.FAILED -> if (d != today) {
                    if (available > 0) {
                        available--
                        result[d] = DayOutcome.FROZEN
                        frozen += d
                    } else {
                        run = 0
                    }
                }
                else -> Unit
            }
            d = d.plusDays(1)
        }
        return StreakEvaluation(raw, result, frozen, available, StreakCalculator.compute(result, today))
    }
}

object AchievementIds {
    const val FIRST_TASK = "first_task"
    const val FIRST_MANDATORY_DAY = "first_mandatory_day"
    const val STREAK_3 = "streak_3"
    const val STREAK_7 = "streak_7"
    const val STREAK_30 = "streak_30"
    const val FOCUS_10_SESSIONS = "focus_10_sessions"
    const val FOCUS_10_HOURS = "focus_10_hours"
    const val TASKS_100 = "tasks_100"
    const val WEEKLY_REVIEW = "weekly_review"
    const val EARLY_BIRD = "early_bird"
    const val COMEBACK = "comeback"
    const val LEVEL_5 = "level_5"
    const val LEVEL_10 = "level_10"
}

object AchievementCatalog {
    val all: List<AchievementDef> = listOf(
        AchievementDef(AchievementIds.FIRST_TASK, "צעד ראשון", "השלמת את המשימה הראשונה שלך", 20, "flag"),
        AchievementDef(AchievementIds.FIRST_MANDATORY_DAY, "יום חובה נקי", "השלמת את כל משימות החובה של יום שלם", 30, "check_circle"),
        AchievementDef(AchievementIds.STREAK_3, "שלושה ברצף", "רצף של 3 ימים מוצלחים", 30, "local_fire"),
        AchievementDef(AchievementIds.STREAK_7, "שבוע של עקביות", "רצף של 7 ימים מוצלחים", 70, "local_fire"),
        AchievementDef(AchievementIds.STREAK_30, "חודש של משמעת", "רצף של 30 ימים מוצלחים", 300, "workspace_premium"),
        AchievementDef(AchievementIds.FOCUS_10_SESSIONS, "מתמקד", "השלמת 10 סשנים של פוקוס", 50, "timer"),
        AchievementDef(AchievementIds.FOCUS_10_HOURS, "עשר שעות עומק", "צברת 10 שעות של פוקוס", 100, "hourglass"),
        AchievementDef(AchievementIds.TASKS_100, "מאה משימות", "השלמת 100 משימות", 150, "military_tech"),
        AchievementDef(AchievementIds.WEEKLY_REVIEW, "מבט לאחור", "השלמת סקירה שבועית", 25, "insights"),
        AchievementDef(AchievementIds.EARLY_BIRD, "ציפור מוקדמת", "השלמת משימה לפני 08:00 בבוקר", 20, "wb_sunny"),
        AchievementDef(AchievementIds.COMEBACK, "חזרה חזקה", "חזרת למסלול והשלמת יום אחרי יום קשה — כל הכבוד", 40, "trending_up"),
        AchievementDef(AchievementIds.LEVEL_5, "רמה 5", "הגעת לרמה 5", 0, "star"),
        AchievementDef(AchievementIds.LEVEL_10, "רמה 10", "הגעת לרמה 10", 0, "stars"),
    )

    fun byId(id: String): AchievementDef? = all.firstOrNull { it.id == id }
}

/** Facts used to decide which achievements qualify. Kept separate so the rules are pure and testable. */
internal data class AchievementFacts(
    val tasksCompleted: Int,
    val mandatoryDaysCleared: Int,
    val bestStreak: Int,
    val focusSessionsCompleted: Int,
    val focusSecondsTotal: Long,
    val weeklyReviews: Int,
    val earlyBird: Boolean,
    val comeback: Boolean,
    val level: Int,
)

internal object AchievementRules {
    /** Early bird window: completions between 04:00 (inclusive) and 08:00 (exclusive) local time; earlier is "late night". */
    const val EARLY_BIRD_FROM_HOUR = 4
    const val EARLY_BIRD_UNTIL_HOUR = 8

    fun qualifying(f: AchievementFacts): Set<String> = buildSet {
        if (f.tasksCompleted >= 1) add(AchievementIds.FIRST_TASK)
        if (f.mandatoryDaysCleared >= 1) add(AchievementIds.FIRST_MANDATORY_DAY)
        if (f.bestStreak >= 3) add(AchievementIds.STREAK_3)
        if (f.bestStreak >= 7) add(AchievementIds.STREAK_7)
        if (f.bestStreak >= 30) add(AchievementIds.STREAK_30)
        if (f.focusSessionsCompleted >= 10) add(AchievementIds.FOCUS_10_SESSIONS)
        if (f.focusSecondsTotal >= 10L * 3600) add(AchievementIds.FOCUS_10_HOURS)
        if (f.tasksCompleted >= 100) add(AchievementIds.TASKS_100)
        if (f.weeklyReviews >= 1) add(AchievementIds.WEEKLY_REVIEW)
        if (f.earlyBird) add(AchievementIds.EARLY_BIRD)
        if (f.comeback) add(AchievementIds.COMEBACK)
        if (f.level >= 5) add(AchievementIds.LEVEL_5)
        if (f.level >= 10) add(AchievementIds.LEVEL_10)
    }

    /** A CLEARED day whose most recent earlier non-neutral day was FAILED (raw outcomes, before freezes). */
    fun hasComeback(raw: Map<LocalDate, DayOutcome>): Boolean {
        var previous: DayOutcome? = null
        for (date in raw.keys.sorted()) {
            val o = raw.getValue(date)
            if (o == DayOutcome.NEUTRAL) continue
            if (o == DayOutcome.CLEARED && previous == DayOutcome.FAILED) return true
            previous = o
        }
        return false
    }

    fun isEarlyBird(completedAt: Instant, zone: java.time.ZoneId): Boolean {
        val hour = completedAt.atZone(zone).hour
        return hour in EARLY_BIRD_FROM_HOUR until EARLY_BIRD_UNTIL_HOUR
    }
}

/**
 * XP, levels, streaks and achievements. All awards are idempotent via dedupe keys:
 * "occ:<occurrenceId>", "day:<date>", "focus:<sessionId>", "ach:<achievementId>", "review:<weekStart>".
 *
 * Streaks are derived from the last [WINDOW_DAYS] days of occurrences (bounded for performance). Read paths
 * ([observeProgress]) are side-effect free: freezes the engine applies are persisted only by the explicit write path
 * [applyStreakFreezes] (run daily by the materialize worker), once per date per service instance; the repository
 * implementation is expected to be idempotent per date.
 */
class GamificationService @Inject constructor(
    private val repo: GamificationRepository,
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val time: TimeProvider,
) {
    private val recordedFreezes = HashSet<LocalDate>()
    private val freezeMutex = Mutex()
    private val evalMutex = Mutex()

    private fun windowStart(today: LocalDate): LocalDate = today.minusDays(WINDOW_DAYS - 1)

    /**
     * Live XP/level/streak. The occurrence window follows the local date: a subscriber left open past midnight
     * re-subscribes for the new day (polled every [dateTickMillis]). Pure read — never writes.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeProgress(dateTickMillis: Long = LOCAL_DATE_TICK_MILLIS): Flow<PlayerProgress> =
        time.observeLocalDate(dateTickMillis).flatMapLatest { today ->
            combine(
                repo.observeXpEvents(),
                taskRepo.observeOccurrences(windowStart(today), today),
            ) { events, occurrences ->
                val evaluation = StreakEngine.evaluate(occurrences, today)
                LevelCurve.progressFor(
                    totalXp = events.sumOf { it.amount.toLong() },
                    currentStreak = evaluation.streak.current,
                    bestStreak = evaluation.streak.best,
                    freezes = evaluation.freezesAvailable,
                )
            }
        }.distinctUntilChanged()

    /**
     * Write path for automatic streak freezes: evaluates the window ending at [today] and records every date the
     * engine froze (idempotent per date). Returns the frozen dates. Progress output does not depend on this call —
     * freezes are derived deterministically — it only persists the record.
     */
    suspend fun applyStreakFreezes(today: LocalDate = time.today()): List<LocalDate> {
        val occurrences = taskRepo.observeOccurrences(windowStart(today), today).first()
        val frozen = StreakEngine.evaluate(occurrences, today).frozenDates
        recordFreezes(frozen)
        return frozen
    }

    fun observeAchievements(): Flow<List<AchievementView>> =
        repo.observeAchievements().map { stored ->
            val unlocked = stored.filter { it.unlockedAt != null }.associate { it.id to it.unlockedAt }
            AchievementCatalog.all.map { AchievementView(it, unlocked[it.id]) }
        }

    suspend fun onOccurrenceCompleted(task: Task, occurrence: TaskOccurrence) {
        val at = occurrence.completedAt ?: time.now()
        repo.awardXp(
            XpEvent(at = at, amount = XpRules.forOccurrence(task, occurrence), source = XpSource.TASK_COMPLETED, dedupeKey = "occ:${occurrence.id}"),
        )
        if (task.kind == TaskKind.MANDATORY) awardDayClearedIfDone(occurrence.localDate)
        evaluateAchievements(extraCompletions = listOf(at))
    }

    suspend fun onFocusSessionFinished(session: FocusSession) {
        val xp = XpRules.forFocus(session)
        if (xp > 0) {
            repo.awardXp(
                XpEvent(at = session.endedAt ?: time.now(), amount = xp, source = XpSource.FOCUS_SESSION, dedupeKey = "focus:${session.id}"),
            )
        }
        evaluateAchievements()
    }

    /** Awards MANDATORY_DAY_CLEARED once per date if every mandatory occurrence of [date] is done. */
    suspend fun checkDayCleared(date: LocalDate) {
        awardDayClearedIfDone(date)
        evaluateAchievements()
    }

    /** Records that the user completed the weekly review for [weekStart] (idempotent per week). */
    suspend fun onWeeklyReviewCompleted(weekStart: LocalDate) {
        repo.awardXp(
            XpEvent(at = time.now(), amount = XpRules.WEEKLY_REVIEW, source = XpSource.WEEKLY_REVIEW, dedupeKey = "review:$weekStart"),
        )
        evaluateAchievements()
    }

    /**
     * Day-cleared XP requires >= 1 mandatory occurrence, all COMPLETED/SKIPPED, and at least one actually COMPLETED
     * (skipping everything keeps the streak but does not farm XP).
     */
    private suspend fun awardDayClearedIfDone(date: LocalDate) {
        val mandatory = taskRepo.observeOccurrences(date, date).first()
            .filter { it.task.kind == TaskKind.MANDATORY && it.occurrence.localDate == date }
        if (mandatory.isEmpty()) return
        val allDone = mandatory.all {
            it.occurrence.status == OccurrenceStatus.COMPLETED || it.occurrence.status == OccurrenceStatus.SKIPPED
        }
        val anyCompleted = mandatory.any { it.occurrence.status == OccurrenceStatus.COMPLETED }
        if (allDone && anyCompleted) {
            repo.awardXp(
                XpEvent(at = time.now(), amount = XpRules.MANDATORY_DAY_CLEARED, source = XpSource.MANDATORY_DAY_CLEARED, dedupeKey = "day:$date"),
            )
        }
    }

    private suspend fun recordFreezes(dates: List<LocalDate>) {
        if (dates.isEmpty()) return
        freezeMutex.withLock {
            for (d in dates) {
                if (recordedFreezes.add(d)) repo.recordStreakFreezeUsed(d)
            }
        }
    }

    private suspend fun evaluateAchievements(extraCompletions: List<Instant> = emptyList()) = evalMutex.withLock {
        val zone = time.zone()
        // Each unlock can award XP that unlocks a level achievement; iterate to a fixed point (bounded).
        repeat(AchievementCatalog.all.size + 1) {
            val today = time.today()
            val unlocked = repo.observeAchievements().first().filter { it.unlockedAt != null }.map { it.id }.toSet()
            val events = repo.observeXpEvents().first()
            val occurrences = taskRepo.observeOccurrences(windowStart(today), today).first()
            val sessions = focusRepo.observeSessions(Instant.EPOCH).first()
            val evaluation = StreakEngine.evaluate(occurrences, today)
            val totalXp = events.sumOf { it.amount.toLong() }
            val completions = occurrences.mapNotNull {
                if (it.occurrence.status == OccurrenceStatus.COMPLETED) it.occurrence.completedAt else null
            } + extraCompletions
            val facts = AchievementFacts(
                tasksCompleted = events.count { it.source == XpSource.TASK_COMPLETED },
                mandatoryDaysCleared = events.count { it.source == XpSource.MANDATORY_DAY_CLEARED },
                bestStreak = evaluation.streak.best,
                focusSessionsCompleted = sessions.count { it.completed },
                focusSecondsTotal = sessions.sumOf { it.focusedSeconds.coerceAtLeast(0) },
                weeklyReviews = events.count { it.source == XpSource.WEEKLY_REVIEW },
                earlyBird = completions.any { AchievementRules.isEarlyBird(it, zone) },
                comeback = AchievementRules.hasComeback(evaluation.rawOutcomes),
                level = LevelCurve.progressFor(totalXp, 0, 0, 0).level,
            )
            val newOnes = AchievementCatalog.all.filter { it.id in AchievementRules.qualifying(facts) && it.id !in unlocked }
            if (newOnes.isEmpty()) return@withLock
            val now = time.now()
            for (def in newOnes) {
                if (repo.unlockAchievement(def.id, now) && def.xpReward > 0) {
                    repo.awardXp(XpEvent(at = now, amount = def.xpReward, source = XpSource.ACHIEVEMENT, dedupeKey = "ach:${def.id}"))
                }
            }
        }
    }

    companion object {
        const val WINDOW_DAYS = 120L
    }
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

/** Pure weekly-review computation. Supportive copy only — never shaming. */
internal object WeeklyReviewCalculator {
    private val dayNamesHe = mapOf(
        java.time.DayOfWeek.SUNDAY to "יום ראשון",
        java.time.DayOfWeek.MONDAY to "יום שני",
        java.time.DayOfWeek.TUESDAY to "יום שלישי",
        java.time.DayOfWeek.WEDNESDAY to "יום רביעי",
        java.time.DayOfWeek.THURSDAY to "יום חמישי",
        java.time.DayOfWeek.FRIDAY to "יום שישי",
        java.time.DayOfWeek.SATURDAY to "שבת",
    )

    fun build(
        weekStart: LocalDate,
        today: LocalDate,
        occurrences: List<OccurrenceWithTask>,
        sessions: List<FocusSession>,
        events: List<XpEvent>,
        zone: java.time.ZoneId,
    ): WeeklyReview {
        val weekEnd = weekStart.plusDays(6)
        val lastCounted = if (today.isBefore(weekEnd)) today else weekEnd
        val inWeek = occurrences.filter {
            val d = it.occurrence.localDate
            !d.isBefore(weekStart) && !d.isAfter(lastCounted) && it.occurrence.status != OccurrenceStatus.SKIPPED
        }
        val completedList = inWeek.filter { it.occurrence.status == OccurrenceStatus.COMPLETED }
        val mandatory = inWeek.filter { it.task.kind == TaskKind.MANDATORY }
        val mandatoryDone = mandatory.count { it.occurrence.status == OccurrenceStatus.COMPLETED }
        val mandatoryRate = if (mandatory.isEmpty()) 0f else mandatoryDone.toFloat() / mandatory.size

        val focusSeconds = sessions.filter {
            val d = it.startedAt.atZone(zone).toLocalDate()
            !d.isBefore(weekStart) && !d.isAfter(weekEnd)
        }.sumOf { it.focusedSeconds.coerceAtLeast(0) }
        val focusMinutes = (focusSeconds / 60).toInt()

        val from = weekStart.atStartOfDay(zone).toInstant()
        val until = weekEnd.plusDays(1).atStartOfDay(zone).toInstant()
        val xp = events.filter { !it.at.isBefore(from) && it.at.isBefore(until) }.sumOf { it.amount }

        val bestDay = completedList.groupingBy { it.occurrence.localDate }.eachCount()
            .entries.sortedWith(compareByDescending<Map.Entry<LocalDate, Int>> { it.value }.thenBy { it.key })
            .firstOrNull()?.key

        val highlights = buildList {
            if (completedList.isNotEmpty()) add("השלמת ${completedList.size} משימות השבוע — כל אחת מהן היא צעד קדימה.")
            if (mandatory.isNotEmpty() && mandatoryRate >= 0.8f) add("עמדת ב-${Math.round(mandatoryRate * 100)}% ממשימות החובה. עבודה יציבה!")
            if (focusMinutes > 0) add("צברת $focusMinutes דקות של פוקוס עמוק.")
            if (bestDay != null) add("היום החזק ביותר שלך השבוע: ${dayNamesHe.getValue(bestDay.dayOfWeek)}.")
            if (xp > 0) add("הרווחת $xp XP השבוע.")
            if (isEmpty()) add("שבוע חדש הוא הזדמנות חדשה — כל התחלה קטנה נחשבת.")
        }
        val suggestions = buildList {
            if (inWeek.isEmpty()) add("אפשר להתחיל בהוספת משימה אחת קטנה למחר.")
            if (mandatory.isNotEmpty() && mandatoryRate < 0.6f) {
                add("כדאי לנסות לתכנן פחות משימות חובה ביום ולהתחיל בקטן — עקביות חשובה יותר מכמות.")
            }
            if (focusMinutes < 60) add("נסו לשבץ סשן פוקוס אחד של 25 דקות ביום.")
            if (isEmpty()) add("המשיכו כך! אפשר לשקול אתגר קטן אחד נוסף לשבוע הבא.")
        }
        return WeeklyReview(
            weekStart = weekStart,
            completed = completedList.size,
            total = inWeek.size,
            mandatoryCompletionRate = mandatoryRate,
            focusMinutes = focusMinutes,
            xpEarned = xp,
            bestDay = bestDay,
            highlightsHe = highlights,
            suggestionsHe = suggestions,
        )
    }
}

class WeeklyReviewUseCase @Inject constructor(
    private val taskRepo: TaskRepository,
    private val focusRepo: FocusRepository,
    private val gamificationRepo: GamificationRepository,
    private val time: TimeProvider,
) {
    operator fun invoke(weekStart: LocalDate): Flow<WeeklyReview> {
        val zone = time.zone()
        return combine(
            taskRepo.observeOccurrences(weekStart, weekStart.plusDays(6)),
            focusRepo.observeSessions(weekStart.atStartOfDay(zone).toInstant()),
            gamificationRepo.observeXpEvents(),
        ) { occurrences, sessions, events ->
            WeeklyReviewCalculator.build(weekStart, time.today(), occurrences, sessions, events, time.zone())
        }
    }
}
