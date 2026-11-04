package com.disciplineos.core.domain.time

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import java.time.LocalDate

/** Default polling period of [observeLocalDate]: once a minute is plenty to notice midnight, and costs nothing. */
const val LOCAL_DATE_TICK_MILLIS: Long = 60_000L

/**
 * Emits [TimeProvider.today] immediately and then again only when the local date changes (midnight rollover or a
 * time-zone change), polling every [tickMillis]. Long-lived date-windowed flows `flatMapLatest` on it so a screen
 * left open past midnight re-subscribes its queries for the new day.
 */
fun TimeProvider.observeLocalDate(tickMillis: Long = LOCAL_DATE_TICK_MILLIS): Flow<LocalDate> {
    val period = tickMillis.coerceAtLeast(1)
    return flow {
        while (true) {
            emit(today())
            delay(period)
        }
    }.distinctUntilChanged()
}
