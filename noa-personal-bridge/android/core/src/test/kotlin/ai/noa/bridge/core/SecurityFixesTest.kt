package ai.noa.bridge.core

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Regression tests for the security review (docs/noa-personal-bridge/SECURITY.md, "Fix status"):
 * S-M1 (hidden update), S-L7 (retention + dedup seeding) and PERF-04 (dedup purge).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SecurityFixesTest {
    private val enabled = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)

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

    private fun TestScope.advance(ms: Long) {
        advanceTimeBy(ms); runCurrent()
    }

    // ------------------------------------------------------------------ S-M1

    @Test
    fun sM1_redactedUpdateExpiresTheAwaitingDraftWithAnExplanation() = runTest {
        val sender = FakeSender()
        val c = coordinator(sender = sender)
        c.onNotification(snapshot(messages = listOf(msg("when do we meet?", 1))))
        debounce()
        val d = c.drafts.value.single()
        assertEquals(DraftState.AWAITING_APPROVAL, d.state)

        // Android 15 redacts the update: app label as title, fixed notice as text.
        c.onNotification(snapshot(title = "WhatsApp", messages = listOf(msg("Sensitive notification content hidden", 2, sender = "WhatsApp"))))

        val after = c.drafts.value.single { it.id == d.id }
        assertEquals(DraftState.EXPIRED, after.state)
        assertEquals("התקבלה הודעה שלא ניתן לקרוא — הטיוטה בוטלה", after.statusDetail)
        assertNull("the old approval path is gone", c.approve(d.id, d.finalText!!))
        assertEquals(0, sender.calls.get())
    }

    @Test
    fun sM1_placeholderUpdateExpiresAnApprovedDraftAndItCanNoLongerBeSent() = runTest {
        val sender = FakeSender()
        val c = coordinator(sender = sender)
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        val approval = c.approve(d.id, d.finalText!!)!!

        c.onNotification(snapshot(messages = listOf(msg("2 new messages", 2))))

        assertEquals(DraftState.EXPIRED, c.drafts.value.single { it.id == d.id }.state)
        assertEquals(DraftState.EXPIRED, c.sendApproved(approval))
        assertEquals(0, sender.calls.get())
    }

    @Test
    fun sM1_hiddenUpdateNeverTouchesADraftThatIsSending() = runTest {
        val sender = FakeSender().apply { gate = kotlinx.coroutines.CompletableDeferred() }
        val c = coordinator(sender = sender)
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        val d = c.drafts.value.single()
        val approval = c.approve(d.id, d.finalText!!)!!
        val send = backgroundScope.async { c.sendApproved(approval) }
        runCurrent()
        assertEquals(DraftState.SENDING, c.drafts.value.single().state)

        c.onNotification(snapshot(messages = listOf(msg("2 new messages", 2))))
        assertEquals(DraftState.SENDING, c.drafts.value.single().state)

        sender.gate!!.complete(Unit)
        assertEquals(DraftState.SEND_ATTEMPTED, send.await())
    }

    @Test
    fun sM1_hiddenUpdateOfAnotherConversationLeavesThisDraftAlone() = runTest {
        val c = coordinator()
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        c.onNotification(snapshot(tag = OTHER_JID, messages = listOf(msg("2 new messages", 2))))
        assertEquals(DraftState.AWAITING_APPROVAL, c.drafts.value.single().state)
    }

    // ------------------------------------------------------------------ S-L7 retention

    @Test
    fun sL7_terminalDraftLosesItsContentAfterTenMinutesButKeepsItsMetadata() = runTest {
        val c = coordinator()
        c.onNotification(snapshot(messages = listOf(msg("my secret question", 1))))
        debounce()
        val d = c.drafts.value.single()
        c.edit(d.id, "my edited answer")
        c.cancel(d.id)
        val cancelled = c.drafts.value.single()
        assertEquals(DraftState.CANCELLED, cancelled.state)
        assertTrue(cancelled.sourceMessages.isNotEmpty())

        advance(9 * 60_000L)
        assertTrue("still within 10 minutes", c.drafts.value.single().sourceMessages.isNotEmpty())

        advance(61_000L) // no other mutation: the janitor applies the deadline on its own
        val scrubbed = c.drafts.value.single()
        assertEquals(DraftState.CANCELLED, scrubbed.state)
        assertEquals(cancelled.id, scrubbed.id)
        assertEquals(cancelled.senderDisplayName, scrubbed.senderDisplayName)
        assertEquals(cancelled.updatedAtMillis, scrubbed.updatedAtMillis)
        assertTrue(scrubbed.sourceMessages.isEmpty())
        assertNull(scrubbed.proposedText)
        assertNull(scrubbed.editedText)
    }

    @Test
    fun sL7_statusDetailSurvivesScrubbingAndTheDraftIsDroppedAfterAnHour() = runTest {
        val c = coordinator()
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        c.onNotification(snapshot(messages = listOf(msg("hi", 1), msg("bye", 2, sender = "Me", self = true))))
        val expired = c.drafts.value.single()
        assertEquals(DraftState.EXPIRED, expired.state)

        advance(10 * 60_000L + 1)
        val scrubbed = c.drafts.value.single()
        assertEquals(expired.statusDetail, scrubbed.statusDetail)
        assertTrue(scrubbed.sourceMessages.isEmpty())

        advance(60 * 60_000L)
        assertTrue("dropped after one hour", c.drafts.value.isEmpty())
    }

    @Test
    fun sL7_activeDraftsAreNeverScrubbed() = runTest {
        val c = coordinator()
        c.onNotification(snapshot(messages = listOf(msg("hi", 1))))
        debounce()
        advance(30 * 60_000L)
        val d = c.drafts.value.single()
        assertEquals(DraftState.AWAITING_APPROVAL, d.state)
        assertEquals(listOf("hi"), d.sourceMessages.map { it.text })
        assertNotNull(d.proposedText)
    }

    // ------------------------------------------------------------------ S-L7 dedup seeding

    @Test
    fun sL7_seededLinesAreNotSentAgainAfterARestartOnlyTheNewLineIs() = runTest {
        val engine = FakeEngine()
        val c = coordinator(engine = engine) // a fresh process: empty dedup
        val old = listOf(msg("unread from before the restart", 1), msg("second old line", 2))
        c.seedSeen(listOf(snapshot(messages = old)))
        assertTrue("seeding creates no draft", c.drafts.value.isEmpty())

        // WhatsApp re-posts the conversation with one new line.
        c.onNotification(snapshot(messages = old + msg("new line", 3)))
        debounce()
        assertEquals(listOf("new line"), engine.requests.single().messages.map { it.text })
    }

    @Test
    fun sL7_repostOfOnlySeededLinesCreatesNoDraftAndNoRequest() = runTest {
        val engine = FakeEngine()
        val c = coordinator(engine = engine)
        val old = snapshot(messages = listOf(msg("old", 1)))
        c.seedSeen(listOf(old))
        c.onNotification(old)
        debounce()
        assertTrue(c.drafts.value.isEmpty())
        assertTrue(engine.requests.isEmpty())
    }

    @Test
    fun sL7_seedingIgnoresSnapshotsWithoutAStableKey() = runTest {
        val c = coordinator()
        c.seedSeen(listOf(snapshot(tag = null, shortcutId = null)))
        c.onNotification(snapshot(messages = listOf(msg("hi", 1_000))))
        assertEquals(1, c.drafts.value.size)
    }

    // ------------------------------------------------------------------ PERF-04

    @Test
    fun perf04_purgeStopsAtTheFirstLiveEntryAndStillExpiresOldOnes() {
        var now = 0L
        val dedup = LruDeduplicator(Clock { now }, capacity = 10, ttlMillis = 100)
        dedup.checkAndRecord("a") // t=0
        now = 50
        dedup.checkAndRecord("b") // t=50
        now = 60
        assertTrue("a refreshed", dedup.checkAndRecord("a")) // a moves behind b (t=60)
        now = 155 // b expired (105 > ... 155-50=105 >= 100), a alive (95)
        assertFalse("b expired", dedup.checkAndRecord("b"))
        assertTrue("a alive", dedup.checkAndRecord("a"))
        assertEquals(2, dedup.size())
    }
}
