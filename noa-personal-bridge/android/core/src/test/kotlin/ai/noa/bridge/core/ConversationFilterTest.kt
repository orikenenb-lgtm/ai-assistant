package ai.noa.bridge.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConversationFilterTest {
    private val filter = ConversationFilter.create()
    private val on = BridgeSettings(cloudConsentGiven = true)

    private fun reason(s: NotificationSnapshot, settings: BridgeSettings = on): RejectReason? =
        (filter.evaluate(s, settings) as? FilterResult.Rejected)?.reason

    // ------------------------------------------------------------ classify

    @Test fun privateByFlagFalse() {
        assertEquals(ChatKind.PRIVATE, filter.classify(snapshot(tag = "x", isGroupConversationFlag = false)))
    }

    @Test fun privateByJidWithoutFlag() {
        assertEquals(ChatKind.PRIVATE, filter.classify(snapshot(tag = CONTACT_JID, isGroupConversationFlag = null)))
        assertEquals(
            ChatKind.PRIVATE,
            filter.classify(snapshot(tag = null, shortcutId = CONTACT_JID, isGroupConversationFlag = null)),
        )
    }

    @Test fun unknownWithoutAnySignal() {
        assertEquals(ChatKind.UNKNOWN, filter.classify(snapshot(tag = "opaque", isGroupConversationFlag = null)))
        assertEquals(ChatKind.UNKNOWN, filter.classify(snapshot(tag = null, isGroupConversationFlag = null)))
    }

    @Test fun groupByFlag() {
        assertEquals(ChatKind.GROUP, filter.classify(snapshot(isGroupConversationFlag = true)))
    }

    @Test fun groupByGroupJidInTagOrShortcut() {
        assertEquals(ChatKind.GROUP, filter.classify(snapshot(tag = "1203630@g.us", isGroupConversationFlag = false)))
        assertEquals(
            ChatKind.GROUP,
            filter.classify(snapshot(tag = CONTACT_JID, shortcutId = "1203630@g.us", isGroupConversationFlag = false)),
        )
    }

    @Test fun groupByMultipleSenders() {
        val s = snapshot(messages = listOf(msg("a", 1, "Dana"), msg("b", 2, "Yossi")), isGroupConversationFlag = false)
        assertEquals(ChatKind.GROUP, filter.classify(s))
    }

    @Test fun selfAndNullSendersDoNotMakeAGroup() {
        val s = snapshot(
            messages = listOf(msg("a", 1, "Dana"), msg("b", 2, "Me", self = true), msg("c", 3, null)),
            isGroupConversationFlag = false,
        )
        assertEquals(ChatKind.PRIVATE, filter.classify(s))
    }

    @Test fun groupByDifferingTitles() {
        val s = snapshot(conversationTitle = "Family", title = "Family: Dana", isGroupConversationFlag = null)
        assertEquals(ChatKind.GROUP, filter.classify(s))
        assertEquals(ChatKind.PRIVATE, filter.classify(snapshot(conversationTitle = "Dana", title = "Dana")))
    }

    @Test fun groupSignalWinsOverPrivateSignal() {
        assertEquals(ChatKind.GROUP, filter.classify(snapshot(tag = CONTACT_JID, isGroupConversationFlag = true)))
    }

    // ------------------------------------------------------------ evaluate: every RejectReason

    @Test fun notWhatsapp() = assertEquals(RejectReason.NOT_WHATSAPP, reason(snapshot(packageName = "org.telegram")))

    @Test fun allowedPackagesAreConfigurable() {
        val f = ConversationFilter.create(setOf("com.whatsapp.w4b"))
        assertTrue(f.evaluate(snapshot(packageName = "com.whatsapp.w4b"), on) is FilterResult.Accepted)
        assertEquals(
            RejectReason.NOT_WHATSAPP,
            (f.evaluate(snapshot(), on) as FilterResult.Rejected).reason,
        )
    }

    @Test fun ongoingAndCalls() {
        assertEquals(RejectReason.ONGOING_OR_SYSTEM, reason(snapshot(isOngoing = true)))
        assertEquals(RejectReason.ONGOING_OR_SYSTEM, reason(snapshot(category = "call")))
    }

    @Test fun groupSummary() = assertEquals(RejectReason.GROUP_SUMMARY, reason(snapshot(isGroupSummary = true)))

    @Test fun pausedAndEmergency() {
        assertEquals(RejectReason.PAUSED, reason(snapshot(), on.copy(paused = true)))
        assertEquals(RejectReason.PAUSED, reason(snapshot(), on.copy(emergencyStopped = true)))
    }

    @Test fun groupRejected() = assertEquals(RejectReason.GROUP, reason(snapshot(isGroupConversationFlag = true)))

    @Test fun unknownKindRejected() =
        assertEquals(RejectReason.UNKNOWN_CHAT_KIND, reason(snapshot(tag = "opaque", isGroupConversationFlag = null)))

    @Test fun noKeyRejectedAsUnknown() {
        val s = snapshot(tag = null, shortcutId = null, title = null, conversationTitle = null, isGroupConversationFlag = false)
        assertEquals(RejectReason.UNKNOWN_CHAT_KIND, reason(s))
    }

    @Test fun excluded() {
        val s = snapshot()
        assertEquals(RejectReason.EXCLUDED, reason(s, on.copy(excludedConversations = setOf(keyOf(s)))))
    }

    @Test fun noContent() {
        assertEquals(RejectReason.NO_CONTENT, reason(snapshot(messages = emptyList())))
        assertEquals(RejectReason.NO_CONTENT, reason(snapshot(messages = listOf(msg("  ", 1), msg(null, 2)))))
    }

    @Test fun hiddenContent() {
        listOf(
            "3 הודעות חדשות", "2 new messages", "הודעה חדשה", "New message",
            "‏4 הודעות חדשות", "Checking for new messages", "Checking for new messages…".replace("…", "..."),
        ).forEach { text ->
            assertEquals(text, RejectReason.HIDDEN_CONTENT, reason(snapshot(messages = listOf(msg(text, 1)))))
        }
    }

    @Test fun placeholderTextAmongRealMessagesIsNotHidden() {
        val s = snapshot(messages = listOf(msg("New message", 1), msg("real one", 2)))
        assertTrue(filter.evaluate(s, on) is FilterResult.Accepted)
        assertTrue(filter.evaluate(snapshot(messages = listOf(msg("new message for you", 1))), on) is FilterResult.Accepted)
    }

    @Test fun fromSelfWhenLastByTimestampIsMine() {
        // List order is not timestamp order: the self message is the latest.
        val s = snapshot(messages = listOf(msg("me", 5, "Me", self = true), msg("hi", 1)))
        assertEquals(RejectReason.FROM_SELF, reason(s))
        val notLast = snapshot(messages = listOf(msg("me", 1, "Me", self = true), msg("hi", 5)))
        assertTrue(filter.evaluate(notLast, on) is FilterResult.Accepted)
    }

    @Test fun evaluateOrderPackageBeforePaused() {
        assertEquals(RejectReason.NOT_WHATSAPP, reason(snapshot(packageName = "x"), on.copy(paused = true)))
        assertEquals(RejectReason.GROUP_SUMMARY, reason(snapshot(isGroupSummary = true), on.copy(paused = true)))
        assertEquals(RejectReason.PAUSED, reason(snapshot(isGroupConversationFlag = true), on.copy(paused = true)))
    }

    // ------------------------------------------------------------ accepted mapping

    @Test fun acceptedMapsNonSelfNonBlankMessages() {
        val s = snapshot(
            messages = listOf(
                msg("  first  ", 1),
                msg("mine", 2, "Me", self = true),
                msg("   ", 3),
                msg("second", 4, null),
            ),
        )
        val accepted = filter.evaluate(s, on) as FilterResult.Accepted
        assertEquals(keyOf(s), accepted.conversationKey)
        assertEquals(listOf("first", "second"), accepted.messages.map { it.text })
        assertEquals(listOf("Dana", "Dana"), accepted.messages.map { it.senderDisplayName }) // null sender → title
        assertEquals(EventIds.of(keyOf(s), s.messages[0]), accepted.messages[0].eventId)
        assertTrue(accepted.messages.all { it.conversationKey == keyOf(s) })
    }

    @Test fun senderFallsBackToEmpty() {
        val s = snapshot(tag = CONTACT_JID, title = null, messages = listOf(msg("x", 1, null)))
        assertEquals("", (filter.evaluate(s, on) as FilterResult.Accepted).messages.single().senderDisplayName)
    }

    @Test fun cappedAtLast20() {
        val s = snapshot(messages = (1..30).map { msg("m$it", it.toLong()) })
        val accepted = filter.evaluate(s, on) as FilterResult.Accepted
        assertEquals(20, accepted.messages.size)
        assertEquals("m11", accepted.messages.first().text)
        assertEquals("m30", accepted.messages.last().text)
    }
}
