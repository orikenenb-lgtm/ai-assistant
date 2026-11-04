package com.disciplineos.core.domain.task

import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.Task
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/**
 * Pure recurrence math. Every computation is done on [LocalDate]s (calendar days), never by adding fixed
 * 24h durations, so DST transitions and zone changes cannot shift a series.
 *
 * Rules:
 * - Archived tasks produce no dates.
 * - Dates are always within `[max(from, startDate), min(to, endDate)]` (endDate inclusive).
 * - [RecurrenceRule.None]: exactly one date, `startDate` (if it lies inside the window and is not after endDate).
 * - [RecurrenceRule.Daily]: every N days counted from `startDate`.
 * - [RecurrenceRule.Weekly]: the given weekdays, every N weeks. Weeks are anchored on the week that contains
 *   `startDate`, using [WEEK_ANCHOR] (Sunday, the Israeli week start and the app's default) as first day of week.
 * - [RecurrenceRule.Monthly]: the given day of month, clamped to the month length (31 → Feb 28/29, Apr 30 …).
 */
object RecurrenceEngine : RecurrenceEngineApi {

    /** First day of the week used to group weeks for `Weekly(everyNWeeks > 1)`. */
    val WEEK_ANCHOR: DayOfWeek = DayOfWeek.SUNDAY

    override fun occurrenceDates(task: Task, from: LocalDate, to: LocalDate): List<LocalDate> {
        if (task.archived) return emptyList()
        val seriesEnd = task.endDate
        if (seriesEnd != null && seriesEnd.isBefore(task.startDate)) return emptyList()
        val start = maxOf(from, task.startDate)
        val end = if (seriesEnd != null) minOf(to, seriesEnd) else to
        if (start.isAfter(end)) return emptyList()

        return when (val rule = task.recurrence) {
            RecurrenceRule.None -> listOf(task.startDate) // start <= startDate <= end is guaranteed above
                .filter { !it.isBefore(start) && !it.isAfter(end) }
            is RecurrenceRule.Daily -> daily(task.startDate, rule.everyNDays, start, end)
            is RecurrenceRule.Weekly -> weekly(task.startDate, rule, start, end)
            is RecurrenceRule.Monthly -> monthly(rule.dayOfMonth, start, end)
        }
    }

    private fun daily(anchor: LocalDate, everyN: Int, start: LocalDate, end: LocalDate): List<LocalDate> {
        val n = everyN.coerceAtLeast(1).toLong()
        val offset = ChronoUnit.DAYS.between(anchor, start) // >= 0 because start >= anchor
        val steps = (offset + n - 1) / n
        var d = anchor.plusDays(steps * n)
        val out = ArrayList<LocalDate>()
        while (!d.isAfter(end)) {
            out += d
            d = d.plusDays(n)
        }
        return out
    }

    private fun weekly(anchor: LocalDate, rule: RecurrenceRule.Weekly, start: LocalDate, end: LocalDate): List<LocalDate> {
        val n = rule.everyNWeeks.coerceAtLeast(1).toLong()
        val anchorWeekStart = anchor.with(TemporalAdjusters.previousOrSame(WEEK_ANCHOR))
        val out = ArrayList<LocalDate>()
        var d = start
        while (!d.isAfter(end)) {
            if (d.dayOfWeek in rule.daysOfWeek) {
                val weekIndex = ChronoUnit.DAYS.between(anchorWeekStart, d) / 7
                if (weekIndex % n == 0L) out += d
            }
            d = d.plusDays(1)
        }
        return out
    }

    private fun monthly(dayOfMonth: Int, start: LocalDate, end: LocalDate): List<LocalDate> {
        val out = ArrayList<LocalDate>()
        var ym = YearMonth.from(start)
        val last = YearMonth.from(end)
        while (!ym.isAfter(last)) {
            val d = ym.atDay(minOf(dayOfMonth, ym.lengthOfMonth()))
            if (!d.isBefore(start) && !d.isAfter(end)) out += d
            ym = ym.plusMonths(1)
        }
        return out
    }
}

/**
 * DST-safe wall-clock → instant resolution via [ZonedDateTime.ofLocal]:
 * - a time inside a spring-forward gap is shifted forward by the length of the gap (02:30 → 03:30);
 * - a time inside a fall-back overlap resolves to the earlier offset (the first 01:30).
 */
object DueInstantResolver : DueInstantResolverApi {
    override fun resolve(date: LocalDate, time: LocalTime?, zone: ZoneId): Instant? {
        if (time == null) return null
        return ZonedDateTime.ofLocal(LocalDateTime.of(date, time), zone, null).toInstant()
    }

    /** Start of the next local day; `atStartOfDay` handles zones whose midnight falls in a DST gap. */
    override fun endOfDay(date: LocalDate, zone: ZoneId): Instant =
        date.plusDays(1).atStartOfDay(zone).toInstant()

    /** Due instant for an occurrence, falling back to end of day when no time is set. */
    fun effectiveDeadline(date: LocalDate, time: LocalTime?, zone: ZoneId): Instant =
        resolve(date, time, zone) ?: endOfDay(date, zone)
}

/**
 * Stable string encoding of [RecurrenceRule] for persistence. Format (version-less, append-only):
 * - `NONE`
 * - `D<n>`                 e.g. `D1`, `D3`
 * - `W<n>:<DAYS>`          e.g. `W1:MON,WED` — days are 3-letter ISO abbreviations in Monday..Sunday order
 * - `M<day>`               e.g. `M31`
 */
object RecurrenceCodec {
    private const val NONE = "NONE"
    private val DAY_CODES: Map<DayOfWeek, String> = DayOfWeek.values().associateWith { it.name.take(3) }
    private val CODE_DAYS: Map<String, DayOfWeek> = DAY_CODES.entries.associate { (k, v) -> v to k }

    fun encode(rule: RecurrenceRule): String = when (rule) {
        RecurrenceRule.None -> NONE
        is RecurrenceRule.Daily -> "D${rule.everyNDays}"
        is RecurrenceRule.Weekly ->
            "W${rule.everyNWeeks}:" + rule.daysOfWeek.sorted().joinToString(",") { DAY_CODES.getValue(it) }
        is RecurrenceRule.Monthly -> "M${rule.dayOfMonth}"
    }

    /** Returns RecurrenceRule.None for blank/unknown input (never throws). */
    fun decode(value: String?): RecurrenceRule {
        val s = value?.trim()?.uppercase().orEmpty()
        if (s.isEmpty() || s == NONE) return RecurrenceRule.None
        return try {
            when (s[0]) {
                'D' -> RecurrenceRule.Daily(s.substring(1).toInt())
                'M' -> RecurrenceRule.Monthly(s.substring(1).toInt())
                'W' -> {
                    val colon = s.indexOf(':')
                    if (colon < 0) return RecurrenceRule.None
                    val n = s.substring(1, colon).toInt()
                    val days = s.substring(colon + 1).split(',')
                        .map { it.trim() }
                        .filter { it.isNotEmpty() }
                        .map { CODE_DAYS[it.take(3)] ?: return RecurrenceRule.None }
                        .toSet()
                    RecurrenceRule.Weekly(days, n)
                }
                else -> RecurrenceRule.None
            }
        } catch (e: IllegalArgumentException) { // includes NumberFormatException and model `require` failures
            RecurrenceRule.None
        } catch (e: IndexOutOfBoundsException) {
            RecurrenceRule.None
        }
    }
}
