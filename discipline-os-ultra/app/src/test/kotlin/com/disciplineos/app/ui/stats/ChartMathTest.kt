package com.disciplineos.app.ui.stats

import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ChartMathTest {

    @Test fun niceMaxRoundsUpToFriendlyValues() {
        assertEquals(1, ChartMath.niceMax(0))
        assertEquals(1, ChartMath.niceMax(-3))
        assertEquals(1, ChartMath.niceMax(1))
        assertEquals(2, ChartMath.niceMax(2))
        assertEquals(5, ChartMath.niceMax(3))
        assertEquals(10, ChartMath.niceMax(7))
        assertEquals(25, ChartMath.niceMax(25))
        assertEquals(50, ChartMath.niceMax(26))
        assertEquals(100, ChartMath.niceMax(100))
        assertEquals(200, ChartMath.niceMax(101))
    }

    @Test fun niceMaxIsAlwaysAtLeastInput() {
        (1..2000).forEach { assertTrue(ChartMath.niceMax(it) >= it, "niceMax($it)") }
    }

    @Test fun fractionClamps() {
        assertEquals(0.5f, ChartMath.fraction(5, 10))
        assertEquals(1f, ChartMath.fraction(15, 10))
        assertEquals(0f, ChartMath.fraction(5, 0))
    }

    @Test fun bucketizeSumsChunks() {
        val items = (1..10).toList()
        val buckets = ChartMath.bucketize(items, 4, { "${it.first()}" }, { it }, { 1 })
        assertEquals(listOf("1", "5", "9"), buckets.map { it.label })
        assertEquals(listOf(10, 26, 19), buckets.map { it.value })
        assertEquals(listOf(4, 4, 2), buckets.map { it.total })
        assertTrue(ChartMath.bucketize(emptyList<Int>(), 3, { "" }, { it }, { it }).isEmpty())
    }

    @Test fun bucketSize() {
        assertEquals(1, ChartMath.bucketSizeFor(7))
        assertEquals(1, ChartMath.bucketSizeFor(14))
        assertEquals(3, ChartMath.bucketSizeFor(30))
        assertEquals(7, ChartMath.bucketSizeFor(90))
    }

    @Test fun linePointsMirrorInRtl() {
        val ltr = ChartMath.linePoints(listOf(0, 5, 10), 100f, 50f, 10, rtl = false)
        assertEquals(listOf(0f, 50f, 100f), ltr.map { it.x })
        assertEquals(listOf(50f, 25f, 0f), ltr.map { it.y })
        val rtl = ChartMath.linePoints(listOf(0, 5, 10), 100f, 50f, 10, rtl = true)
        assertEquals(listOf(100f, 50f, 0f), rtl.map { it.x })
        val single = ChartMath.linePoints(listOf(3), 100f, 50f, 10, rtl = false)
        assertEquals(50f, single.single().x)
        assertTrue(ChartMath.linePoints(emptyList(), 100f, 50f, 10, rtl = false).isEmpty())
    }

    @Test fun donutSweepsSumTo360() {
        val sweeps = ChartMath.donutSweeps(listOf(1, 1, 2))
        assertEquals(listOf(90f, 90f, 180f), sweeps)
        assertEquals(listOf(0f, 0f), ChartMath.donutSweeps(listOf(0, 0)))
        assertEquals(listOf(0f, 360f), ChartMath.donutSweeps(listOf(-4, 3)))
    }

    @Test fun percentAndTrend() {
        assertEquals(0, ChartMath.percent(0f))
        assertEquals(67, ChartMath.percent(0.666f))
        assertEquals(100, ChartMath.percent(1.4f))
        assertEquals(TrendDirection.UP, ChartMath.trend(3f))
        assertEquals(TrendDirection.DOWN, ChartMath.trend(-1f))
        assertEquals(TrendDirection.FLAT, ChartMath.trend(0.4f))
        assertEquals(4, ChartMath.trendMagnitude(-3.6f))
    }

    @Test fun hoursAndMinutes() {
        assertEquals("0.0", ChartMath.hoursOneDecimal(0))
        assertEquals("1.0", ChartMath.hoursOneDecimal(60))
        assertEquals("1.6", ChartMath.hoursOneDecimal(95))
        assertEquals("12.5", ChartMath.hoursOneDecimal(750))
        assertEquals(2L to 5L, ChartMath.splitMinutes(125))
        assertEquals(0L to 0L, ChartMath.splitMinutes(-9))
    }

    @Test fun weekStartRespectsPreference() {
        val wednesday = LocalDate.of(2026, 11, 4)
        assertEquals(LocalDate.of(2026, 11, 1), ChartMath.weekStartFor(wednesday, DayOfWeek.SUNDAY))
        assertEquals(LocalDate.of(2026, 11, 2), ChartMath.weekStartFor(wednesday, DayOfWeek.MONDAY))
        assertEquals(LocalDate.of(2026, 10, 31), ChartMath.weekStartFor(wednesday, DayOfWeek.SATURDAY))
        assertEquals(LocalDate.of(2026, 11, 1), ChartMath.weekStartFor(LocalDate.of(2026, 11, 1), DayOfWeek.SUNDAY))
    }

    @Test fun topNSortsAndDropsZero() {
        val top = ChartMath.topN(mapOf("b" to 10L, "a" to 10L, "c" to 30L, "z" to 0L, "d" to 1L), 3)
        assertEquals(listOf("c" to 30L, "a" to 10L, "b" to 10L), top)
        assertTrue(ChartMath.topN(mapOf("x" to 5L), 0).isEmpty())
    }
}
