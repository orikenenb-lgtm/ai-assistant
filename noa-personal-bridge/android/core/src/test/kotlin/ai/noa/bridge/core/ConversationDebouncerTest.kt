package ai.noa.bridge.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationDebouncerTest {
    private val keyA = keyOf(snapshot(tag = CONTACT_JID))
    private val keyB = keyOf(snapshot(tag = OTHER_JID))

    @Test fun singleMessageFiresAfterExactlyDelay() = runTest {
        val fired = mutableListOf<Pair<ConversationKey, List<IncomingMessage>>>()
        val d = ConversationDebouncer.create(backgroundScope, { 15_000L }) { k, m -> fired += k to m }
        d.submit(incoming(keyA, "hi", 1))
        advanceTimeBy(14_999); runCurrent()
        assertTrue(fired.isEmpty())
        assertEquals(setOf(keyA), d.pendingKeys())
        advanceTimeBy(1); runCurrent()
        assertEquals(1, fired.size)
        assertEquals(listOf("hi"), fired.single().second.map { it.text })
        assertTrue(d.pendingKeys().isEmpty())
    }

    @Test fun consecutiveMessagesResetTimer() = runTest {
        val fired = mutableListOf<List<IncomingMessage>>()
        val d = ConversationDebouncer.create(backgroundScope, { 15_000L }) { _, m -> fired += m }
        d.submit(incoming(keyA, "1", 1))
        advanceTimeBy(10_000); runCurrent()
        d.submit(incoming(keyA, "2", 2))
        advanceTimeBy(14_999); runCurrent()
        assertTrue(fired.isEmpty())
        advanceTimeBy(1); runCurrent()
        assertEquals(listOf(listOf("1", "2")), fired.map { b -> b.map { it.text } })
        settle()
        assertEquals(1, fired.size)
    }

    @Test fun conversationsAreIndependent() = runTest {
        val fired = mutableListOf<Pair<ConversationKey, Long>>()
        val d = ConversationDebouncer.create(backgroundScope, { 15_000L }) { k, _ -> fired += k to testScheduler.currentTime }
        d.submit(incoming(keyA, "a", 1))
        advanceTimeBy(5_000); runCurrent()
        d.submit(incoming(keyB, "b", 2))
        advanceTimeBy(10_000); runCurrent()
        assertEquals(listOf(keyA to 15_000L), fired)
        advanceTimeBy(5_000); runCurrent()
        assertEquals(listOf(keyA to 15_000L, keyB to 20_000L), fired)
    }

    @Test fun cancelAndCancelAllDropBuffers() = runTest {
        val fired = mutableListOf<ConversationKey>()
        val d = ConversationDebouncer.create(backgroundScope, { 1_000L }) { k, _ -> fired += k }
        d.submit(incoming(keyA, "a", 1))
        d.submit(incoming(keyB, "b", 1))
        d.cancel(keyA)
        assertEquals(setOf(keyB), d.pendingKeys())
        settle()
        assertEquals(listOf(keyB), fired)
        d.submit(incoming(keyA, "a2", 2))
        d.submit(incoming(keyB, "b2", 2))
        d.cancelAll()
        settle()
        assertEquals(listOf(keyB), fired)
        // A buffer cleared by cancel does not leak into the next burst.
        val batches = mutableListOf<List<String>>()
        val d2 = ConversationDebouncer.create(backgroundScope, { 1_000L }) { _, m -> batches += m.map { it.text } }
        d2.submit(incoming(keyA, "old", 1)); d2.cancel(keyA); d2.submit(incoming(keyA, "new", 2))
        settle()
        assertEquals(listOf(listOf("new")), batches)
    }

    @Test fun fireReceivesCopyAndBufferIsCleared() = runTest {
        val batches = mutableListOf<List<String>>()
        val d = ConversationDebouncer.create(backgroundScope, { 1_000L }) { _, m -> batches += m.map { it.text } }
        d.submit(incoming(keyA, "1", 1))
        settle()
        d.submit(incoming(keyA, "2", 2))
        settle()
        assertEquals(listOf(listOf("1"), listOf("2")), batches)
    }

    @Test fun throwingCallbackDoesNotBreakOtherKeys() = runTest {
        val fired = mutableListOf<ConversationKey>()
        val d = ConversationDebouncer.create(backgroundScope, { 1_000L }) { k, _ ->
            if (k == keyA) error("boom")
            fired += k
        }
        d.submit(incoming(keyA, "a", 1))
        d.submit(incoming(keyB, "b", 1))
        settle()
        assertEquals(listOf(keyB), fired)
        d.submit(incoming(keyB, "b2", 2))
        settle()
        assertEquals(listOf(keyB, keyB), fired)
    }
}
