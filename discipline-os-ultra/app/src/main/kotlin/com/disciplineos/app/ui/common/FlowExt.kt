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
