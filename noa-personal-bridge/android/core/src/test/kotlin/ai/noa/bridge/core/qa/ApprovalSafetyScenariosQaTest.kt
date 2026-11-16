package ai.noa.bridge.core.qa

import ai.noa.bridge.core.Approval
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.Clock
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.DraftStateMachine
import ai.noa.bridge.core.Hashing
import ai.noa.bridge.core.SendOutcome
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QA traceability: spec section 13.2 (approval). Every test ends by asserting the only thing that
 * matters for safety: how many times, to which conversation and with which exact text the
 * [ai.noa.bridge.core.ReplySender] was called.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ApprovalSafetyScenariosQaTest {

    private val dana = keyOfJid(JID_DANA)
    private val yossi = keyOfJid(JID_YOSSI)
    private fun hi(ts: Long = 1_000) = wa(listOf(line("היי", ts)))

    // ------------------------------------------------------------------ no send without approval

    @Test fun approval_noApproval_nothingIsEverSent() = runTest {
        val b = QaBridge(this)
        b.post(hi())
        b.advance(DEBOUNCE)
        assertEquals(DraftState.AWAITING_APPROVAL, b.activeOf(dana).state)
        b.advance(24 * 60 * 60 * 1000L)
        assertEquals(0, b.sender.calls.get())
    }

    @Test fun approval_forgedOrTamperedApprovalNeverSends() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val text = d.finalText!!
        // A forged approval carrying every correct field but a guessed token.
        val forged = Approval(
            token = "0".repeat(32),
            draftId = d.id,
            revision = d.revision,
            conversationKey = d.conversationKey,
            textSha256 = Hashing.sha256Hex(text),
            issuedAtMillis = testScheduler.currentTime,
            expiresAtMillis = Long.MAX_VALUE,
        )
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(forged))
        assertEquals(0, b.sender.calls.get())

        // A real token whose expiry was extended by the caller is rejected and burnt (fail closed).
        val real = b.coordinator.approve(d.id, text)!!
        val tampered = real.copy(expiresAtMillis = real.expiresAtMillis + 3_600_000)
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(tampered))
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(real))
        assertEquals(0, b.sender.calls.get())
    }

    @Test fun approval_cannotApproveBeforeTheDraftIsShown() = runTest {
        val engine = RecordingEngine().apply { gate = CompletableDeferred() }
        val b = QaBridge(this, engine = engine)
        b.post(hi())
        val debouncing = b.activeOf(dana)
        assertNull(b.coordinator.approve(debouncing.id, "כל טקסט"))
        b.advance(DEBOUNCE)
        assertEquals(DraftState.PROCESSING, b.activeOf(dana).state)
        assertNull(b.coordinator.approve(debouncing.id, "כל טקסט"))
        assertNull(b.coordinator.approve(debouncing.id, ""))
        assertEquals(0, b.sender.calls.get())
    }

    // ------------------------------------------------------------------ cancel sends nothing

    @Test fun approval_cancelInEveryCancellableStateSendsNothing() = runTest {
        val b = QaBridge(this)

        b.post(hi(1_000))
        val debouncing = b.activeOf(dana)
        b.coordinator.cancel(debouncing.id)
        b.advance(DEBOUNCE)
        assertEquals(DraftState.CANCELLED, b.byId(debouncing.id).state)
        assertTrue("cancel while debouncing must not call the engine", b.engine.requests.isEmpty())

        val awaiting = b.awaiting(wa(listOf(line("שוב", 50_000))))
        b.coordinator.cancel(awaiting.id)
        assertEquals(DraftState.CANCELLED, b.byId(awaiting.id).state)

        val approved = b.awaiting(wa(listOf(line("ושוב", 90_000))))
        val approval = b.coordinator.approve(approved.id, approved.finalText!!)!!
        b.coordinator.cancel(approved.id)
        assertEquals(DraftState.CANCELLED, b.coordinator.sendApproved(approval))
        assertNull(b.coordinator.approve(approved.id, approved.finalText!!))
        b.coordinator.edit(approved.id, "ניסיון להחיות טיוטה מבוטלת")
        assertEquals(DraftState.CANCELLED, b.byId(approved.id).state)

        assertEquals(0, b.sender.calls.get())
    }

    @Test fun approval_cancelWhileSendingCannotStopOrDuplicateTheSingleAttempt() = runTest {
        val sender = RecordingSender().apply { gate = CompletableDeferred() }
        val b = QaBridge(this, sender = sender)
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        val send = async { b.coordinator.sendApproved(approval) }
        runCurrent()
        assertEquals(DraftState.SENDING, b.byId(d.id).state)
        b.coordinator.cancel(d.id)
        assertEquals(DraftState.SENDING, b.byId(d.id).state)
        sender.gate!!.complete(Unit)
        assertEquals(DraftState.SEND_ATTEMPTED, send.await())
        assertEquals(1, sender.calls.get())
    }

    // ------------------------------------------------------------------ edit requires approval

    @Test fun approval_editRequiresFreshApproval_andExactlyTheEditedTextIsSent() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val original = d.finalText!!
        val first = b.coordinator.approve(d.id, original)!!

        val edited = "אהלן! נשמע טוב, נדבר בערב 🙂"
        b.coordinator.edit(d.id, edited)
        val afterEdit = b.byId(d.id)
        assertEquals(DraftState.AWAITING_APPROVAL, afterEdit.state)
        assertEquals(d.revision + 1, afterEdit.revision)
        assertNull(afterEdit.approval)

        // The approval of the pre-edit text is dead, and the old text can no longer be approved.
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(first))
        assertNull(b.coordinator.approve(d.id, original))
        assertEquals(0, b.sender.calls.get())

        val second = b.coordinator.approve(d.id, edited)!!
        assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(second))
        assertEquals(listOf(dana to edited), b.sender.sent)
    }

    @Test fun approval_onlyTheExactDisplayedTextCanBeApproved() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val text = d.finalText!!
        listOf(
            "$text ",                // trailing space
            " $text",                // leading space
            "‏$text",           // invisible RTL mark
            text.replace("ל", "לְ"), // niqqud added
            text.uppercase() + "!",  // any other change
        ).forEach { variant -> assertNull("must refuse: [$variant]", b.coordinator.approve(d.id, variant)) }
        assertEquals(DraftState.AWAITING_APPROVAL, b.byId(d.id).state)
        assertNotNull(b.coordinator.approve(d.id, text))
    }

    @Test fun approval_editWithBlankOrOversizedTextIsIgnored() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        b.coordinator.edit(d.id, "   ")
        b.coordinator.edit(d.id, "א".repeat(4_001))
        assertEquals(d, b.byId(d.id))
    }

    // ------------------------------------------------------------------ old approval invalid

    @Test fun approval_ttlBoundary_validUntil119999ms_invalidAt120000ms() = runTest {
        val b = QaBridge(this)
        val a = b.awaiting(hi())
        val y = b.awaiting(wa(listOf(line("שלום", 1_000, sender = "יוסי")), jid = JID_YOSSI, title = "יוסי"))
        val approvalA = b.coordinator.approve(a.id, a.finalText!!)!!
        val approvalY = b.coordinator.approve(y.id, y.finalText!!)!!
        assertEquals(120_000L, approvalA.expiresAtMillis - approvalA.issuedAtMillis)

        b.advance(119_999)
        assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(approvalA))
        b.advance(1)
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(approvalY))
        assertEquals(listOf(dana), b.sender.sent.map { it.first })
    }

    @Test fun approval_reApprovalIssuesNewToken_oldTokenNeverWorks() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val old = b.coordinator.approve(d.id, d.finalText!!)!!
        b.coordinator.edit(d.id, "גרסה 2")
        val fresh = b.coordinator.approve(d.id, "גרסה 2")!!
        assertTrue(old.token != fresh.token)
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(old))
        // presenting the stale token moved the draft back to AWAITING_APPROVAL; the fresh one is now stale too
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(fresh))
        assertEquals(0, b.sender.calls.get())
        val third = b.coordinator.approve(d.id, "גרסה 2")!!
        assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(third))
        assertEquals(listOf(dana to "גרסה 2"), b.sender.sent)
    }

    @Test fun approval_pauseOrEmergencyStopVoidsOutstandingApprovals() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        b.coordinator.updateSettings(READY.copy(paused = true))
        b.coordinator.updateSettings(READY)
        assertEquals(DraftState.EXPIRED, b.coordinator.sendApproved(approval))

        val d2 = b.awaiting(wa(listOf(line("שוב", 60_000))))
        val approval2 = b.coordinator.approve(d2.id, d2.finalText!!)!!
        b.coordinator.emergencyStop()
        b.coordinator.updateSettings(READY) // even if someone flips everything back on
        assertEquals(DraftState.EXPIRED, b.coordinator.sendApproved(approval2))
        assertEquals(0, b.sender.calls.get())
    }

    // ------------------------------------------------------------------ new message cancels old draft

    @Test fun approval_newMessageWhileApproved_cancelsDraftAndApproval_oldTextNeverSent() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val oldText = d.finalText!!
        val approval = b.coordinator.approve(d.id, oldText)!!

        b.post(wa(listOf(line("היי", 1_000), line("רגע, שיניתי תוכנית", 40_000))))
        val stale = b.activeOf(dana)
        assertEquals(DraftState.DEBOUNCING, stale.state)
        assertNull(stale.approval)
        assertEquals(DraftState.DEBOUNCING, b.coordinator.sendApproved(approval))

        b.advance(DEBOUNCE)
        val fresh = b.activeOf(dana)
        assertTrue(fresh.finalText != oldText)
        assertNull(b.coordinator.approve(fresh.id, oldText))
        assertEquals(0, b.sender.calls.get())
    }

    @Test fun approval_newMessageWhileEngineRunning_lateResultIsDiscarded() = runTest {
        val engine = RecordingEngine().apply { gate = CompletableDeferred() }
        engine.responder = { r -> ai.noa.bridge.core.DraftResult.Success("ל-" + r.messages.size, ai.noa.bridge.core.SafetyFlags(), "f") }
        val b = QaBridge(this, engine = engine)
        b.post(hi())
        b.advance(DEBOUNCE)
        assertEquals(DraftState.PROCESSING, b.activeOf(dana).state)

        b.post(wa(listOf(line("היי", 1_000), line("ועוד דבר", 20_000))))
        val firstGate = engine.gate!!
        engine.gate = null
        firstGate.complete(Unit)
        b.advance(1)
        assertEquals(DraftState.DEBOUNCING, b.activeOf(dana).state)
        assertNull(b.activeOf(dana).proposedText)

        b.advance(DEBOUNCE)
        assertEquals("ל-2", b.activeOf(dana).proposedText)
    }

    // ------------------------------------------------------------------ no double send

    @Test fun approval_noDoubleSend_sequentialRepeats() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        repeat(10) { b.coordinator.sendApproved(approval) }
        assertEquals(1, b.sender.calls.get())
        assertNull("a sent draft cannot be approved again", b.coordinator.approve(d.id, d.finalText!!))
    }

    @Test fun approval_noDoubleSend_100ConcurrentCallers() = runTest {
        val sender = RecordingSender().apply { gate = CompletableDeferred() }
        val b = QaBridge(this, sender = sender)
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        val results = (1..100).map { async { b.coordinator.sendApproved(approval) } }
        runCurrent()
        sender.gate!!.complete(Unit)
        val states = results.awaitAll()
        assertEquals(1, sender.calls.get())
        assertTrue(states.all { it == DraftState.SEND_ATTEMPTED })
    }

    @Test fun approval_noDoubleSend_realThreadsWithApproveAndSendRacing() {
        runBlocking {
            val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
            try {
                repeat(20) { round ->
                    val sender = RecordingSender()
                    val engine = RecordingEngine()
                    var n = 0
                    val c = BridgeCoordinator.create(
                        scope, Clock.SYSTEM, engine, sender, READY.copy(debounceMillis = 1), idGenerator = { "r$round-${++n}" },
                    )
                    c.onNotification(hi())
                    var draftId: String? = null
                    repeat(500) {
                        if (draftId == null) {
                            draftId = c.drafts.value.singleOrNull { it.state == DraftState.AWAITING_APPROVAL }?.id
                            if (draftId == null) delay(2)
                        }
                    }
                    val text = c.drafts.value.single().finalText!!
                    val approval = c.approve(draftId!!, text)!!
                    val jobs = (1..32).map { i ->
                        scope.async {
                            when (i % 4) {
                                0 -> c.approve(draftId!!, text) // concurrent re-approve attempts
                                else -> c.sendApproved(approval)
                            }
                        }
                    }
                    jobs.awaitAll()
                    assertEquals("round $round", 1, sender.calls.get())
                }
            } finally {
                scope.cancel()
            }
        }
    }

    @Test fun approval_noDoubleSend_failedAttemptIsNeverRetriedAutomatically() = runTest {
        val b = QaBridge(this, sender = RecordingSender(SendOutcome.FAILED_CANCELED))
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        assertEquals(DraftState.FAILED, b.coordinator.sendApproved(approval))
        b.advance(60 * 60 * 1000L)
        assertEquals(DraftState.FAILED, b.coordinator.sendApproved(approval))
        assertEquals(1, b.sender.calls.get())
    }

    // ------------------------------------------------------------------ no send to another conversation

    @Test fun approval_neverSendsToAnotherConversation() = runTest {
        val b = QaBridge(this)
        val a = b.awaiting(hi())
        val y = b.awaiting(wa(listOf(line("שלום", 1_000, sender = "יוסי")), jid = JID_YOSSI, title = "יוסי"))
        val approvalA = b.coordinator.approve(a.id, a.finalText!!)!!

        // Re-targeting a real approval at Yossi's draft or conversation is rejected (and burns the token).
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(approvalA.copy(draftId = y.id)))
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(approvalA.copy(conversationKey = yossi)))
        assertEquals(DraftState.AWAITING_APPROVAL, b.coordinator.sendApproved(approvalA))
        assertEquals(0, b.sender.calls.get())

        // Legit sends: the sender only ever receives the approved draft's own conversation key.
        val a2 = b.coordinator.approve(a.id, a.finalText!!)!!
        val y2 = b.coordinator.approve(y.id, y.finalText!!)!!
        assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(y2))
        assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(a2))
        assertEquals(listOf(yossi to y.finalText!!, dana to a.finalText!!), b.sender.sent)
    }

    @Test fun approval_manyConversations_eachSendGoesToItsOwnKeyWithItsOwnText() = runTest {
        val b = QaBridge(this)
        val jids = (0 until 12).map { "97250000%04d@s.whatsapp.net".format(it) }
        val drafts = jids.mapIndexed { i, jid ->
            b.post(wa(listOf(line("הודעה $i", 1_000L + i, sender = "איש $i")), jid = jid, title = "איש $i"))
            jid
        }.also { b.advance(DEBOUNCE) }
            .map { jid -> b.activeOf(keyOfJid(jid)) }
        drafts.shuffled(java.util.Random(7)).forEach { d ->
            val approval = b.coordinator.approve(d.id, d.finalText!!)!!
            assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(approval))
        }
        assertEquals(drafts.size, b.sender.calls.get())
        val expected = drafts.associate { it.conversationKey to it.finalText!! }
        b.sender.sent.forEach { (key, text) -> assertEquals(expected.getValue(key), text) }
        assertEquals(expected.keys, b.sender.sent.map { it.first }.toSet())
    }

    // ------------------------------------------------------------------ unknown result → no retry

    @Test fun approval_unknownResult_noRetryNoReapprovalNoResendOnNextMessage() = runTest {
        val sender = RecordingSender(SendOutcome.UNKNOWN)
        val b = QaBridge(this, sender = sender)
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        assertEquals(DraftState.UNKNOWN_RESULT, b.coordinator.sendApproved(approval))
        assertEquals("לא ידוע אם נשלח — לא תתבצע שליחה חוזרת", b.byId(d.id).statusDetail)

        assertEquals(DraftState.UNKNOWN_RESULT, b.coordinator.sendApproved(approval))
        assertNull(b.coordinator.approve(d.id, d.finalText!!))
        b.coordinator.edit(d.id, "שינוי")
        assertEquals(DraftState.UNKNOWN_RESULT, b.byId(d.id).state)
        assertTrue(DraftState.UNKNOWN_RESULT in DraftStateMachine.terminalStates)

        // The next incoming message starts a NEW draft; nothing is re-sent on its own.
        b.post(wa(listOf(line("היי", 1_000), line("קיבלת?", 30_000))))
        b.advance(DEBOUNCE + 60_000)
        assertTrue(b.activeOf(dana).id != d.id)
        assertEquals(1, sender.calls.get())
    }

    @Test fun approval_unknownResult_whenSendIsCancelledMidway() = runTest {
        val sender = RecordingSender().apply { gate = CompletableDeferred() }
        val b = QaBridge(this, sender = sender)
        val d = b.awaiting(hi())
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        val job = launch {
            try {
                b.coordinator.sendApproved(approval)
            } catch (_: CancellationException) {
            }
        }
        runCurrent()
        job.cancel()
        runCurrent()
        assertEquals(DraftState.UNKNOWN_RESULT, b.byId(d.id).state)
        assertEquals(DraftState.UNKNOWN_RESULT, b.coordinator.sendApproved(approval))
        assertEquals(1, sender.calls.get())
    }
}
