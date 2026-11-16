package ai.noa.bridge.core

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression tests for the independent code review (docs/noa-personal-bridge/CODE_REVIEW.md).
 * Each test is named after the finding it pins down.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ReviewFixesTest {
    private val enabled = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)
    private val filter = ConversationFilter.create()

    private fun TestScope.coordinator(
        engine: FakeEngine = FakeEngine(),
        sender: FakeSender = FakeSender(),
        settings: BridgeSettings = enabled,
    ): BridgeCoordinator {
        var n = 0
        return BridgeCoordinator.create(
            scope = backgroundScope,
            clock = Clock { testScheduler.currentTime },
            engine = engine,
            sender = sender,
            initialSettings = settings,
            idGenerator = { "id-${++n}" },
        )
    }

    private fun TestScope.debounce() {
        advanceTimeBy(BridgeSettings.DEFAULT_DEBOUNCE_MILLIS + 1); runCurrent()
    }

    private fun reason(s: NotificationSnapshot): RejectReason? =
        (filter.evaluate(s, enabled) as? FilterResult.Rejected)?.reason

    // ------------------------------------------------------------------ H-2 (core side)

    @Test
    fun h2_editStoresTrimmedTextAndTheStoredTextIsApprovable() = runTest {
        val sender = FakeSender()
        val c = coordinator(sender = sender)
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        c.edit(d.id, "see you at 8 \n")
        val stored = c.drafts.value.single()
        assertEquals("see you at 8", stored.finalText)
        // The UI approves the STORED text (single normalization point) → approvable at once.
        val approval = c.approve(stored.id, stored.finalText!!)
        assertNotNull(approval)
        assertEquals(DraftState.SEND_ATTEMPTED, c.sendApproved(approval!!))
        assertEquals("see you at 8", sender.sent.single().second)
    }

    @Test
    fun h2_editLongerThanLimitIsRejectedDefensively() = runTest {
        val c = coordinator()
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        c.edit(d.id, "x".repeat(4_001))
        assertEquals(d.finalText, c.drafts.value.single().finalText)
        assertEquals(d.revision, c.drafts.value.single().revision)
        c.edit(d.id, "x".repeat(4_000))
        assertEquals(4_000, c.drafts.value.single().finalText!!.length)
    }

    // ------------------------------------------------------------------ M-1

    @Test
    fun m1_linesAnsweredBeforeTheOwnersLastReplyAreNotDraftedAgain() {
        val r = filter.evaluate(
            snapshot(
                messages = listOf(
                    msg("can you send me the file?", 1),
                    msg("sent it, check mail", 2, sender = "Me", self = true),
                    msg("thanks!", 3),
                ),
            ),
            enabled,
        ) as FilterResult.Accepted
        assertEquals(listOf("thanks!"), r.messages.map { it.text })
    }

    @Test
    fun m1_unorderedHistoryIsCutAtTheLastSelfLineByTimestamp() {
        val r = filter.evaluate(
            snapshot(
                messages = listOf(
                    msg("later 1", 30),
                    msg("old question", 10),
                    msg("my answer", 20, sender = "Me", self = true),
                    msg("later 2", 40),
                ),
            ),
            enabled,
        ) as FilterResult.Accepted
        assertEquals(listOf("later 1", "later 2"), r.messages.map { it.text })
    }

    @Test
    fun m1_lastLineFromSelfStaysFromSelfAndBlankAfterSelfIsNoContent() {
        assertEquals(
            RejectReason.FROM_SELF,
            reason(snapshot(messages = listOf(msg("q", 1), msg("a", 2, sender = "Me", self = true)))),
        )
        assertEquals(
            RejectReason.NO_CONTENT,
            reason(snapshot(messages = listOf(msg("q", 1), msg("a", 2, sender = "Me", self = true), msg("  ", 3)))),
        )
    }

    // ------------------------------------------------------------------ M-2

    @Test
    fun m2_titleOnlyIdentityIsRejectedSoSameNamedContactsNeverShareAKey() {
        val a = snapshot(tag = null, shortcutId = null, title = "Dana", messages = listOf(msg("from Dana A", 1)))
            .copy(notificationKey = "0|com.whatsapp|1|null|111")
        val b = snapshot(tag = null, shortcutId = null, title = "Dana", conversationTitle = "Dana", messages = listOf(msg("from Dana B", 2)))
            .copy(notificationKey = "0|com.whatsapp|2|null|222")
        assertNull(ConversationKeys.derive(a))
        assertNull(ConversationKeys.derive(b))
        assertEquals(RejectReason.UNKNOWN_CHAT_KIND, reason(a))
        assertEquals(RejectReason.UNKNOWN_CHAT_KIND, reason(b))
    }

    @Test
    fun m2_titleOnlyNotificationNeverBecomesADraft() = runTest {
        val engine = FakeEngine()
        val c = coordinator(engine = engine)
        c.onNotification(snapshot(tag = null, shortcutId = null, title = "Dana", messages = listOf(msg("hi", 1))))
        debounce()
        assertTrue(c.drafts.value.isEmpty())
        assertTrue(engine.requests.isEmpty())
    }

    // ------------------------------------------------------------------ L-1

    @Test
    fun l1_groupFlagFalseAloneIsNotAPrivateSignal() {
        assertEquals(ChatKind.UNKNOWN, filter.classify(snapshot(tag = null, shortcutId = null, isGroupConversationFlag = false)))
        assertEquals(ChatKind.UNKNOWN, filter.classify(snapshot(tag = "  ", shortcutId = "", isGroupConversationFlag = false)))
    }

    @Test
    fun l1_privateNeedsAJidOrLidOrFlagFalsePlusAStableId() {
        assertEquals(ChatKind.PRIVATE, filter.classify(snapshot(tag = CONTACT_JID, isGroupConversationFlag = null)))
        assertEquals(ChatKind.PRIVATE, filter.classify(snapshot(tag = null, shortcutId = "123456789012345@lid", isGroupConversationFlag = null)))
        assertEquals(ChatKind.PRIVATE, filter.classify(snapshot(tag = "opaque-id", isGroupConversationFlag = false)))
        assertEquals(ChatKind.UNKNOWN, filter.classify(snapshot(tag = "opaque-id", isGroupConversationFlag = null)))
        // Group signals still win over a private JID / LID.
        assertEquals(ChatKind.GROUP, filter.classify(snapshot(tag = "123@lid", isGroupConversationFlag = true)))
    }

    // ------------------------------------------------------------------ L-3 (core side)

    @Test
    fun l3_approvedDraftWhoseSendWasRefusedCanBeApprovedAgain() = runTest {
        val sender = FakeSender()
        val c = coordinator(sender = sender, settings = enabled.copy(sendingEnabled = false))
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        val first = c.approve(d.id, d.finalText!!)!!
        // Send refused (sending off): the draft stays APPROVED, nothing is consumed or sent.
        assertEquals(DraftState.APPROVED, c.sendApproved(first))
        assertEquals(0, sender.calls.get())

        c.updateSettings(enabled)
        val second = c.approve(d.id, d.finalText!!)
        assertNotNull("an APPROVED draft must never be stuck", second)
        assertNotEquals(first.token, second!!.token)
        assertEquals(DraftState.SEND_ATTEMPTED, c.sendApproved(second))
        assertEquals(1, sender.calls.get())
        // The old approval was burnt by the re-approval and can never send.
        assertEquals(DraftState.SEND_ATTEMPTED, c.sendApproved(first))
        assertEquals(1, sender.calls.get())
    }

    @Test
    fun l3_reapprovalBurnsTheOldTokenBeforeAnySend() = runTest {
        val sender = FakeSender()
        val c = coordinator(sender = sender)
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        val first = c.approve(d.id, d.finalText!!)!!
        val second = c.approve(d.id, d.finalText!!)!!
        assertEquals(DraftState.AWAITING_APPROVAL, c.sendApproved(first)) // old token: invalid, no send
        assertEquals(0, sender.calls.get())
        assertEquals(DraftState.AWAITING_APPROVAL, c.drafts.value.single().state)
        assertEquals(DraftState.AWAITING_APPROVAL, c.sendApproved(second)) // reset by the invalid attempt
        assertEquals(0, sender.calls.get())
    }

    @Test
    fun l3_approvedDraftWithExpiredApprovalCanBeApprovedAgain() = runTest {
        val sender = FakeSender()
        val c = coordinator(sender = sender)
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        c.approve(d.id, d.finalText!!)!!
        advanceTimeBy(3 * 60_000L); runCurrent() // approval TTL is 2 min
        assertEquals(DraftState.APPROVED, c.drafts.value.single().state)
        val renewed = c.approve(d.id, d.finalText!!)
        assertNotNull(renewed)
        assertEquals(DraftState.SEND_ATTEMPTED, c.sendApproved(renewed!!))
        assertEquals(1, sender.calls.get())
    }

    // ------------------------------------------------------------------ L-4

    @Test
    fun l4_revokingConsentFailsInFlightAndDebouncingDraftsAndDropsLateResults() = runTest {
        val engine = FakeEngine().apply { gate = CompletableDeferred() }
        val c = coordinator(engine = engine)
        c.onNotification(snapshot(tag = CONTACT_JID, messages = listOf(msg("first chat", 1))))
        debounce() // → PROCESSING, engine suspended on the gate
        val processing = c.drafts.value.single()
        assertEquals(DraftState.PROCESSING, processing.state)
        c.onNotification(snapshot(tag = OTHER_JID, messages = listOf(msg("second chat", 2))))
        val debouncing = c.drafts.value.single { it.state == DraftState.DEBOUNCING }

        c.updateSettings(enabled.copy(cloudConsentGiven = false))

        val after = c.drafts.value.associateBy { it.id }
        assertEquals(DraftState.FAILED, after.getValue(processing.id).state)
        assertEquals(DraftState.FAILED, after.getValue(debouncing.id).state)
        assertEquals("ההסכמה לשליחת תוכן בוטלה", after.getValue(processing.id).statusDetail)
        assertEquals("ההסכמה לשליחת תוכן בוטלה", after.getValue(debouncing.id).statusDetail)

        // The late engine result never becomes a draft; the cancelled debounce never calls the engine.
        engine.gate!!.complete(Unit)
        advanceTimeBy(60_000); runCurrent()
        assertEquals(1, engine.requests.size)
        assertTrue(c.drafts.value.none { it.state == DraftState.AWAITING_APPROVAL || it.finalText != null })
    }

    @Test
    fun l4_consentStillGivenDoesNotTouchInFlightWork() = runTest {
        val engine = FakeEngine().apply { gate = CompletableDeferred() }
        val c = coordinator(engine = engine)
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        c.updateSettings(enabled.copy(sendingEnabled = false))
        assertEquals(DraftState.PROCESSING, c.drafts.value.single().state)
        engine.gate!!.complete(Unit)
        runCurrent()
        assertEquals(DraftState.AWAITING_APPROVAL, c.drafts.value.single().state)
    }

    // ------------------------------------------------------------------ L-5 (core side)

    @Test
    fun l5_oneSharedDetectorAlsoRejectsTheFormerAppOnlyPatterns() {
        listOf("Content hidden", "התוכן הוסתר", "‏התוכן מוסתר", "Sensitive notification content hidden").forEach { text ->
            assertTrue(text, ContentVisibility.isSensitiveRedactionNotice(text))
            assertEquals(text, RejectReason.HIDDEN_CONTENT, reason(snapshot(messages = listOf(msg(text, 1)))))
        }
        assertTrue(ContentVisibility.isHiddenPlaceholder("‏3 הודעות חדשות"))
        assertFalse(ContentVisibility.isSensitiveRedactionNotice("זה נושא רגיש, נדבר בטלפון"))
        assertTrue(ContentVisibility.isRedactedSnapshot(snapshot(title = "WhatsApp")))
        assertFalse(ContentVisibility.isRedactedSnapshot(snapshot()))
    }
}
