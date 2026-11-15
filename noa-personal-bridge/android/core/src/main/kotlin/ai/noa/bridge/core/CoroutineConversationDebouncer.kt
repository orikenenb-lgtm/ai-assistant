package ai.noa.bridge.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

/**
 * Per-conversation debouncer. Each key has its own buffer and timer [Job]:
 * [submit] appends to the key's buffer and restarts only that key's timer. When the timer
 * completes ([delayMillis] read at timer start), [onFire] receives a copy of the buffer, which is
 * then cleared. [cancel] / [cancelAll] drop timers and buffered messages without firing.
 *
 * Thread-safe: all bookkeeping happens under one lock; [onFire] runs outside the lock.
 * A late timer that was superseded (identity check) never fires. Exceptions thrown by [onFire]
 * (other than cancellation) are swallowed so one conversation cannot break the shared scope.
 */
internal class CoroutineConversationDebouncer(
    val scope: CoroutineScope,
    val delayMillis: () -> Long,
    val onFire: suspend (ConversationKey, List<IncomingMessage>) -> Unit,
) : ConversationDebouncer {

    private val lock = Any()
    private val buffers = HashMap<ConversationKey, MutableList<IncomingMessage>>()
    private val timers = HashMap<ConversationKey, Job>()

    override fun submit(message: IncomingMessage) {
        val key = message.conversationKey
        synchronized(lock) {
            buffers.getOrPut(key) { mutableListOf() }.add(message)
            timers.remove(key)?.cancel()
            val timer = scope.launch(start = CoroutineStart.LAZY) { runTimer(key) }
            timers[key] = timer
            timer.start()
        }
    }

    private suspend fun runTimer(key: ConversationKey) {
        delay(delayMillis().coerceAtLeast(0L))
        val self = coroutineContext.job
        val batch: List<IncomingMessage> = synchronized(lock) {
            if (timers[key] !== self) return // superseded or cancelled
            timers.remove(key)
            buffers.remove(key)?.toList()
        } ?: return
        if (batch.isEmpty()) return
        try {
            onFire(key, batch)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Deliberately not logged: the failure may carry content. The coordinator handles its own errors.
        }
    }

    override fun cancel(key: ConversationKey) {
        synchronized(lock) {
            timers.remove(key)?.cancel()
            buffers.remove(key)
        }
    }

    override fun cancelAll() {
        synchronized(lock) {
            timers.values.forEach { it.cancel() }
            timers.clear()
            buffers.clear()
        }
    }

    override fun pendingKeys(): Set<ConversationKey> = synchronized(lock) { timers.keys.toSet() }
}
