package com.disciplineos.app.ui.stats

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt

/** One bar / point on a chart. [label] is a short axis label (already localized by the caller). */
data class ChartBucket(val label: String, val value: Int, val total: Int = 0)

data class ChartPoint(val x: Float, val y: Float)

enum class TrendDirection { UP, DOWN, FLAT }

/** Pure, Android-free chart & stats math (unit-tested in ChartMathTest). */
object ChartMath {

    /** Rounds [max] up to a "nice" axis maximum: 1, 2, 2.5, 5 or 10 × 10^n. Returns 1 for non-positive input. */
    fun niceMax(max: Int): Int {
        if (max <= 0) return 1
        val exponent = log10(max.toDouble()).toInt()
        val magnitude = 10.0.pow(exponent)
        val fraction = max / magnitude
        val nice = when {
            fraction <= 1.0 -> 1.0
            fraction <= 2.0 -> 2.0
            fraction <= 2.5 -> 2.5
            fraction <= 5.0 -> 5.0
            else -> 10.0
        }
        return ceil(nice * magnitude).toInt().coerceAtLeast(max)
    }

    /** Height fraction (0..1) of [value] against [axisMax]. */
    fun fraction(value: Int, axisMax: Int): Float =
        if (axisMax <= 0) 0f else (value.toFloat() / axisMax).coerceIn(0f, 1f)

    /**
     * Groups consecutive items into buckets of [size] (the last bucket may be shorter). Used to keep a 90-day
     * range readable (weekly buckets). Values and totals are summed.
     */
    fun <T> bucketize(items: List<T>, size: Int, label: (List<T>) -> String, value: (T) -> Int, total: (T) -> Int): List<ChartBucket> {
        if (items.isEmpty()) return emptyList()
        val n = size.coerceAtLeast(1)
        return items.chunked(n).map { chunk -> ChartBucket(label(chunk), chunk.sumOf(value), chunk.sumOf(total)) }
    }

    /** Bucket size that keeps a chart at or under [maxBars] bars. */
    fun bucketSizeFor(count: Int, maxBars: Int = 14): Int =
        if (count <= maxBars) 1 else ceil(count.toDouble() / maxBars).toInt()

    /**
     * Pixel coordinates for a line chart. Index 0 is the oldest value; in RTL the time axis runs right-to-left
     * so index 0 is placed at the right edge. Y grows downward (Canvas coordinates).
     */
    fun linePoints(values: List<Int>, width: Float, height: Float, axisMax: Int, rtl: Boolean): List<ChartPoint> {
        if (values.isEmpty() || width <= 0f || height <= 0f) return emptyList()
        val step = if (values.size == 1) 0f else width / (values.size - 1)
        return values.mapIndexed { i, v ->
            val xLtr = if (values.size == 1) width / 2f else i * step
            val x = if (rtl) width - xLtr else xLtr
            val y = height - fraction(v, axisMax) * height
            ChartPoint(x, y)
        }
    }

    /** Sweep angles (degrees) for a donut; zero/negative values get 0. Sums to 360 when any value is positive. */
    fun donutSweeps(values: List<Int>): List<Float> {
        val positive = values.map { it.coerceAtLeast(0) }
        val sum = positive.sum()
        if (sum == 0) return values.map { 0f }
        return positive.map { 360f * it / sum }
    }

    /** 0..1 rate → whole percent, rounded half-up and clamped to 0..100. */
    fun percent(rate: Float): Int = (rate.coerceIn(0f, 1f) * 100f).roundToInt()

    /** Trend direction with a dead-band so tiny noise reads as "flat". */
    fun trend(deltaPoints: Float, deadBand: Float = 0.5f): TrendDirection = when {
        deltaPoints > deadBand -> TrendDirection.UP
        deltaPoints < -deadBand -> TrendDirection.DOWN
        else -> TrendDirection.FLAT
    }

    /** Absolute trend delta rounded to whole percentage points. */
    fun trendMagnitude(deltaPoints: Float): Int = abs(deltaPoints).roundToInt()

    /** Minutes → hours with one decimal (e.g. 95 → "1.6"). Uses '.' regardless of locale for stable output. */
    fun hoursOneDecimal(minutes: Int): String {
        val tenths = (minutes.coerceAtLeast(0) * 10 + 30) / 60
        return "${tenths / 10}.${tenths % 10}"
    }

    /** Duration in minutes → (hours, minutes). */
    fun splitMinutes(totalMinutes: Long): Pair<Long, Long> {
        val m = totalMinutes.coerceAtLeast(0)
        return m / 60 to m % 60
    }

    /** First day of the week containing [today], given the user's preferred [weekStart]. */
    fun weekStartFor(today: LocalDate, weekStart: DayOfWeek): LocalDate =
        today.with(TemporalAdjusters.previousOrSame(weekStart))

    /** Top [n] entries by value, descending; ties broken by key for determinism. Non-positive values are dropped. */
    fun <K : Comparable<K>> topN(values: Map<K, Long>, n: Int): List<Pair<K, Long>> =
        values.entries
            .filter { it.value > 0 }
            .sortedWith(compareByDescending<Map.Entry<K, Long>> { it.value }.thenBy { it.key })
            .take(n.coerceAtLeast(0))
            .map { it.key to it.value }
}
