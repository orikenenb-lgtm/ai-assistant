package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.ConversationKeys
import ai.noa.bridge.core.SendOutcome
import android.app.Application
import android.app.Notification
import android.app.PendingIntent
import android.content.Intent
import android.os.Process
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class RemoteInputReplySenderTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val registry = ReplyActionRegistry()
    private val me = Person.Builder().setName("אני").setKey("me").build()
    private val dana = Person.Builder().setName("דנה").setKey("dana").build()

    /** The listener's live notifications, by notification key (absent = no longer showing). */
    private val live = mutableMapOf<String, MappedNotification>()
    private var gateOpen = true
    private val order = mutableListOf<String>()

    // The test thread IS the Robolectric main thread, so run "main" work inline.
    private val sender = RemoteInputReplySender(
        context = context,
        registry = registry,
        sendGate = { order += "gate"; gateOpen },
        mainDispatcher = Dispatchers.Unconfined,
        liveNotification = { k -> order += "live"; live[k] },
    )

    private fun replyIntent(action: String = TEST_REPLY_ACTION, requestCode: Int = 0, flags: Int = PendingIntent.FLAG_MUTABLE): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            requestCode,
            Intent(action).setPackage(context.packageName),
            flags or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun sentReplyBroadcasts(): List<Intent> =
        shadowOf(context).broadcastIntents.filter { it.action?.startsWith(TEST_REPLY_ACTION) == true }

    /** A WhatsApp-shaped private-chat notification whose Reply action uses [pi]. */
    private fun chat(
        pi: PendingIntent,
        jid: String = DANA_JID,
        inputs: List<RemoteInput> = listOf(RemoteInput.Builder("reply_text").setLabel("Reply").build()),
        group: Boolean = false,
        title: String = "דנה",
    ): Notification {
        val style = NotificationCompat.MessagingStyle(me).addMessage("היי", 1_000L, dana)
        if (group) style.setConversationTitle("משפחה").setGroupConversation(true)
        val action = NotificationCompat.Action.Builder(0, "Reply", pi)
            .apply { inputs.forEach { addRemoteInput(it) } }
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .build()
        return NotificationCompat.Builder(context, "test")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(title)
            .setStyle(style)
            .setShortcutId(jid)
            .addAction(action)
            .build()
    }

    private fun map(n: Notification, notificationKey: String = "n1") =
        NotificationMapper.map(n, "com.whatsapp", notificationKey, null, 1L)

    /** Posts [n] as live under [notificationKey] and registers its cached handle; returns its conversation key. */
    private fun post(n: Notification, notificationKey: String = "n1"): ConversationKey {
        val mapped = map(n, notificationKey)
        live[notificationKey] = mapped
        val key = ConversationKeys.derive(mapped.snapshot)!!
        val action = mapped.replyAction!!
        registry.put(key, ReplyHandle(action.pendingIntent, action.remoteInputs, notificationKey, 1L))
        return key
    }

    @Test
    fun noHandleMeansFailedNoAction() = runTest {
        live["n1"] = map(chat(replyIntent()))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun sendsTextIntoEveryFreeFormRemoteInputAndReportsAttempted() = runTest {
        val k = post(
            chat(
                replyIntent(),
                inputs = listOf(
                    RemoteInput.Builder("reply_text").setLabel("Reply").build(),
                    RemoteInput.Builder("alt_key").setLabel("Reply").build(),
                ),
            ),
        )

        val outcome = sender.send(k, "נשמע מעולה, נתראה ב־20:00")

        assertEquals(SendOutcome.ATTEMPTED, outcome)
        val sent = sentReplyBroadcasts()
        assertEquals(1, sent.size)
        val results = android.app.RemoteInput.getResultsFromIntent(sent.single())
        assertEquals("נשמע מעולה, נתראה ב־20:00", results.getCharSequence("reply_text").toString())
        assertEquals("נשמע מעולה, נתראה ב־20:00", results.getCharSequence("alt_key").toString())
        assertEquals(android.app.RemoteInput.SOURCE_FREE_FORM_INPUT, android.app.RemoteInput.getResultsSource(sent.single()))
    }

    @Test
    fun handleIsRemovedAfterAttemptSoNoSecondSend() = runTest {
        val k = post(chat(replyIntent()))
        assertEquals(SendOutcome.ATTEMPTED, sender.send(k, "אחת"))
        assertNull(registry.get(k))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "שתיים"))
        assertEquals(1, sentReplyBroadcasts().size)
    }

    @Test
    fun cancelledPendingIntentMeansFailedCanceled() = runTest {
        val pi = replyIntent()
        val k = post(chat(pi))
        pi.cancel()
        assertEquals(SendOutcome.FAILED_CANCELED, sender.send(k, "שלום"))
        assertNull(registry.get(k))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun immutablePendingIntentIsNotUsed() = runTest {
        val k = post(chat(replyIntent(requestCode = 9, flags = PendingIntent.FLAG_IMMUTABLE)))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun blankTextIsNeverSentAndKeepsHandle() = runTest {
        val k = post(chat(replyIntent()))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "   "))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun notificationNoLongerActiveMeansFailedNoAction() = runTest {
        val k = post(chat(replyIntent()))
        live.clear() // withdrawn, or the listener is not connected
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "שלום"))
        assertNull(registry.get(k))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun choiceOnlyInputsAreNotUsed() = runTest {
        val k = post(chat(replyIntent()))
        val choiceOnly = RemoteInput.Builder("choice").setChoices(arrayOf("OK")).setAllowFreeFormInput(false).build()
        live["n1"] = map(chat(replyIntent(requestCode = 2), inputs = listOf(choiceOnly)))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    // ---------------------------------------------------------------- M-3: send-time re-validation

    @Test
    fun m3_slotNowShowingAnotherConversationIsNeverRepliedThrough() = runTest {
        val danaKey = post(chat(replyIntent("$TEST_REPLY_ACTION.dana", 1), jid = DANA_JID))
        // WhatsApp reused the slot "n1" for Yossi's chat (same notification key, new content).
        live["n1"] = map(chat(replyIntent("$TEST_REPLY_ACTION.yossi", 2), jid = YOSSI_JID, title = "יוסי"))

        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(danaKey, "רק לדנה"))
        assertTrue("nothing may reach the other chat", sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun m3_liveReplyActionIsUsedNotTheCachedOne() = runTest {
        val k = post(chat(replyIntent("$TEST_REPLY_ACTION.cached", 1)))
        // Same conversation re-posted with a fresh reply action since the handle was cached.
        live["n1"] = map(chat(replyIntent("$TEST_REPLY_ACTION.live", 2)))

        assertEquals(SendOutcome.ATTEMPTED, sender.send(k, "שלום"))
        assertEquals(listOf("$TEST_REPLY_ACTION.live"), sentReplyBroadcasts().map { it.action })
    }

    @Test
    fun m3_liveNotificationThatIsNowGroupOrRedactedIsNeverUsed() = runTest {
        val k = post(chat(replyIntent()))
        live["n1"] = map(chat(replyIntent(requestCode = 3), group = true))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "שלום"))

        val k2 = post(chat(replyIntent(requestCode = 4)), notificationKey = "n2")
        live["n2"] = map(
            NotificationCompat.Builder(context, "test").setSmallIcon(android.R.drawable.sym_action_chat)
                .setContentTitle("WhatsApp").setContentText("Sensitive notification content hidden")
                .setShortcutId(DANA_JID)
                .addAction(NotificationCompat.Action.Builder(0, "Reply", replyIntent(requestCode = 5))
                    .addRemoteInput(RemoteInput.Builder("reply_text").build()).build())
                .build(),
            "n2",
        )
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k2, "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun m3_realStatusBarNotificationIsReMappedAtSendTime() = runTest {
        val pi = replyIntent("$TEST_REPLY_ACTION.sbn", 7)
        @Suppress("DEPRECATION")
        val sbn = StatusBarNotification(
            "com.whatsapp", "com.whatsapp", 42, null, 10_123, 0, 0, chat(pi), Process.myUserHandle(), 1L,
        )
        val sbnSender = RemoteInputReplySender(
            context, registry, sendGate = { true }, mainDispatcher = Dispatchers.Unconfined,
            liveNotification = { k -> sbn.takeIf { it.key == k }?.let(NotificationMapper::map) },
        )
        val mapped = NotificationMapper.map(sbn)
        val k = ConversationKeys.derive(mapped.snapshot)!!
        registry.put(k, ReplyHandle(mapped.replyAction!!.pendingIntent, mapped.replyAction!!.remoteInputs, sbn.key, 1L))

        assertEquals(SendOutcome.ATTEMPTED, sbnSender.send(k, "שלום"))
        assertEquals(listOf("$TEST_REPLY_ACTION.sbn"), sentReplyBroadcasts().map { it.action })
    }

    // ---------------------------------------------------------------- L-2: final gate

    @Test
    fun l2_closedGateAtSendTimeMeansNothingIsSent() = runTest {
        val k = post(chat(replyIntent()))
        gateOpen = false // e.g. Emergency Stop tapped / device locked after the core's checks
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(k, "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
        assertNull("the handle is spent: a later send needs a fresh notification", registry.get(k))
    }

    @Test
    fun l2_gateIsTheLastCheckBeforeTheSend() = runTest {
        val k = post(chat(replyIntent()))
        order.clear()
        assertEquals(SendOutcome.ATTEMPTED, sender.send(k, "שלום"))
        assertEquals(listOf("live", "gate"), order)
    }

    @Test
    fun l2_throwingGateCountsAsClosed() = runTest {
        val k = post(chat(replyIntent()))
        val throwing = RemoteInputReplySender(
            context, registry, sendGate = { throw IllegalStateException("boom") },
            mainDispatcher = Dispatchers.Unconfined, liveNotification = { live[it] },
        )
        assertEquals(SendOutcome.FAILED_NO_ACTION, throwing.send(k, "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    private companion object {
        const val DANA_JID = "972501112222@s.whatsapp.net"
        const val YOSSI_JID = "972503334444@s.whatsapp.net"
    }
}
