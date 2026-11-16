package ai.noa.bridge.core.qa

import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.SafetyFlags
import ai.noa.bridge.core.SendOutcome
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * QA traceability: spec section 13.1 (Android scenarios) at the domain level — the full
 * notification → filter → dedup → debounce → engine → draft pipeline of the real
 * [ai.noa.bridge.core.BridgeCoordinator], on virtual time. Platform-level counterparts live in
 * app/src/test/.../app/qa.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AndroidFlowScenariosQaTest {

    private val dana = keyOfJid(JID_DANA)
    private val yossi = keyOfJid(JID_YOSSI)

    // ------------------------------------------------------------------ 13.1 single message

    @Test fun scenario_singleMessage_oneDraftOneRequestNothingSent() = runTest {
        val b = QaBridge(this)
        b.post(wa(listOf(line("היי, מתי נפגשים?", 1_000))))

        val d = b.activeOf(dana)
        assertEquals(DraftState.DEBOUNCING, d.state)
        assertTrue(b.engine.requests.isEmpty())

        b.advance(DEBOUNCE)
        val ready = b.activeOf(dana)
        assertEquals(DraftState.AWAITING_APPROVAL, ready.state)
        assertEquals("תשובה ל-היי, מתי נפגשים?", ready.proposedText)
        assertEquals(1, b.engine.requests.size)
        assertEquals(listOf("היי, מתי נפגשים?"), b.engine.requests.single().messages.map { it.text })
        assertEquals("דנה", b.engine.requests.single().senderDisplayName)

        b.advance(60 * 60 * 1000L) // an hour of no user action
        assertEquals(0, b.sender.calls.get())
        assertEquals(1, b.engine.requests.size)
    }

    // ------------------------------------------------------------------ 13.1 several consecutive messages

    @Test fun scenario_consecutiveMessages_batchedIntoOneRequest_timerRestartsOnEach() = runTest {
        val b = QaBridge(this)
        val m1 = line("היי", 1_000)
        val m2 = line("את פנויה מחר?", 2_000)
        val m3 = line("בערב, אחרי 8", 3_000)

        // WhatsApp re-posts the conversation notification with the full unread history each time.
        b.post(wa(listOf(m1)))
        b.advance(10_000)
        b.post(wa(listOf(m1, m2)))
        b.advance(10_000)
        b.post(wa(listOf(m1, m2, m3)))

        b.advance(DEBOUNCE - 1)
        assertTrue("no request before 15 s of silence", b.engine.requests.isEmpty())
        assertEquals(DraftState.DEBOUNCING, b.activeOf(dana).state)

        b.advance(1)
        assertEquals(1, b.engine.requests.size)
        assertEquals(listOf("היי", "את פנויה מחר?", "בערב, אחרי 8"), b.engine.requests.single().messages.map { it.text })
        assertEquals(1, b.drafts.size) // one draft for the whole burst
        assertEquals(DraftState.AWAITING_APPROVAL, b.activeOf(dana).state)
    }

    // ------------------------------------------------------------------ 13.1 two conversations in parallel

    @Test fun scenario_twoConversationsInParallel_independentTimersDraftsAndSends() = runTest {
        val b = QaBridge(this)
        b.post(wa(listOf(line("היי מדנה", 1_000))))
        b.advance(5_000)
        b.post(wa(listOf(line("היי מיוסי", 6_000, sender = "יוסי")), jid = JID_YOSSI, title = "יוסי"))

        b.advance(DEBOUNCE - 5_000) // t = 15 s: only Dana's window elapsed
        assertEquals(1, b.engine.requests.size)
        assertEquals(dana, b.engine.requests[0].conversationKey)
        assertEquals(DraftState.AWAITING_APPROVAL, b.activeOf(dana).state)
        assertEquals(DraftState.DEBOUNCING, b.activeOf(yossi).state)

        b.advance(5_000) // t = 20 s
        assertEquals(2, b.engine.requests.size)
        assertEquals(yossi, b.engine.requests[1].conversationKey)
        assertEquals(listOf("היי מיוסי"), b.engine.requests[1].messages.map { it.text })

        // Approving and sending Dana's draft touches nothing of Yossi's.
        val dDana = b.activeOf(dana)
        val yBefore = b.activeOf(yossi)
        val approval = b.coordinator.approve(dDana.id, dDana.finalText!!)!!
        assertEquals(DraftState.SEND_ATTEMPTED, b.coordinator.sendApproved(approval))
        assertEquals(listOf(dana to "תשובה ל-היי מדנה"), b.sender.sent)
        assertEquals(yBefore, b.activeOf(yossi))
    }

    @Test fun scenario_parallel_interleavedBurstsNeverLeakAcrossConversations() = runTest {
        val b = QaBridge(this)
        val danaLines = mutableListOf<ai.noa.bridge.core.SnapshotMessage>()
        val yossiLines = mutableListOf<ai.noa.bridge.core.SnapshotMessage>()
        repeat(6) { i ->
            danaLines += line("דנה-$i", 1_000L + i * 10)
            yossiLines += line("יוסי-$i", 1_005L + i * 10, sender = "יוסי")
            b.post(wa(danaLines.toList()))
            b.post(wa(yossiLines.toList(), jid = JID_YOSSI, title = "יוסי"))
            b.advance(1_000)
        }
        b.advance(DEBOUNCE)
        assertEquals(2, b.engine.requests.size)
        val byKey = b.engine.requests.associateBy { it.conversationKey }
        assertEquals((0 until 6).map { "דנה-$it" }, byKey.getValue(dana).messages.map { it.text })
        assertEquals((0 until 6).map { "יוסי-$it" }, byKey.getValue(yossi).messages.map { it.text })
        assertEquals("יוסי", byKey.getValue(yossi).senderDisplayName)
        assertNotEquals(byKey.getValue(dana).requestId, byKey.getValue(yossi).requestId)
    }

    // ------------------------------------------------------------------ 13.1 group message

    @Test fun scenario_groupMessage_neverDraftedNeverReachesEngine_inAnyShape() = runTest {
        val b = QaBridge(this)
        val groupShapes = listOf(
            // explicit MessagingStyle group flag
            wa(listOf(line("מי מגיע?", 1_000)), jid = JID_GROUP, title = "משפחה", conversationTitle = "משפחה", groupFlag = true),
            // group JID only (flag absent)
            wa(listOf(line("מי מגיע?", 1_000)), jid = JID_GROUP, title = "משפחה", groupFlag = null),
            // several distinct senders in one notification, no flag, private-looking JID
            wa(listOf(line("א", 1_000, sender = "דנה"), line("ב", 1_001, sender = "יוסי")), groupFlag = null),
            // conversation title differs from sender title ("משפחה" vs "דנה")
            wa(listOf(line("היי", 1_000)), conversationTitle = "משפחה", groupFlag = null),
            // bundle header
            wa(listOf(line("3 הודעות חדשות", 1_000)), groupSummary = true),
            // no classification signal at all → fail closed (UNKNOWN is treated like a group)
            wa(listOf(line("היי", 1_000)), jid = null, shortcutId = null, groupFlag = null),
        )
        groupShapes.forEach(b::post)
        b.advance(DEBOUNCE * 2)
        assertTrue(b.drafts.isEmpty())
        assertTrue(b.engine.requests.isEmpty())
        assertEquals(0, b.sender.calls.get())
    }

    @Test fun scenario_groupMessage_doesNotDisturbAnActivePrivateDraft() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(wa(listOf(line("היי", 1_000))))
        b.post(wa(listOf(line("מי מגיע?", 2_000)), jid = JID_GROUP, title = "משפחה", conversationTitle = "משפחה", groupFlag = true))
        b.advance(DEBOUNCE)
        assertEquals(d, b.activeOf(dana))
        assertEquals(1, b.drafts.size)
        assertEquals(1, b.engine.requests.size)
    }

    // ------------------------------------------------------------------ 13.1 excluded conversation

    @Test fun scenario_excludedConversation_ignoredWhileOthersContinue() = runTest {
        val b = QaBridge(this, READY.copy(excludedConversations = setOf(dana)))
        b.post(wa(listOf(line("היי", 1_000))))
        b.post(wa(listOf(line("שלום", 1_000, sender = "יוסי")), jid = JID_YOSSI, title = "יוסי"))
        b.advance(DEBOUNCE)
        assertNull(b.activeOrNull(dana))
        assertTrue(b.drafts.none { it.conversationKey == dana })
        assertEquals(listOf(yossi), b.engine.requests.map { it.conversationKey })
    }

    @Test fun scenario_excludingMidFlight_expiresDraftAndVoidsItsApproval() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(wa(listOf(line("היי", 1_000))))
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!

        b.coordinator.updateSettings(READY.copy(excludedConversations = setOf(dana)))
        assertEquals(DraftState.EXPIRED, b.byId(d.id).state)
        assertEquals(DraftState.EXPIRED, b.coordinator.sendApproved(approval))
        assertEquals(0, b.sender.calls.get())

        // Later messages of that chat are ignored entirely.
        b.post(wa(listOf(line("היי", 1_000), line("את שם?", 9_000))))
        b.advance(DEBOUNCE)
        assertNull(b.activeOrNull(dana))
        assertEquals(1, b.engine.requests.size)
    }

    // ------------------------------------------------------------------ 13.1 missing notification

    @Test fun scenario_missingNotification_lostUpdateIsRecoveredFromHistory() = runTest {
        val b = QaBridge(this)
        b.post(wa(listOf(line("אחת", 1_000))))
        // The notification for "שתיים" never reached us (merged, throttled, listener hiccup)...
        b.advance(3_000)
        // ...but the next re-post carries the whole unread history.
        b.post(wa(listOf(line("אחת", 1_000), line("שתיים", 2_000), line("שלוש", 3_000))))
        b.advance(DEBOUNCE)
        assertEquals(listOf("אחת", "שתיים", "שלוש"), b.engine.requests.single().messages.map { it.text })
    }

    @Test fun scenario_missingNotification_hiddenOrRedactedContentNeverDrafted() = runTest {
        val b = QaBridge(this)
        listOf(
            wa(listOf(line("2 הודעות חדשות", 1_000))),
            wa(listOf(line("‏3 new messages‏", 1_000))),
            wa(listOf(line("הודעה חדשה", 1_000))),
            wa(listOf(line("Sensitive notification content hidden", 1_000))),
            wa(listOf(line("התוכן הרגיש הוסתר", 1_000))),
            wa(listOf(line("היי", 1_000)), title = "WhatsApp"), // Android 15 redaction keeps the app label as title
            wa(listOf(line(null, 1_000), line("   ", 1_001))),
            wa(emptyList()),
        ).forEach(b::post)
        b.advance(DEBOUNCE)
        assertTrue(b.drafts.isEmpty())
        assertTrue(b.engine.requests.isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 removed notification

    @Test fun scenario_removedNotification_expiresDraftInEveryActiveState_andNothingIsSent() = runTest {
        val engine = RecordingEngine()
        val b = QaBridge(this, engine = engine)

        // DEBOUNCING → removed: engine never called.
        b.post(wa(listOf(line("היי", 1_000))))
        b.coordinator.onNotificationRemoved(dana)
        b.advance(DEBOUNCE)
        assertTrue(b.drafts.all { it.state == DraftState.EXPIRED })
        assertTrue(engine.requests.isEmpty())

        // PROCESSING → removed: the late engine answer is dropped.
        engine.gate = CompletableDeferred()
        b.post(wa(listOf(line("עוד משהו", 20_000))))
        b.advance(DEBOUNCE)
        val processing = b.activeOf(dana)
        assertEquals(DraftState.PROCESSING, processing.state)
        b.coordinator.onNotificationRemoved(dana)
        engine.gate!!.complete(Unit)
        b.advance(1)
        assertEquals(DraftState.EXPIRED, b.byId(processing.id).state)
        assertNull(b.byId(processing.id).proposedText)
        engine.gate = null

        // APPROVED → removed: the approval can no longer send.
        val d = b.awaiting(wa(listOf(line("ושוב", 40_000))))
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        b.coordinator.onNotificationRemoved(dana)
        assertEquals(DraftState.EXPIRED, b.coordinator.sendApproved(approval))
        assertEquals("ההתראה נסגרה ב-WhatsApp", b.byId(d.id).statusDetail)
        assertEquals(0, b.sender.calls.get())
    }

    // ------------------------------------------------------------------ 13.1 changed / updated notification

    @Test fun scenario_updatedNotification_identicalRepostIsDedupedAndDoesNotResetTimer() = runTest {
        val b = QaBridge(this)
        val s = wa(listOf(line("היי", 1_000)))
        b.post(s)
        b.advance(10_000)
        b.post(s) // WhatsApp re-posts the same content (e.g. ranking/sound update)
        b.advance(5_000) // 15 s after the FIRST post
        assertEquals(1, b.engine.requests.size)
        val d = b.activeOf(dana)
        assertEquals(0, d.revision)
        b.post(s)
        b.advance(DEBOUNCE)
        assertEquals(1, b.engine.requests.size)
        assertEquals(d, b.activeOf(dana))
    }

    @Test fun scenario_updatedNotification_newLineWhileAwaiting_rebuildsDraftAndVoidsApproval() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(wa(listOf(line("היי", 1_000))))
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!

        b.post(wa(listOf(line("היי", 1_000), line("בעצם עזבי, אדבר איתך מחר", 30_000))))
        val stale = b.activeOf(dana)
        assertEquals(d.id, stale.id)
        assertEquals(DraftState.DEBOUNCING, stale.state)
        assertEquals(d.revision + 1, stale.revision)
        assertNull(stale.proposedText)
        assertNull(stale.approval)
        assertEquals(DraftState.DEBOUNCING, b.coordinator.sendApproved(approval))
        assertEquals(0, b.sender.calls.get())

        b.advance(DEBOUNCE)
        assertEquals(listOf("היי", "בעצם עזבי, אדבר איתך מחר"), b.engine.requests.last().messages.map { it.text })
        assertEquals("תשובה ל-בעצם עזבי, אדבר איתך מחר", b.activeOf(dana).proposedText)
    }

    @Test fun scenario_updatedNotification_userRepliedManually_expiresDraft() = runTest {
        val b = QaBridge(this)
        val d = b.awaiting(wa(listOf(line("היי", 1_000))))
        // The user answered from WhatsApp itself; the updated notification ends with the user's line.
        b.post(wa(listOf(line("היי", 1_000), line("אני בדרך", 20_000, sender = "אני", self = true))))
        assertEquals(DraftState.EXPIRED, b.byId(d.id).state)
        assertEquals("נראה שענית ידנית — הטיוטה בוטלה", b.byId(d.id).statusDetail)
        assertNull(b.coordinator.approve(d.id, d.finalText!!))
    }

    // ------------------------------------------------------------------ 13.1 restart (process death)

    @Test fun scenario_restart_newProcessHasNoDraftsAndRejectsOldApprovals() = runTest {
        val before = QaBridge(this)
        val d = before.awaiting(wa(listOf(line("היי", 1_000))))
        val approval = before.coordinator.approve(d.id, d.finalText!!)!!

        // Process death: the coordinator (and everything in memory) is gone. A new one starts empty.
        val after = QaBridge(this)
        assertTrue(after.drafts.isEmpty())
        assertEquals(DraftState.EXPIRED, after.coordinator.sendApproved(approval))
        assertEquals(0, after.sender.calls.get())
        assertEquals(0, before.sender.calls.get())

        // History re-posted after restart is new to the fresh dedup set → exactly one new draft, normal flow.
        after.post(wa(listOf(line("היי", 1_000), line("?", 2_000))))
        after.advance(DEBOUNCE)
        assertEquals(1, after.engine.requests.size)
        assertEquals(DraftState.AWAITING_APPROVAL, after.activeOf(dana).state)
    }

    // ------------------------------------------------------------------ 13.1 app crash (component failures)

    @Test fun scenario_crash_engineThrows_draftFailedNoRetry_otherConversationUnaffected() = runTest {
        val engine = RecordingEngine()
        engine.responder = { r ->
            if (r.conversationKey == dana) throw IllegalStateException("boom") else DraftResult.Success("ok", SafetyFlags(), "f")
        }
        val b = QaBridge(this, engine = engine)
        b.post(wa(listOf(line("היי", 1_000))))
        b.post(wa(listOf(line("שלום", 1_000, sender = "יוסי")), jid = JID_YOSSI, title = "יוסי"))
        b.advance(DEBOUNCE)
        val failed = b.drafts.single { it.conversationKey == dana }
        assertEquals(DraftState.FAILED, failed.state)
        assertNotNull(failed.statusDetail)
        assertTrue("status detail must not leak content", !failed.statusDetail!!.contains("היי"))
        assertEquals(DraftState.AWAITING_APPROVAL, b.activeOf(yossi).state)

        b.advance(60 * 60 * 1000L)
        assertEquals(2, b.engine.requests.size) // no automatic retry for the failed one
    }

    @Test fun scenario_crash_senderThrows_unknownResult_neverRetried() = runTest {
        val sender = RecordingSender().apply { throwable = RuntimeException("WhatsApp process died") }
        val b = QaBridge(this, sender = sender)
        val d = b.awaiting(wa(listOf(line("היי", 1_000))))
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        assertEquals(DraftState.UNKNOWN_RESULT, b.coordinator.sendApproved(approval))
        assertEquals(DraftState.UNKNOWN_RESULT, b.coordinator.sendApproved(approval))
        b.advance(60 * 60 * 1000L)
        assertEquals(1, sender.calls.get())
    }

    // ------------------------------------------------------------------ 13.1 no internet

    @Test fun scenario_noInternet_engineUnavailable_failedAndNeverAutoRetried_thenRecovers() = runTest {
        val engine = RecordingEngine()
        engine.responder = { DraftResult.Failure("השרת לא זמין", retryable = true) }
        val b = QaBridge(this, engine = engine)
        b.post(wa(listOf(line("היי", 1_000))))
        b.advance(DEBOUNCE)
        val failed = b.drafts.single()
        assertEquals(DraftState.FAILED, failed.state)
        assertEquals(1, engine.requests.size)

        b.advance(6 * 60 * 60 * 1000L) // six hours offline: still exactly one request
        assertEquals(1, engine.requests.size)
        assertEquals(0, b.sender.calls.get())

        // Connectivity is back; the next message gets a normal draft (new draft, new request id).
        engine.responder = { DraftResult.Success("חזרתי", SafetyFlags(), "f") }
        b.post(wa(listOf(line("היי", 1_000), line("?", 7 * 60 * 60 * 1000L))))
        b.advance(DEBOUNCE)
        assertEquals(2, engine.requests.size)
        assertNotEquals(engine.requests[0].requestId, engine.requests[1].requestId)
        assertEquals("חזרתי", b.activeOf(dana).proposedText)
    }

    @Test fun scenario_noInternet_engineHangs_failsAfter45sTimeout() = runTest {
        val engine = RecordingEngine().apply { gate = CompletableDeferred() } // never completes
        val b = QaBridge(this, engine = engine)
        b.post(wa(listOf(line("היי", 1_000))))
        b.advance(DEBOUNCE)
        assertEquals(DraftState.PROCESSING, b.drafts.single().state)
        b.advance(44_999)
        assertEquals(DraftState.PROCESSING, b.drafts.single().state)
        b.advance(1)
        assertEquals(DraftState.FAILED, b.drafts.single().state)
        assertEquals(1, engine.requests.size)
    }

    // ------------------------------------------------------------------ 13.1 15 s debounce

    @Test fun scenario_debounce_defaultIsExactly15Seconds() = runTest {
        assertEquals(15_000L, BridgeSettings().debounceMillis)
        val b = QaBridge(this)
        b.post(wa(listOf(line("היי", 1_000))))
        b.advance(14_999)
        assertTrue(b.engine.requests.isEmpty())
        assertEquals(DraftState.DEBOUNCING, b.drafts.single().state)
        b.advance(1)
        assertEquals(1, b.engine.requests.size)
    }

    @Test fun scenario_debounce_messageAt14999RestartsTheFullWindow() = runTest {
        val b = QaBridge(this)
        b.post(wa(listOf(line("אחת", 1_000))))
        b.advance(14_999)
        b.post(wa(listOf(line("אחת", 1_000), line("שתיים", 2_000))))
        b.advance(14_999)
        assertTrue(b.engine.requests.isEmpty())
        b.advance(1)
        assertEquals(listOf("אחת", "שתיים"), b.engine.requests.single().messages.map { it.text })
    }

    @Test fun scenario_debounce_pausingInsideTheWindowNeverCallsTheEngine() = runTest {
        val b = QaBridge(this)
        b.post(wa(listOf(line("היי", 1_000))))
        b.advance(7_000)
        b.coordinator.updateSettings(READY.copy(paused = true))
        b.advance(DEBOUNCE * 4)
        assertTrue(b.engine.requests.isEmpty())
        assertEquals(DraftState.EXPIRED, b.drafts.single().state)
    }

    @Test fun scenario_debounce_withoutCloudConsentNothingLeavesTheDevice() = runTest {
        val b = QaBridge(this, BridgeSettings(cloudConsentGiven = false, sendingEnabled = true))
        b.post(wa(listOf(line("היי", 1_000))))
        b.advance(DEBOUNCE)
        assertTrue(b.engine.requests.isEmpty())
        assertEquals(DraftState.FAILED, b.drafts.single().state)
    }

    // ------------------------------------------------------------------ outcome mapping used by 13.1 restart / permission

    @Test fun scenario_noLiveReplyAction_failedNoActionIsReportedHonestly() = runTest {
        // After a restart or a revoked listener the platform sender answers FAILED_NO_ACTION.
        val b = QaBridge(this, sender = RecordingSender(SendOutcome.FAILED_NO_ACTION))
        val d = b.awaiting(wa(listOf(line("היי", 1_000))))
        val approval = b.coordinator.approve(d.id, d.finalText!!)!!
        assertEquals(DraftState.FAILED, b.coordinator.sendApproved(approval))
        assertEquals("לא נמצאה אפשרות תשובה פעילה ב-WhatsApp — לא נשלח", b.byId(d.id).statusDetail)
        assertEquals(DraftState.FAILED, b.coordinator.sendApproved(approval))
        assertEquals(1, b.sender.calls.get())
    }
}
