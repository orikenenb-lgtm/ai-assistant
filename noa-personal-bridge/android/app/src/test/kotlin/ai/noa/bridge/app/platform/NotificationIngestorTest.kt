package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.NotificationSnapshot
import android.app.Application
import android.app.RemoteInput
import android.service.notification.NotificationListenerService
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class NotificationIngestorTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val registry = ReplyActionRegistry()
    private val posted = mutableListOf<NotificationSnapshot>()
    private val removed = mutableListOf<ConversationKey>()
    // Fake key derivation: independent of the core implementation.
    private val ingestor = NotificationIngestor(registry, { posted += it }, { removed += it }, { s -> s.tag?.let { key(it.first()) } })

    private fun replyAction() = ReplyAction(
        mutablePendingIntent(context),
        arrayOf(RemoteInput.Builder("reply_text").build()),
        isSemanticReply = true,
    )

    @Test
    fun onlyPersonalWhatsAppInSameUserIsAccepted() {
        assertTrue(ingestor.accepts("com.whatsapp", isSameUser = true))
        assertFalse(ingestor.accepts("com.whatsapp.w4b", isSameUser = true))
        assertFalse(ingestor.accepts("org.telegram.messenger", isSameUser = true))
        assertFalse(ingestor.accepts("com.whatsapp", isSameUser = false)) // Dual Messenger / work profile clone
    }

    @Test
    fun postedRegistersReplyHandleAndForwardsSnapshot() {
        ingestor.onPosted(MappedNotification(snapshot(tag = "a"), replyAction()))
        assertEquals(1, posted.size)
        assertNotNull(registry.get(key('a')))
    }

    @Test
    fun groupSummaryOngoingAndGroupChatsGetNoReplyHandle() {
        ingestor.onPosted(MappedNotification(snapshot(tag = "a", isGroupSummary = true), replyAction()))
        ingestor.onPosted(MappedNotification(snapshot(tag = "b", isOngoing = true), replyAction()))
        ingestor.onPosted(MappedNotification(snapshot(tag = "c", isGroupFlag = true), replyAction()))
        assertEquals(0, registry.size)
        assertEquals(3, posted.size) // the core still sees them and rejects them
    }

    @Test
    fun redactedNotificationGetsNoReplyHandle() {
        ingestor.onPosted(MappedNotification(snapshot(tag = "a"), replyAction(), isLikelyRedacted = true))
        assertNull(registry.get(key('a')))
        assertEquals(1, posted.size) // the core still sees it and rejects it as HIDDEN_CONTENT
    }

    @Test
    fun snapshotTheCoreWouldRejectGetsNoReplyHandle() {
        val strict = NotificationIngestor(registry, { posted += it }, { removed += it }, { s -> s.tag?.let { key(it.first()) } }, { it.tag == "a" })
        strict.onPosted(MappedNotification(snapshot(tag = "a"), replyAction()))
        strict.onPosted(MappedNotification(snapshot(tag = "b"), replyAction()))
        assertNotNull(registry.get(key('a')))
        assertNull(registry.get(key('b')))
    }

    @Test
    fun rebuildReplacesRegistryWithoutFeedingTheCoordinator() {
        ingestor.onPosted(MappedNotification(snapshot(notificationKey = "old", tag = "z"), replyAction()))
        posted.clear()
        ingestor.rebuildFrom(
            listOf(
                MappedNotification(snapshot(notificationKey = "n1", tag = "a"), replyAction()),
                MappedNotification(snapshot(notificationKey = "n2", tag = "b"), replyAction(), isLikelyRedacted = true),
            ),
        )
        assertNull(registry.get(key('z')))
        assertNotNull(registry.get(key('a')))
        assertNull(registry.get(key('b')))
        assertTrue(posted.isEmpty())
        assertTrue(removed.isEmpty())
    }

    @Test
    fun removalReasonsThatMeanHandledElsewhereNotifyTheCoordinator() {
        val reasons = listOf(
            NotificationListenerService.REASON_CLICK,
            NotificationListenerService.REASON_CANCEL,
            NotificationListenerService.REASON_CANCEL_ALL,
            NotificationListenerService.REASON_APP_CANCEL,
            NotificationListenerService.REASON_APP_CANCEL_ALL,
        )
        reasons.forEachIndexed { i, reason ->
            ingestor.onPosted(MappedNotification(snapshot(notificationKey = "n$i", tag = "a"), replyAction()))
            ingestor.onRemoved(MappedNotification(snapshot(notificationKey = "n$i", tag = "a"), null), reason)
            assertNull(registry.get(key('a')))
        }
        assertEquals(reasons.size, removed.size)
    }

    @Test
    fun otherRemovalReasonsOnlyDropTheHandle() {
        val reasons = listOf(
            NotificationListenerService.REASON_TIMEOUT,
            NotificationListenerService.REASON_SNOOZED,
            NotificationListenerService.REASON_LISTENER_CANCEL,
            NotificationListenerService.REASON_GROUP_SUMMARY_CANCELED,
            NotificationListenerService.REASON_CHANNEL_BANNED,
        )
        reasons.forEach { reason ->
            ingestor.onPosted(MappedNotification(snapshot(notificationKey = "n1", tag = "a"), replyAction()))
            ingestor.onRemoved(MappedNotification(snapshot(notificationKey = "n1", tag = "a"), null), reason)
            assertNull(registry.get(key('a')))
        }
        assertTrue(removed.isEmpty())
    }

    @Test
    fun removalOfADifferentNotificationKeepsTheHandle() {
        ingestor.onPosted(MappedNotification(snapshot(notificationKey = "n1", tag = "a"), replyAction()))
        ingestor.onRemoved(MappedNotification(snapshot(notificationKey = "n2", tag = "b"), null), NotificationListenerService.REASON_TIMEOUT)
        assertNotNull(registry.get(key('a')))
    }
}
