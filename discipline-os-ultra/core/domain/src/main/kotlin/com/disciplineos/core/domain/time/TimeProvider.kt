package com.disciplineos.core.domain.time

import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Single source of "now" so every rule is deterministic and testable (inject a fixed Clock in tests). */
interface TimeProvider {
    fun now(): Instant
    fun zone(): ZoneId
    fun today(): LocalDate = now().atZone(zone()).toLocalDate()
}

class ClockTimeProvider(private val clock: Clock) : TimeProvider {
    override fun now(): Instant = clock.instant()
    override fun zone(): ZoneId = clock.zone
}

/** Production provider: re-reads the system zone on every call so time-zone changes (travel, DST rules) apply immediately. */
object SystemTimeProvider : TimeProvider {
    override fun now(): Instant = Instant.now()
    override fun zone(): ZoneId = ZoneId.systemDefault()
}
