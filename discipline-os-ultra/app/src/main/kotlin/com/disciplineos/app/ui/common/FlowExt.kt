package com.disciplineos.app.ui.common

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

/**
 * Builds the upstream lazily inside the collector, so an exception thrown while *creating* a flow
 * (not only while collecting it) is still routed to downstream `catch` operators.
 */
fun <T> deferredFlow(block: () -> Flow<T>): Flow<T> = flow { emitAll(block()) }

/** Wraps each value in [Result]; an upstream failure becomes a single [Result.failure] emission. */
fun <T> Flow<T>.asResult(): Flow<Result<T>> =
    map { Result.success(it) }.catch { emit(Result.failure(it)) }

/**
 * Runs a suspending domain call, turning any failure into [Result.failure] while still propagating
 * coroutine cancellation (unlike `runCatching`).
 */
suspend fun <T> safeCall(block: suspend () -> T): Result<T> = try {
    Result.success(block())
} catch (e: kotlinx.coroutines.CancellationException) {
    throw e
} catch (e: Throwable) {
    Result.failure(e)
}

/** Emits [System.currentTimeMillis]-independent ticks: the first immediately, then every [periodMillis]. */
fun tickerFlow(periodMillis: Long): Flow<Unit> = flow {
    while (true) {
        emit(Unit)
        kotlinx.coroutines.delay(periodMillis)
    }
}
