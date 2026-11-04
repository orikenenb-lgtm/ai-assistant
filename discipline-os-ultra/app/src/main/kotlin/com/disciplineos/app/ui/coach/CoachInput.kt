package com.disciplineos.app.ui.coach

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/** Pure input rules for the coach composer (unit-tested in CoachInputTest). */
object CoachInput {
    /** Mirrors PromptInjectionGuard.MAX_USER_CHARS; kept here so the UI rule is testable without the domain body. */
    const val MAX_CHARS = 2_000

    /** Hard-caps what the text field accepts (paste of a huge text is truncated, never rejected silently). */
    fun clamp(raw: String): String = if (raw.length <= MAX_CHARS) raw else raw.take(MAX_CHARS)

    fun canSend(text: String, sending: Boolean, limitReached: Boolean): Boolean =
        !sending && !limitReached && text.isNotBlank() && text.length <= MAX_CHARS

    /** Show the counter only when it is useful (last 20%), to keep the composer calm. */
    fun showCounter(length: Int): Boolean = length >= MAX_CHARS * 8 / 10

    /** The next reply goes to the remote backend only with explicit user opt-in AND a configured backend. */
    fun usesRemote(remoteEnabled: Boolean, backendConfigured: Boolean): Boolean = remoteEnabled && backendConfigured

    /**
     * The daily-limit banner applies only to the local day on which the limit was hit. After midnight it lifts
     * (the domain's CostGuard re-counts on the next send anyway). If the clock moved backwards, stay conservative.
     */
    fun isLimitActive(limitReachedOn: LocalDate?, today: LocalDate): Boolean =
        limitReachedOn != null && !today.isAfter(limitReachedOn)

    /** Longest wait between "has the day changed?" checks (also bounds drift from sleep, zone or clock changes). */
    const val MAX_DAY_CHECK_MILLIS = 60_000L

    /** Delay until the next local midnight, clamped to 1s..[MAX_DAY_CHECK_MILLIS]. */
    fun dayCheckDelayMillis(now: Instant, zone: ZoneId): Long {
        val nextMidnight = now.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant()
        return Duration.between(now, nextMidnight).toMillis().coerceIn(1_000L, MAX_DAY_CHECK_MILLIS)
    }
}
