package ai.noa.bridge.core

/**
 * Thread-safe, bounded, TTL-based "seen" set backed by an access-order [LinkedHashMap].
 * - At most [capacity] ids are kept; the least recently seen id is evicted first.
 * - An id older than [ttlMillis] (measured from its most recent sighting) counts as unseen.
 * Only opaque hashes are stored (see [EventIds]); no content.
 */
internal class LruDeduplicator(val clock: Clock, val capacity: Int, val ttlMillis: Long) : Deduplicator {
    init {
        require(capacity > 0) { "capacity must be > 0" }
        require(ttlMillis > 0) { "ttlMillis must be > 0" }
    }

    private val seen = object : LinkedHashMap<String, Long>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Long>?): Boolean = size > capacity
    }

    @Synchronized
    override fun checkAndRecord(eventId: String): Boolean {
        val now = clock.nowMillis()
        purgeExpired(now)
        val wasSeen = seen.containsKey(eventId)
        // Refresh both recency and TTL: history that keeps being re-posted stays de-duplicated.
        seen[eventId] = now
        return wasSeen
    }

    @Synchronized
    override fun clear() {
        seen.clear()
    }

    @Synchronized
    internal fun size(): Int = seen.size

    private fun purgeExpired(now: Long) {
        // Iterating entries does not count as access, so order is preserved. Every sighting re-inserts
        // the id at the tail (access order) with `now`, so entries are ordered by last sighting:
        // the first entry that has not expired ends the purge (O(1) amortized instead of O(n)).
        val it = seen.entries.iterator()
        while (it.hasNext()) {
            if (now - it.next().value >= ttlMillis) it.remove() else break
        }
    }
}
