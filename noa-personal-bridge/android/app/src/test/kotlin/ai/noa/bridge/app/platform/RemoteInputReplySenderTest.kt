package ai.noa.bridge.app.platform

import ai.noa.bridge.core.SendOutcome
import android.app.Application
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
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
    // The test thread IS the Robolectric main thread, so run "main" work inline.
    private var activeKeys: Set<String>? = setOf("n1")
    private val sender = RemoteInputReplySender(context, registry, Dispatchers.Unconfined) { activeKeys }

    private fun freeFormInput(key: String) = RemoteInput.Builder(key).setLabel("Reply").build()

    private fun sentReplyBroadcasts(): List<Intent> =
        shadowOf(context).broadcastIntents.filter { it.action == TEST_REPLY_ACTION }

    @Test
    fun noHandleMeansFailedNoAction() = runTest {
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun sendsTextIntoEveryFreeFormRemoteInputAndReportsAttempted() = runTest {
        val pi = mutablePendingIntent(context)
        registry.put(key('a'), ReplyHandle(pi, arrayOf(freeFormInput("reply_text"), freeFormInput("alt_key")), "n1", 1L))

        val outcome = sender.send(key('a'), "נשמע מעולה, נתראה ב־20:00")

        assertEquals(SendOutcome.ATTEMPTED, outcome)
        val sent = sentReplyBroadcasts()
        assertEquals(1, sent.size)
        val results = RemoteInput.getResultsFromIntent(sent.single())
        assertEquals("נשמע מעולה, נתראה ב־20:00", results.getCharSequence("reply_text").toString())
        assertEquals("נשמע מעולה, נתראה ב־20:00", results.getCharSequence("alt_key").toString())
        assertEquals(RemoteInput.SOURCE_FREE_FORM_INPUT, RemoteInput.getResultsSource(sent.single()))
    }

    @Test
    fun handleIsRemovedAfterAttemptSoNoSecondSend() = runTest {
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), arrayOf(freeFormInput("reply_text")), "n1", 1L))
        assertEquals(SendOutcome.ATTEMPTED, sender.send(key('a'), "אחת"))
        assertNull(registry.get(key('a')))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שתיים"))
        assertEquals(1, sentReplyBroadcasts().size)
    }

    @Test
    fun cancelledPendingIntentMeansFailedCanceled() = runTest {
        val pi = mutablePendingIntent(context)
        pi.cancel()
        registry.put(key('a'), ReplyHandle(pi, arrayOf(freeFormInput("reply_text")), "n1", 1L))
        assertEquals(SendOutcome.FAILED_CANCELED, sender.send(key('a'), "שלום"))
        assertNull(registry.get(key('a')))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun immutablePendingIntentIsNotUsed() = runTest {
        val pi = PendingIntent.getBroadcast(
            context, 9, Intent(TEST_REPLY_ACTION).setPackage(context.packageName), PendingIntent.FLAG_IMMUTABLE,
        )
        registry.put(key('a'), ReplyHandle(pi, arrayOf(freeFormInput("reply_text")), "n1", 1L))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun blankTextIsNeverSentAndKeepsHandle() = runTest {
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), arrayOf(freeFormInput("reply_text")), "n1", 1L))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "   "))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun notificationNoLongerActiveMeansFailedNoAction() = runTest {
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), arrayOf(freeFormInput("reply_text")), "n1", 1L))
        activeKeys = setOf("some-other-notification")
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שלום"))
        assertNull(registry.get(key('a')))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun listenerDisconnectedMeansFailedNoAction() = runTest {
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), arrayOf(freeFormInput("reply_text")), "n1", 1L))
        activeKeys = null
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }

    @Test
    fun choiceOnlyInputsAreNotUsed() = runTest {
        val choiceOnly = RemoteInput.Builder("choice").setChoices(arrayOf("OK")).setAllowFreeFormInput(false).build()
        registry.put(key('a'), ReplyHandle(mutablePendingIntent(context), arrayOf(choiceOnly), "n1", 1L))
        assertEquals(SendOutcome.FAILED_NO_ACTION, sender.send(key('a'), "שלום"))
        assertTrue(sentReplyBroadcasts().isEmpty())
    }
}
