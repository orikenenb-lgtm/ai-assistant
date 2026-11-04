package com.disciplineos.core.domain.task

import com.disciplineos.core.model.RecurrenceRule
import com.disciplineos.core.model.Task
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

object RecurrenceEngine : RecurrenceEngineApi {
    override fun occurrenceDates(task: Task, from: LocalDate, to: LocalDate): List<LocalDate> = TODO("Task Engine agent")
}

object DueInstantResolver : DueInstantResolverApi {
    override fun resolve(date: LocalDate, time: LocalTime?, zone: ZoneId): Instant? = TODO("Task Engine agent")
    override fun endOfDay(date: LocalDate, zone: ZoneId): Instant = TODO("Task Engine agent")
}

/** Stable string encoding of RecurrenceRule for persistence (e.g. "W1:MON,WED"). Must round-trip. */
object RecurrenceCodec {
    fun encode(rule: RecurrenceRule): String = TODO("Task Engine agent")
    /** Returns RecurrenceRule.None for blank/unknown input (never throws). */
    fun decode(value: String?): RecurrenceRule = TODO("Task Engine agent")
}
