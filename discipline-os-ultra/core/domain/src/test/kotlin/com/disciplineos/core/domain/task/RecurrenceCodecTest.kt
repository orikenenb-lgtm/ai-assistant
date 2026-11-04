package com.disciplineos.core.domain.task

import com.disciplineos.core.model.RecurrenceRule
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.DayOfWeek
import java.time.DayOfWeek.*

class RecurrenceCodecTest {

    @Test fun encode_stableFormat() {
        assertEquals("NONE", RecurrenceCodec.encode(RecurrenceRule.None))
        assertEquals("D1", RecurrenceCodec.encode(RecurrenceRule.Daily(1)))
        assertEquals("D14", RecurrenceCodec.encode(RecurrenceRule.Daily(14)))
        assertEquals("W1:MON,WED", RecurrenceCodec.encode(RecurrenceRule.Weekly(setOf(WEDNESDAY, MONDAY))))
        assertEquals("W2:MON,SUN", RecurrenceCodec.encode(RecurrenceRule.Weekly(setOf(SUNDAY, MONDAY), 2)))
        assertEquals("M31", RecurrenceCodec.encode(RecurrenceRule.Monthly(31)))
    }

    @Test fun roundTrip_allRules() {
        val rules = buildList {
            add(RecurrenceRule.None)
            listOf(1, 2, 7, 365).forEach { add(RecurrenceRule.Daily(it)) }
            listOf(1, 3, 52).forEach { n ->
                add(RecurrenceRule.Weekly(DayOfWeek.values().toSet(), n))
                add(RecurrenceRule.Weekly(setOf(FRIDAY), n))
                add(RecurrenceRule.Weekly(setOf(SUNDAY, TUESDAY, SATURDAY), n))
            }
            (1..31).forEach { add(RecurrenceRule.Monthly(it)) }
        }
        for (rule in rules) assertEquals(rule, RecurrenceCodec.decode(RecurrenceCodec.encode(rule)))
    }

    @Test fun roundTrip_everyWeekdaySubset() {
        val all = DayOfWeek.values()
        for (mask in 1 until (1 shl 7)) {
            val days = all.filterIndexed { i, _ -> mask and (1 shl i) != 0 }.toSet()
            val rule = RecurrenceRule.Weekly(days, 1)
            assertEquals(rule, RecurrenceCodec.decode(RecurrenceCodec.encode(rule)))
        }
    }

    @Test fun decode_isLenientAboutCaseAndWhitespace() {
        assertEquals(RecurrenceRule.Weekly(setOf(MONDAY, WEDNESDAY)), RecurrenceCodec.decode("  w1:mon, wed "))
        assertEquals(RecurrenceRule.Daily(2), RecurrenceCodec.decode("d2"))
    }

    @Test fun decode_garbage_returnsNone_neverThrows() {
        val garbage = listOf(
            null, "", "   ", "X", "D", "D0", "D-1", "D366", "Dabc", "D99999999999999", "M", "M0", "M32", "Mx",
            "W", "W1", "W1:", "W0:MON", "W53:MON", "W1:FOO", "W1:MON,XYZ", "Wx:MON", "W:MON", ":", "W1::", "NONE?",
            "\u0000", "D1.5", "🙂",
        )
        for (g in garbage) assertEquals("input=$g", RecurrenceRule.None, RecurrenceCodec.decode(g))
    }
}
