package ai.noa.bridge.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LruDeduplicatorTest {
    private var now = 0L
    private val clock = Clock { now }

    @Test fun recordsAndDetects() {
        val d = Deduplicator.create(clock)
        assertFalse(d.checkAndRecord("a"))
        assertTrue(d.checkAndRecord("a"))
        assertFalse(d.checkAndRecord("b"))
    }

    @Test fun expiresAfterTtl() {
        val d = Deduplicator.create(clock, ttlMillis = 1_000)
        assertFalse(d.checkAndRecord("a"))
        now = 999
        assertTrue(d.checkAndRecord("a")) // refreshes
        now = 1_998
        assertTrue(d.checkAndRecord("a"))
        now = 2_998
        assertFalse(d.checkAndRecord("a"))
    }

    @Test fun capacityEvictsLeastRecentlyUsed() {
        val d = LruDeduplicator(clock, capacity = 2, ttlMillis = 10_000)
        d.checkAndRecord("a")
        d.checkAndRecord("b")
        d.checkAndRecord("a") // a is now most recent
        d.checkAndRecord("c") // evicts b
        assertEquals(2, d.size())
        assertTrue(d.checkAndRecord("a"))
        assertFalse(d.checkAndRecord("b"))
    }

    @Test fun clearForgetsEverything() {
        val d = Deduplicator.create(clock)
        d.checkAndRecord("a")
        d.clear()
        assertFalse(d.checkAndRecord("a"))
    }

    @Test fun threadSafeUnderContention() {
        val d = Deduplicator.create(clock, capacity = 100_000)
        val firstSightings = java.util.concurrent.atomic.AtomicInteger()
        val threads = (1..8).map {
            Thread { repeat(1_000) { i -> if (!d.checkAndRecord("id$i")) firstSightings.incrementAndGet() } }
        }
        threads.forEach(Thread::start)
        threads.forEach(Thread::join)
        assertEquals(1_000, firstSightings.get())
    }
}
