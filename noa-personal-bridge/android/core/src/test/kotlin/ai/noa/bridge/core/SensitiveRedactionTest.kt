package ai.noa.bridge.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Android 15+ redacts "sensitive" notifications for untrusted listeners (title → app name, text →
 * fixed notice) while keeping the Reply action. Such notifications must never produce a draft.
 * Source: docs/noa-personal-bridge/ANDROID_FEASIBILITY.md.
 */
class SensitiveRedactionTest {
    private val filter = ConversationFilter.create()

    private fun reason(s: NotificationSnapshot) = (filter.evaluate(s, BridgeSettings()) as FilterResult.Rejected).reason

    @Test
    fun englishRedactionNoticeIsHidden() {
        val s = snapshot(messages = listOf(msg("Sensitive notification content hidden", 1, sender = null)))
        assertEquals(RejectReason.HIDDEN_CONTENT, reason(s))
    }

    @Test
    fun hebrewRedactionNoticeIsHidden() {
        val s = snapshot(messages = listOf(msg("‏תוכן ההתראה הרגיש הוסתר", 1, sender = null)))
        assertEquals(RejectReason.HIDDEN_CONTENT, reason(s))
    }

    @Test
    fun appNameAsTitleIsHiddenEvenWithPrivateTag() {
        // Redacted notification still carrying a private JID tag and a "normal-looking" text.
        val s = snapshot(title = "WhatsApp", messages = listOf(msg("1 new message", 1, sender = null)))
        assertEquals(RejectReason.HIDDEN_CONTENT, reason(s))
        val s2 = snapshot(title = "WhatsApp", messages = listOf(msg("anything", 1, sender = null)))
        assertEquals(RejectReason.HIDDEN_CONTENT, reason(s2))
    }

    @Test
    fun senderNamedWhatsAppIsHidden() {
        val s = snapshot(messages = listOf(msg("hello", 1, sender = "WhatsApp")))
        assertEquals(RejectReason.HIDDEN_CONTENT, reason(s))
    }

    @Test
    fun ordinaryMessageWithWordSensitiveIsAccepted() {
        val s = snapshot(messages = listOf(msg("זה נושא רגיש, נדבר בטלפון", 1)))
        assertTrue(filter.evaluate(s, BridgeSettings()) is FilterResult.Accepted)
    }
}
