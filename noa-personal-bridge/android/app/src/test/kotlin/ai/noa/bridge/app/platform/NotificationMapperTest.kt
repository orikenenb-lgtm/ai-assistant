package ai.noa.bridge.app.platform

import android.app.Application
import android.app.Notification
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
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
class NotificationMapperTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val me = Person.Builder().setName("אני").setKey("me").build()
    private val dana = Person.Builder().setName("דנה").setKey("dana").build()
    private val yossi = Person.Builder().setName("יוסי").setKey("yossi").build()

    private fun builder() = NotificationCompat.Builder(context, "test")
        .setSmallIcon(android.R.drawable.sym_action_chat)

    private fun replyAction(semantic: Boolean = true, freeForm: Boolean = true, requestCode: Int = 0) =
        NotificationCompat.Action.Builder(0, "Reply", mutablePendingIntent(context, requestCode))
            .addRemoteInput(
                RemoteInput.Builder("reply_text").setLabel("Reply").setAllowFreeFormInput(freeForm)
                    .apply { if (!freeForm) setChoices(arrayOf("OK")) }
                    .build(),
            )
            .apply { if (semantic) setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY) }
            .build()

    private fun map(n: Notification, tag: String? = "972500000000@s.whatsapp.net") =
        NotificationMapper.map(n, "com.whatsapp", "0|com.whatsapp|1|t|10", tag, 5_000L)

    @Test
    fun privateMessagingStyle() {
        val n = builder()
            .setStyle(
                NotificationCompat.MessagingStyle(me)
                    .addMessage("היי", 1_000L, dana)
                    .addMessage("מתי נפגשים?", 2_000L, dana),
            )
            .setShortcutId("972500000000@s.whatsapp.net")
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .addAction(replyAction())
            .build()

        val s = map(n).snapshot
        assertEquals("com.whatsapp", s.packageName)
        assertEquals("0|com.whatsapp|1|t|10", s.notificationKey)
        assertEquals(5_000L, s.postTimeMillis)
        assertEquals(2, s.messages.size)
        assertEquals("דנה", s.messages[1].sender)
        assertEquals("מתי נפגשים?", s.messages[1].text)
        assertEquals(2_000L, s.messages[1].timestampMillis)
        assertFalse(s.messages.any { it.isFromSelf })
        assertEquals(false, s.isGroupConversationFlag)
        assertNull(s.conversationTitle)
        assertEquals("972500000000@s.whatsapp.net", s.shortcutId)
        assertEquals("msg", s.category)
        assertFalse(s.isGroupSummary)
        assertFalse(s.isOngoing)
        assertTrue(s.hasReplyAction)
    }

    @Test
    fun groupConversation() {
        val n = builder()
            .setStyle(
                NotificationCompat.MessagingStyle(me)
                    .setConversationTitle("משפחה")
                    .setGroupConversation(true)
                    .addMessage("שלום", 1_000L, dana)
                    .addMessage("מה נשמע", 2_000L, yossi),
            )
            .addAction(replyAction())
            .build()

        val s = map(n, tag = "12345@g.us").snapshot
        assertEquals(true, s.isGroupConversationFlag)
        assertEquals("משפחה", s.conversationTitle)
        assertEquals(listOf("דנה", "יוסי"), s.messages.map { it.sender })
    }

    @Test
    fun groupSummary() {
        val n = builder().setContentTitle("WhatsApp").setContentText("5 הודעות מ-2 צ'אטים")
            .setGroup("whatsapp").setGroupSummary(true).build()
        val s = map(n, tag = null).snapshot
        assertTrue(s.isGroupSummary)
        assertFalse(s.hasReplyAction)
    }

    @Test
    fun ongoingNotification() {
        val n = builder().setContentTitle("WhatsApp").setContentText("מגבה הודעות").setOngoing(true).build()
        assertTrue(map(n).snapshot.isOngoing)
    }

    @Test
    fun noStyleFallsBackToTitleAndText() {
        val n = builder().setContentTitle("דנה").setContentText("היי").setWhen(4_000L).build()
        val s = map(n).snapshot
        assertEquals("דנה", s.title)
        assertEquals(1, s.messages.size)
        assertEquals("דנה", s.messages[0].sender)
        assertEquals("היי", s.messages[0].text)
        assertEquals(4_000L, s.messages[0].timestampMillis)
        assertFalse(s.messages[0].isFromSelf)
        // Absent extra must stay "unknown" so the core can fail closed.
        assertNull(s.isGroupConversationFlag)
        assertFalse(s.hasReplyAction)
    }

    @Test
    fun noStyleAndNoTextHasNoMessages() {
        val n = builder().setContentTitle("WhatsApp").build()
        assertTrue(map(n).snapshot.messages.isEmpty())
    }

    @Test
    fun hiddenContentPlaceholderIsPassedThroughVerbatim() {
        // WhatsApp with "hide content" shows a placeholder; the core decides it is HIDDEN_CONTENT.
        val n = builder().setContentTitle("WhatsApp").setContentText("2 הודעות חדשות").build()
        val s = map(n, tag = null).snapshot
        assertEquals(listOf("2 הודעות חדשות"), s.messages.map { it.text })
        assertNull(s.isGroupConversationFlag)
        assertNull(s.shortcutId)
    }

    @Test
    fun selfMessagesAreMarked() {
        val sameKeyAsUser = Person.Builder().setName("אני").setKey("me").build()
        val n = builder()
            .setStyle(
                NotificationCompat.MessagingStyle(me)
                    .addMessage("שאלה", 1_000L, dana)
                    .addMessage("תשובה שלי", 2_000L, null as Person?)
                    .addMessage("גם שלי", 3_000L, sameKeyAsUser),
            )
            .build()
        val msgs = map(n).snapshot.messages
        assertEquals(listOf(false, true, true), msgs.map { it.isFromSelf })
        assertEquals("אני", msgs[1].sender)
    }

    @Test
    fun replyActionDetectionPrefersSemanticReply() {
        val n = builder().setContentTitle("דנה").setContentText("היי")
            .addAction(replyAction(semantic = false, requestCode = 1))
            .addAction(replyAction(semantic = true, requestCode = 2))
            .build()
        val mapped = map(n)
        assertTrue(mapped.snapshot.hasReplyAction)
        val action = assertNotNullAndGet(mapped.replyAction)
        assertTrue(action.isSemanticReply)
        assertEquals(listOf("reply_text"), action.remoteInputs.map { it.resultKey })
    }

    @Test
    fun nonFreeFormRemoteInputIsNotAReplyAction() {
        val plain = NotificationCompat.Action.Builder(0, "Mark read", mutablePendingIntent(context, 3)).build()
        val n = builder().setContentTitle("דנה").setContentText("היי")
            .addAction(plain)
            .addAction(replyAction(freeForm = false, requestCode = 4))
            .build()
        val mapped = map(n)
        assertFalse(mapped.snapshot.hasReplyAction)
        assertNull(mapped.replyAction)
    }

    @Test
    fun nonSemanticFreeFormActionStillCounts() {
        val n = builder().setContentTitle("דנה").setContentText("היי").addAction(replyAction(semantic = false)).build()
        val mapped = map(n)
        assertTrue(mapped.snapshot.hasReplyAction)
        assertFalse(mapped.replyAction!!.isSemanticReply)
    }

    private fun <T> assertNotNullAndGet(value: T?): T {
        assertNotNull(value)
        return value!!
    }
}
