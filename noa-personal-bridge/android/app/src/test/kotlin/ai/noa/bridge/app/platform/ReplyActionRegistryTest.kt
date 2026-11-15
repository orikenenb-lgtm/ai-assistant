package ai.noa.bridge.app.platform

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class ReplyActionRegistryTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private fun handle(notificationKey: String = "n1", postTime: Long = 1L) =
        ReplyHandle(mutablePendingIntent(context), emptyArray(), notificationKey, postTime)

    @Test
    fun putReplacesAndGetReturnsLatest() {
        val r = ReplyActionRegistry()
        r.put(key('a'), handle(postTime = 1))
        val newer = handle(postTime = 2)
        r.put(key('a'), newer)
        assertSame(newer, r.get(key('a')))
        assertEquals(1, r.size)
    }

    @Test
    fun takeRemovesSoAHandleIsUsedOnce() {
        val r = ReplyActionRegistry()
        r.put(key('a'), handle())
        assertNotNull(r.take(key('a')))
        assertNull(r.take(key('a')))
        assertNull(r.get(key('a')))
    }

    @Test
    fun removeByNotificationKeyOnlyRemovesMatchingEntries() {
        val r = ReplyActionRegistry()
        r.put(key('a'), handle("n1"))
        r.put(key('b'), handle("n2"))
        assertEquals(setOf(key('a')), r.removeByNotificationKey("n1"))
        assertNull(r.get(key('a')))
        assertNotNull(r.get(key('b')))
    }

    @Test
    fun boundedToMaxEntriesEvictingOldestPostTime() {
        val r = ReplyActionRegistry(maxEntries = 50)
        val keys = ('A'..'Z') + ('a'..'z')
        keys.forEachIndexed { i, c -> r.put(key(c), handle("n$i", postTime = 100L + i)) }
        assertEquals(50, r.size)
        assertNull(r.get(key('A')))
        assertNull(r.get(key('B')))
        assertNotNull(r.get(key('z')))
    }

    @Test
    fun clearEmptiesRegistry() {
        val r = ReplyActionRegistry()
        r.put(key('a'), handle())
        r.clear()
        assertEquals(0, r.size)
    }

    @Test
    fun concurrentAccessIsSafe() {
        val r = ReplyActionRegistry(maxEntries = 50)
        val pi = mutablePendingIntent(context)
        val pool = Executors.newFixedThreadPool(8)
        repeat(2_000) { i ->
            pool.execute {
                val k = key("0123456789abcdef"[i % 16])
                r.put(k, ReplyHandle(pi, emptyArray(), "n$i", i.toLong()))
                r.take(k)
                r.removeByNotificationKey("n${i - 1}")
            }
        }
        pool.shutdown()
        assert(pool.awaitTermination(30, TimeUnit.SECONDS))
        assert(r.size <= 16)
    }
}
