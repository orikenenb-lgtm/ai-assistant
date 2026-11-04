package com.disciplineos.core.model

import java.time.DayOfWeek

/** Recurrence is expressed in local calendar terms. Encoding/decoding lives in core:domain (RecurrenceCodec). */
sealed interface RecurrenceRule {
    data object None : RecurrenceRule
    data class Daily(val everyNDays: Int = 1) : RecurrenceRule {
        init { require(everyNDays in 1..365) }
    }
    data class Weekly(val daysOfWeek: Set<DayOfWeek>, val everyNWeeks: Int = 1) : RecurrenceRule {
        init { require(daysOfWeek.isNotEmpty() && everyNWeeks in 1..52) }
    }
    /** Day 29–31 clamp to the last day of shorter months. */
    data class Monthly(val dayOfMonth: Int) : RecurrenceRule {
        init { require(dayOfMonth in 1..31) }
    }
}
