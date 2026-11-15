package ai.noa.bridge.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class BridgeCoordinatorTest {

    private val enabled = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)

    private class Harness(val c: BridgeCoordinator, val engine: FakeEngine, val sender: FakeSender) {
        val drafts: List<Draft> get() = c.drafts.value
        fun draft(id: String): Draft = drafts.single { it.id == id }
        fun only(): Draft = drafts.single()
    }

    private fun TestScope.harness(
        settings: BridgeSettings = enabled,
        engine: FakeEngine = FakeEngine(),
        sender: FakeSender = FakeSender(),
    ): Harness {
        var n = 0
        val c = BridgeCoordinator.create(
            scope = backgroundScope,
            clock = Clock { testScheduler.currentTime },
            engine = engine,
            sender = sender,
            initialSettings = settings,
            idGenerator = { "id-${++n}" },
        )
        return Harness(c, engine, sender)
    }

    private fun chat(jid: String = CONTACT_JID, vararg messages: SnapshotMessage) =
        snapshot(tag = jid, messages = messages.toList())

    /** Posts [s] and lets the 15 s debounce and the engine run. Returns the resulting draft. */
    private fun TestScope.toAwaiting(h: Harness, s: NotificationSnapshot = chat(CONTACT_JID, msg("hi", 1))): Draft {
        h.c.onNotification(s)
        advanceTimeBy(15_000); runCurrent()
        return h.drafts.single { it.conversationKey == keyOf(s) && it.state !in DraftStateMachine.terminalStates }
    }

    // ------------------------------------------------------------------ happy path

    @Test fun happyPathToSendAttempted() = runTest {
        val h = harness()
        val s = chat(CONTACT_JID, msg("hi", 1), msg("are you there?", 2))
        h.c.onNotification(s)
        assertEquals(DraftState.DEBOUNCING, h.only().state)

        advanceTimeBy(14_999); runCurrent()
        assertEquals(DraftState.DEBOUNCING, h.only().state)
        assertTrue(h.engine.requests.isEmpty())

        advanceTimeBy(1); runCurrent()
        val d = h.only()
        assertEquals(DraftState.AWAITING_APPROVAL, d.state)
        assertEquals("reply text", d.proposedText)
        assertEquals(1, h.engine.requests.size)
        val req = h.engine.requests.single()
        assertEquals(keyOf(s), req.conversationKey)
        assertEquals(listOf("hi", "are you there?"), req.messages.map { it.text })
        assertEquals("Dana", req.senderDisplayName)
        assertEquals(0, h.sender.calls.get())

        val approval = h.c.approve(d.id, "reply text")
        assertNotNull(approval)
        assertEquals(DraftState.APPROVED, h.only().state)
        assertEquals(0, h.sender.calls.get())

        assertEquals(DraftState.SEND_ATTEMPTED, h.c.sendApproved(approval!!))
        assertEquals(1, h.sender.calls.get())
        assertEquals(listOf(keyOf(s) to "reply text"), h.sender.sent)
        assertEquals("הועבר ל-WhatsApp. אין אישור מסירה", h.only().statusDetail)
        assertNull(h.only().approval)
    }

    @Test fun safetyFlagsArePropagated() = runTest {
        val flags = SafetyFlags(injectionSuspected = true, sensitiveRequest = true, notes = listOf("note"))
        val h = harness(engine = FakeEngine(DraftResult.Success("x", flags, "fake")))
        assertEquals(flags, toAwaiting(h).safety)
    }

    // ------------------------------------------------------------------ no send without approval

    @Test fun nothingIsSentWithoutApproval() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        settle()
        assertEquals(0, h.sender.calls.get())
        val forged = Approval("f".repeat(32), d.id, d.revision, d.conversationKey, Hashing.sha256Hex("reply text"), 0, Long.MAX_VALUE)
        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(forged))
        assertEquals(0, h.sender.calls.get())
        assertEquals("האישור כבר לא תקף — יש לאשר מחדש", h.only().statusDetail)
    }

    @Test fun approveRequiresExactTextAndAwaitingState() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        val debouncing = h.only()
        assertNull(h.c.approve(debouncing.id, "reply text")) // not yet a draft
        advanceTimeBy(15_000); runCurrent()
        val d = h.only()
        assertNull(h.c.approve(d.id, "reply text ")) // not exact
        assertNull(h.c.approve(d.id, ""))
        assertNull(h.c.approve("nope", "reply text"))
        assertEquals(DraftState.AWAITING_APPROVAL, h.only().state)
        assertNotNull(h.c.approve(d.id, "reply text"))
        assertNull(h.c.approve(d.id, "reply text")) // already APPROVED
    }

    @Test fun cancelNeverSends() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        h.c.cancel(d.id)
        assertEquals(DraftState.CANCELLED, h.only().state)
        assertEquals(DraftState.CANCELLED, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
        assertNull(h.c.approve(d.id, "reply text"))
    }

    @Test fun cancelWhileDebouncingNeverCallsEngine() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        h.c.cancel(h.only().id)
        settle()
        assertEquals(DraftState.CANCELLED, h.only().state)
        assertTrue(h.engine.requests.isEmpty())
    }

    @Test fun cancelWhileProcessingDropsEngineResult() = runTest {
        val engine = FakeEngine().apply { gate = CompletableDeferred() }
        val h = harness(engine = engine)
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        advanceTimeBy(15_000); runCurrent()
        assertEquals(DraftState.PROCESSING, h.only().state)
        h.c.cancel(h.only().id)
        engine.gate!!.complete(Unit)
        settle()
        assertEquals(DraftState.CANCELLED, h.only().state)
        assertNull(h.only().proposedText)
    }

    // ------------------------------------------------------------------ edit

    @Test fun editInvalidatesApprovalAndRequiresReapproval() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val old = h.c.approve(d.id, "reply text")!!
        h.c.edit(d.id, "  new text  ")
        val edited = h.only()
        assertEquals(DraftState.AWAITING_APPROVAL, edited.state)
        assertEquals("new text", edited.editedText)
        assertEquals("new text", edited.finalText)
        assertEquals(d.revision + 1, edited.revision)
        assertNull(edited.approval)

        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(old))
        assertEquals(0, h.sender.calls.get())
        assertNull(h.c.approve(d.id, "reply text")) // the old text can no longer be approved

        val fresh = h.c.approve(d.id, "new text")!!
        assertEquals(DraftState.SEND_ATTEMPTED, h.c.sendApproved(fresh))
        assertEquals(listOf("new text"), h.sender.sent.map { it.second })
    }

    @Test fun editValidation() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        h.c.edit(h.only().id, "text while debouncing")
        assertNull(h.only().editedText)
        advanceTimeBy(15_000); runCurrent()
        val d = h.only()
        h.c.edit(d.id, "   ")
        h.c.edit(d.id, "x".repeat(4_001))
        assertEquals(d, h.only())
        h.c.edit(d.id, "x".repeat(4_000))
        assertEquals(4_000, h.only().editedText!!.length)
    }

    // ------------------------------------------------------------------ approval binding

    @Test fun approvalForOtherDraftOrConversationRejected() = runTest {
        val h = harness()
        val a = toAwaiting(h, chat(CONTACT_JID, msg("hi", 1)))
        val b = toAwaiting(h, chat(OTHER_JID, msg("yo", 2)))
        val approvalA = h.c.approve(a.id, "reply text")!!
        h.c.approve(b.id, "reply text")!!
        // Re-targeted at the other (also APPROVED) draft: tampered approval is rejected.
        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(approvalA.copy(draftId = b.id)))
        assertEquals(
            DraftState.AWAITING_APPROVAL,
            h.c.sendApproved(approvalA.copy(conversationKey = b.conversationKey)),
        )
        assertEquals(0, h.sender.calls.get())
    }

    @Test fun expiredApprovalRejected() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        advanceTimeBy(2 * 60 * 1000L); runCurrent()
        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
        assertNull(h.only().approval)
    }

    @Test fun differentRevisionRejected() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(approval.copy(revision = approval.revision + 1)))
        // The presented token was burned; the genuine approval can no longer be used either.
        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
    }

    // ------------------------------------------------------------------ staleness

    @Test fun newMessageWhileAwaitingMakesDraftStale() = runTest {
        val h = harness()
        val d = toAwaiting(h, chat(CONTACT_JID, msg("hi", 1)))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1), msg("one more thing", 2)))
        val stale = h.only()
        assertEquals(d.id, stale.id)
        assertEquals(DraftState.DEBOUNCING, stale.state)
        assertEquals(d.revision + 1, stale.revision)
        assertNull(stale.proposedText)
        assertEquals(listOf("hi", "one more thing"), stale.sourceMessages.map { it.text })
        assertNull(h.c.approve(d.id, "reply text"))
        advanceTimeBy(15_000); runCurrent()
        assertEquals(DraftState.AWAITING_APPROVAL, h.only().state)
        assertEquals(listOf("hi", "one more thing"), h.engine.requests.last().messages.map { it.text })
    }

    @Test fun newMessageWhileApprovedInvalidatesApproval() = runTest {
        val h = harness()
        val d = toAwaiting(h, chat(CONTACT_JID, msg("hi", 1)))
        val approval = h.c.approve(d.id, "reply text")!!
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1), msg("wait", 2)))
        assertEquals(DraftState.DEBOUNCING, h.only().state)
        assertNull(h.only().approval)
        assertEquals(DraftState.DEBOUNCING, h.c.sendApproved(approval))
        advanceTimeBy(15_000); runCurrent()
        assertEquals(DraftState.AWAITING_APPROVAL, h.only().state)
        assertEquals(DraftState.AWAITING_APPROVAL, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
    }

    @Test fun staleEngineResultIsDiscarded() = runTest {
        val firstGate = CompletableDeferred<Unit>()
        var call = 0
        val engine = object : DraftEngineClient {
            override suspend fun requestDraft(request: DraftRequest): DraftResult {
                val n = ++call
                if (n == 1) withContext(NonCancellable) { firstGate.await() } // ignores cancellation
                return DraftResult.Success("answer $n", SafetyFlags(), "fake")
            }
        }
        var ids = 0
        val c = BridgeCoordinator.create(
            backgroundScope, Clock { testScheduler.currentTime }, engine, FakeSender(), enabled,
            idGenerator = { "id-${++ids}" },
        )
        c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        advanceTimeBy(15_000); runCurrent()
        assertEquals(DraftState.PROCESSING, c.drafts.value.single().state)
        c.onNotification(chat(CONTACT_JID, msg("hi", 1), msg("more", 2)))
        assertEquals(DraftState.DEBOUNCING, c.drafts.value.single().state)
        advanceTimeBy(15_000); runCurrent()
        assertEquals("answer 2", c.drafts.value.single().proposedText)
        firstGate.complete(Unit) // the first (stale) request finally answers
        settle()
        val d = c.drafts.value.single()
        assertEquals(DraftState.AWAITING_APPROVAL, d.state)
        assertEquals("answer 2", d.proposedText)
    }

    // ------------------------------------------------------------------ exactly once

    @Test fun sendExactlyOnceEvenIfCalledTwice() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        assertEquals(DraftState.SEND_ATTEMPTED, h.c.sendApproved(approval))
        assertEquals(DraftState.SEND_ATTEMPTED, h.c.sendApproved(approval))
        assertEquals(1, h.sender.calls.get())
        assertEquals("הועבר ל-WhatsApp. אין אישור מסירה", h.only().statusDetail)
    }

    @Test fun sendExactlyOnceUnderConcurrency() = runTest {
        val sender = FakeSender().apply { gate = CompletableDeferred() }
        val h = harness(sender = sender)
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        val results = (1..5).map { async { h.c.sendApproved(approval) } }
        runCurrent()
        assertEquals(1, sender.calls.get())
        assertEquals(DraftState.SENDING, h.only().state)
        // While SENDING nothing may touch the draft.
        h.c.cancel(d.id)
        h.c.edit(d.id, "changed")
        h.c.onNotificationRemoved(d.conversationKey)
        assertEquals(DraftState.SENDING, h.only().state)
        sender.gate!!.complete(Unit)
        settle()
        assertEquals(List(5) { DraftState.SEND_ATTEMPTED }, results.map { it.await() })
        assertEquals(1, sender.calls.get())
    }

    @Test fun sendOnRealThreadsIsExactlyOnce() {
        kotlinx.coroutines.runBlocking {
            val sender = FakeSender()
            var ids = 0
            val engine = FakeEngine()
            val scope = kotlinx.coroutines.CoroutineScope(kotlinx.coroutines.Dispatchers.Default)
            val c = BridgeCoordinator.create(
                scope, Clock.SYSTEM, engine, sender, enabled.copy(debounceMillis = 1), idGenerator = { "id-${++ids}" },
            )
            c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
            var d: Draft? = null
            repeat(200) {
                d = c.drafts.value.singleOrNull()?.takeIf { it.state == DraftState.AWAITING_APPROVAL }
                if (d == null) kotlinx.coroutines.delay(10)
            }
            val approval = c.approve(d!!.id, "reply text")!!
            val jobs = (1..16).map { scope.async { c.sendApproved(approval) } }
            jobs.forEach { it.await() }
            assertEquals(1, sender.calls.get())
            scope.coroutineContext[kotlinx.coroutines.Job]?.cancel()
        }
    }

    @Test fun unknownOutcomeIsUnknownResultWithoutRetry() = runTest {
        val h = harness(sender = FakeSender(SendOutcome.UNKNOWN))
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        assertEquals(DraftState.UNKNOWN_RESULT, h.c.sendApproved(approval))
        settle()
        assertEquals(DraftState.UNKNOWN_RESULT, h.c.sendApproved(approval))
        assertNull(h.c.approve(d.id, "reply text"))
        assertEquals(1, h.sender.calls.get())
        assertEquals("לא ידוע אם נשלח — לא תתבצע שליחה חוזרת", h.only().statusDetail)
    }

    @Test fun senderExceptionIsUnknownResult() = runTest {
        val h = harness(sender = FakeSender().apply { throwable = IllegalStateException("boom") })
        val d = toAwaiting(h)
        assertEquals(DraftState.UNKNOWN_RESULT, h.c.sendApproved(h.c.approve(d.id, "reply text")!!))
        settle()
        assertEquals(1, h.sender.calls.get())
        assertEquals(DraftState.UNKNOWN_RESULT, h.only().state)
    }

    @Test fun senderCancellationIsUnknownResultAndRethrown() = runTest {
        val h = harness(sender = FakeSender().apply { throwable = CancellationException("cancelled") })
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        var rethrown = false
        try {
            h.c.sendApproved(approval)
        } catch (e: CancellationException) {
            rethrown = true
        }
        assertTrue(rethrown)
        assertEquals(DraftState.UNKNOWN_RESULT, h.only().state)
        assertEquals(DraftState.UNKNOWN_RESULT, h.c.sendApproved(approval))
        assertEquals(1, h.sender.calls.get())
    }

    @Test fun sendJobCancelledWhileSendingIsUnknownResult() = runTest {
        val sender = object : ReplySender {
            var calls = 0
            override suspend fun send(conversationKey: ConversationKey, text: String): SendOutcome {
                calls++; awaitCancellation()
            }
        }
        var ids = 0
        val c = BridgeCoordinator.create(
            backgroundScope, Clock { testScheduler.currentTime }, FakeEngine(), sender, enabled,
            idGenerator = { "id-${++ids}" },
        )
        c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        advanceTimeBy(15_000); runCurrent()
        val approval = c.approve(c.drafts.value.single().id, "reply text")!!
        val job = launch { c.sendApproved(approval) }
        runCurrent()
        job.cancel()
        settle()
        assertEquals(DraftState.UNKNOWN_RESULT, c.drafts.value.single().state)
        assertEquals(DraftState.UNKNOWN_RESULT, c.sendApproved(approval))
        assertEquals(1, sender.calls)
    }

    @Test fun failedOutcomesMapToFailed() = runTest {
        for (outcome in listOf(SendOutcome.FAILED_NO_ACTION, SendOutcome.FAILED_CANCELED)) {
            val h = harness(sender = FakeSender(outcome))
            val d = toAwaiting(h)
            val approval = h.c.approve(d.id, "reply text")!!
            assertEquals(DraftState.FAILED, h.c.sendApproved(approval))
            assertEquals(DraftState.FAILED, h.c.sendApproved(approval))
            assertEquals(1, h.sender.calls.get())
            assertNotNull(h.only().statusDetail)
        }
    }

    @Test fun sendForUnknownDraftIsExpired() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        h.c.clearAll()
        assertTrue(h.drafts.isEmpty())
        assertEquals(DraftState.EXPIRED, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
    }

    // ------------------------------------------------------------------ settings gates

    @Test fun sendingDisabledNeverCallsSenderAndDoesNotConsume() = runTest {
        val h = harness(settings = enabled.copy(sendingEnabled = false))
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        assertEquals(DraftState.APPROVED, h.c.sendApproved(approval))
        assertEquals(DraftState.APPROVED, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
        assertEquals("השליחה הניסיונית כבויה בהגדרות", h.only().statusDetail)
        // Enabling sending later lets the same (still valid, unconsumed) approval go through once.
        h.c.updateSettings(enabled)
        assertEquals(DraftState.SEND_ATTEMPTED, h.c.sendApproved(approval))
        assertEquals(1, h.sender.calls.get())
    }

    @Test fun emergencyStopExpiresEverythingAndBlocksSending() = runTest {
        val h = harness()
        val approved = toAwaiting(h, chat(CONTACT_JID, msg("a", 1)))
        val approval = h.c.approve(approved.id, "reply text")!!
        val awaiting = toAwaiting(h, chat(OTHER_JID, msg("b", 2)))
        h.c.onNotification(chat("972500000003@s.whatsapp.net", msg("c", 3)))
        val requestsBefore = h.engine.requests.size

        h.c.emergencyStop()
        assertTrue(h.drafts.all { it.state == DraftState.EXPIRED && it.statusDetail == "עצירת חירום" })
        assertEquals(3, h.drafts.size)
        assertEquals(DraftState.EXPIRED, h.c.sendApproved(approval))
        assertNull(h.c.approve(awaiting.id, "reply text"))
        h.c.onNotification(chat("972500000004@s.whatsapp.net", msg("d", 4)))
        settle()
        assertEquals(3, h.drafts.size)
        assertEquals(requestsBefore, h.engine.requests.size)
        assertEquals(0, h.sender.calls.get())
    }

    @Test fun emergencyStopViaSettingsCancelsInFlightRequest() = runTest {
        val engine = FakeEngine().apply { gate = CompletableDeferred() }
        val h = harness(engine = engine)
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1)))
        advanceTimeBy(15_000); runCurrent()
        assertEquals(DraftState.PROCESSING, h.only().state)
        h.c.updateSettings(enabled.copy(emergencyStopped = true))
        engine.gate!!.complete(Unit)
        settle()
        assertEquals(DraftState.EXPIRED, h.only().state)
        assertNull(h.only().proposedText)
    }

    @Test fun noConsentFailsAndEngineNeverCalled() = runTest {
        val h = harness(settings = enabled.copy(cloudConsentGiven = false))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        settle()
        assertEquals(DraftState.FAILED, h.only().state)
        assertEquals("לא ניתנה הסכמה לשליחת תוכן לנועה", h.only().statusDetail)
        assertTrue(h.engine.requests.isEmpty())
    }

    @Test fun pausedProcessesNothing() = runTest {
        val h = harness(settings = enabled.copy(paused = true))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        settle()
        assertTrue(h.drafts.isEmpty())
        assertTrue(h.engine.requests.isEmpty())
    }

    @Test fun pausingWhileDebouncingExpires() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        h.c.updateSettings(enabled.copy(paused = true))
        settle()
        assertEquals(DraftState.EXPIRED, h.only().state)
        assertEquals("הגשר מושהה", h.only().statusDetail)
        assertTrue(h.engine.requests.isEmpty())
    }

    @Test fun excludingAConversationExpiresItsDraft() = runTest {
        val h = harness()
        val s = chat(CONTACT_JID, msg("hi", 1))
        h.c.onNotification(s)
        h.c.updateSettings(enabled.copy(excludedConversations = setOf(keyOf(s))))
        settle()
        assertEquals(DraftState.EXPIRED, h.only().state)
        assertTrue(h.engine.requests.isEmpty())
    }

    // ------------------------------------------------------------------ notifications

    @Test fun fromSelfExpiresActiveDraft() = runTest {
        val h = harness()
        toAwaiting(h, chat(CONTACT_JID, msg("hi", 1)))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1), msg("answered myself", 2, "Me", self = true)))
        assertEquals(DraftState.EXPIRED, h.only().state)
        assertEquals("נראה שענית ידנית — הטיוטה בוטלה", h.only().statusDetail)
        settle()
        assertEquals(0, h.sender.calls.get())
    }

    @Test fun fromSelfWhileDebouncingStopsEngineCall() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1), msg("me", 2, "Me", self = true)))
        settle()
        assertEquals(DraftState.EXPIRED, h.only().state)
        assertTrue(h.engine.requests.isEmpty())
    }

    @Test fun repostedHistoryIsDeduplicated() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("one", 1)))
        val first = h.only()
        advanceTimeBy(5_000)
        h.c.onNotification(chat(CONTACT_JID, msg("one", 1))) // identical re-post
        assertEquals(first, h.only())
        h.c.onNotification(chat(CONTACT_JID, msg("one", 1), msg("two", 2)))
        assertEquals(listOf("one", "two"), h.only().sourceMessages.map { it.text })
        assertEquals(first.revision + 1, h.only().revision)
        // The identical re-post did not restart the timer, the new message did.
        advanceTimeBy(14_999); runCurrent()
        assertEquals(DraftState.DEBOUNCING, h.only().state)
        advanceTimeBy(1); runCurrent()
        assertEquals(DraftState.AWAITING_APPROVAL, h.only().state)
        assertEquals(1, h.engine.requests.size)
        // Re-posting the same history after the draft is ready changes nothing.
        val ready = h.only()
        h.c.onNotification(chat(CONTACT_JID, msg("one", 1), msg("two", 2)))
        assertEquals(ready, h.only())
    }

    @Test fun rejectedNotificationsStoreNothing() = runTest {
        val h = harness()
        h.c.onNotification(snapshot(isGroupConversationFlag = true))
        h.c.onNotification(snapshot(tag = "1203@g.us"))
        h.c.onNotification(snapshot(packageName = "org.telegram"))
        h.c.onNotification(snapshot(isGroupSummary = true))
        h.c.onNotification(snapshot(messages = listOf(msg("2 new messages", 1))))
        h.c.onNotification(snapshot(tag = "opaque", isGroupConversationFlag = null))
        settle()
        assertTrue(h.drafts.isEmpty())
        assertTrue(h.engine.requests.isEmpty())
    }

    @Test fun twoConversationsAreIndependent() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1)))
        advanceTimeBy(10_000); runCurrent()
        h.c.onNotification(chat(OTHER_JID, msg("b", 2)))
        advanceTimeBy(5_000); runCurrent()
        val byKey = h.drafts.associateBy { it.conversationKey }
        assertEquals(DraftState.AWAITING_APPROVAL, byKey.getValue(keyOf(chat(CONTACT_JID))).state)
        assertEquals(DraftState.DEBOUNCING, byKey.getValue(keyOf(chat(OTHER_JID))).state)
        advanceTimeBy(10_000); runCurrent()
        assertTrue(h.drafts.all { it.state == DraftState.AWAITING_APPROVAL })
        assertEquals(2, h.engine.requests.size)
    }

    @Test fun notificationRemovedExpiresDraft() = runTest {
        val h = harness()
        val d = toAwaiting(h)
        val approval = h.c.approve(d.id, "reply text")!!
        h.c.onNotificationRemoved(d.conversationKey)
        assertEquals(DraftState.EXPIRED, h.only().state)
        assertEquals("ההתראה נסגרה ב-WhatsApp", h.only().statusDetail)
        assertEquals(DraftState.EXPIRED, h.c.sendApproved(approval))
        assertEquals(0, h.sender.calls.get())
    }

    @Test fun newMessageWhileSendingStartsNewDraft() = runTest {
        val sender = FakeSender().apply { gate = CompletableDeferred() }
        val h = harness(sender = sender)
        val d = toAwaiting(h, chat(CONTACT_JID, msg("hi", 1)))
        val approval = h.c.approve(d.id, "reply text")!!
        val result = async { h.c.sendApproved(approval) }
        runCurrent()
        assertEquals(DraftState.SENDING, h.draft(d.id).state)
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1), msg("new", 2)))
        assertEquals(2, h.drafts.size)
        val newer = h.drafts.single { it.id != d.id }
        assertEquals(DraftState.DEBOUNCING, newer.state)
        assertEquals(listOf("new"), newer.sourceMessages.map { it.text })
        assertEquals(DraftState.SENDING, h.draft(d.id).state)
        sender.gate!!.complete(Unit)
        assertEquals(DraftState.SEND_ATTEMPTED, result.await())
        assertEquals(DraftState.SEND_ATTEMPTED, h.draft(d.id).state)
    }

    // ------------------------------------------------------------------ engine failures

    @Test fun engineFailureIsFailedWithoutRetry() = runTest {
        val h = harness(engine = FakeEngine(DraftResult.Failure("engine_error", retryable = true)))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        settle()
        assertEquals(DraftState.FAILED, h.only().state)
        assertEquals(1, h.engine.requests.size)
        assertFalse(h.only().statusDetail!!.contains("engine_error"))
    }

    @Test fun engineExceptionIsFailed() = runTest {
        val h = harness(engine = FakeEngine().apply { throwable = RuntimeException("secret content") })
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        settle()
        assertEquals(DraftState.FAILED, h.only().state)
        assertFalse(h.only().statusDetail!!.contains("secret"))
        assertEquals(1, h.engine.requests.size)
    }

    @Test fun engineBlankTextIsFailed() = runTest {
        val h = harness(engine = FakeEngine(DraftResult.Success("   ", SafetyFlags(), "fake")))
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        settle()
        assertEquals(DraftState.FAILED, h.only().state)
    }

    @Test fun engineTimeoutAfter45s() = runTest {
        val engine = FakeEngine().apply { gate = CompletableDeferred() }
        val h = harness(engine = engine)
        h.c.onNotification(chat(CONTACT_JID, msg("hi", 1)))
        advanceTimeBy(15_000); runCurrent()
        advanceTimeBy(44_999); runCurrent()
        assertEquals(DraftState.PROCESSING, h.only().state)
        advanceTimeBy(1); runCurrent()
        assertEquals(DraftState.FAILED, h.only().state)
        engine.gate!!.complete(Unit)
        settle()
        assertEquals(DraftState.FAILED, h.only().state)
        assertEquals(1, engine.requests.size)
    }

    @Test fun engineGetsUniqueRequestIds() = runTest {
        val h = harness()
        toAwaiting(h, chat(CONTACT_JID, msg("a", 1)))
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1), msg("b", 2)))
        advanceTimeBy(15_000); runCurrent()
        assertEquals(2, h.engine.requests.map { it.requestId }.toSet().size)
    }

    // ------------------------------------------------------------------ limits, pruning, ordering

    @Test fun terminalDraftsOlderThanOneHourArePruned() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1)))
        h.c.cancel(h.only().id)
        advanceTimeBy(60 * 60 * 1000L)
        h.c.onNotification(chat(OTHER_JID, msg("b", 2)))
        assertEquals(2, h.drafts.size) // exactly one hour old is still kept
        advanceTimeBy(1)
        h.c.cancel(h.drafts.single { it.state == DraftState.DEBOUNCING }.id)
        assertEquals(1, h.drafts.size)
        assertEquals(keyOf(chat(OTHER_JID)), h.only().conversationKey)
    }

    @Test fun atMost50TerminalDraftsAreKept() = runTest {
        val h = harness()
        repeat(55) { i ->
            h.c.onNotification(chat("97250000${1000 + i}@s.whatsapp.net", msg("m$i", i.toLong())))
            advanceTimeBy(10)
            h.c.cancel(h.drafts.single { it.state == DraftState.DEBOUNCING }.id)
            advanceTimeBy(10)
        }
        assertEquals(50, h.drafts.size)
        assertTrue(h.drafts.all { it.state == DraftState.CANCELLED })
        // The newest are kept.
        assertEquals("m54", h.drafts.first().sourceMessages.single().text)
        assertEquals("m5", h.drafts.last().sourceMessages.single().text)
    }

    @Test fun atMost30ActiveDrafts() = runTest {
        val h = harness()
        repeat(31) { i -> h.c.onNotification(chat("97250000${1000 + i}@s.whatsapp.net", msg("m$i", i.toLong()))) }
        assertEquals(30, h.drafts.size)
        // An existing conversation still gets its new messages.
        h.c.onNotification(chat("972500001000@s.whatsapp.net", msg("m0", 0), msg("more", 100)))
        assertEquals(30, h.drafts.size)
        // After one finishes, the 31st conversation can be picked up on its next re-post.
        h.c.cancel(h.drafts.first().id)
        h.c.onNotification(chat("972500001030@s.whatsapp.net", msg("m30", 30)))
        assertEquals(31, h.drafts.size)
    }

    @Test fun draftsAreSortedByUpdatedAtDescending() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1)))
        advanceTimeBy(100)
        h.c.onNotification(chat(OTHER_JID, msg("b", 2)))
        assertEquals(keyOf(chat(OTHER_JID)), h.drafts.first().conversationKey)
        advanceTimeBy(100)
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1), msg("c", 3)))
        assertEquals(keyOf(chat(CONTACT_JID)), h.drafts.first().conversationKey)
        val times = h.drafts.map { it.updatedAtMillis }
        assertEquals(times.sortedDescending(), times)
    }

    @Test fun clearAllRemovesEverythingAndForgetsDedup() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1)))
        h.c.clearAll()
        settle()
        assertTrue(h.drafts.isEmpty())
        assertTrue(h.engine.requests.isEmpty())
        h.c.onNotification(chat(CONTACT_JID, msg("a", 1)))
        assertEquals(1, h.drafts.size)
    }

    @Test fun sourceMessagesCappedAt20() = runTest {
        val h = harness()
        h.c.onNotification(chat(CONTACT_JID, *(1..15).map { msg("m$it", it.toLong()) }.toTypedArray()))
        h.c.onNotification(chat(CONTACT_JID, *(1..30).map { msg("m$it", it.toLong()) }.toTypedArray()))
        val texts = h.only().sourceMessages.map { it.text }
        assertEquals(20, texts.size)
        assertEquals("m30", texts.last())
    }
}
