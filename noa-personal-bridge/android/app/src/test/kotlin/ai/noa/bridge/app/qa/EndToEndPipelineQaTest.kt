package ai.noa.bridge.app.qa

import ai.noa.bridge.app.BuildConfig
import ai.noa.bridge.app.platform.DefaultAppController
import ai.noa.bridge.app.platform.ListenerState
import ai.noa.bridge.app.platform.RemoteInputReplySender
import ai.noa.bridge.app.platform.ReplyActionRegistry
import ai.noa.bridge.app.platform.SecureStore
import ai.noa.bridge.app.platform.SettingsStore
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.SendOutcome
import android.app.Application
import android.service.notification.NotificationListenerService
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * QA traceability: spec 13.1 (Android) and 13.2 (approval) end to end on the platform layer,
 * with real Notification objects and real PendingIntents (Robolectric). The only fake is the
 * draft engine. "Sent" means: a broadcast reached WhatsApp's (simulated) Reply PendingIntent.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class EndToEndPipelineQaTest {
    private val context: Application = ApplicationProvider.getApplicationContext()
    private val wa = WhatsAppNotifications(context)
    private val danaKey = "0|com.whatsapp|1|dana|10"
    private val yossiKey = "0|com.whatsapp|1|yossi|10"

    @After fun resetListener() = ListenerState.detach()

    // ------------------------------------------------------------------ 13.1 single message

    @Test fun e2e_singleMessage_replyGoesThroughWhatsAppReplyActionExactlyOnceAfterApproval() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val mapped = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי, מתי נפגשים?", 1_000))), danaKey)
        val key = phone.keyOf(mapped)
        assertNotNull("reply handle kept for an accepted private chat", phone.registry.get(key))

        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(key)
        assertEquals("קיבלתי: היי, מתי נפגשים?", d.proposedText)
        assertTrue("nothing reaches WhatsApp before approval", repliesSent(context).isEmpty())

        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!
        assertEquals(DraftState.SEND_ATTEMPTED, phone.controller.sendApproved(approval))
        assertEquals(listOf("dana.v1" to "קיבלתי: היי, מתי נפגשים?"), repliesSent(context))
        assertNull("handle is single-use", phone.registry.get(key))

        assertEquals(DraftState.SEND_ATTEMPTED, phone.controller.sendApproved(approval))
        assertEquals(1, repliesSent(context).size)
    }

    // ------------------------------------------------------------------ 13.1 several consecutive messages

    @Test fun e2e_consecutiveMessages_oneDraft_latestReplyHandleIsUsed() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val l1 = Line(wa.dana, "היי", 1_000)
        val l2 = Line(wa.dana, "את פנויה מחר?", 2_000)
        val l3 = Line(wa.dana, "בערב", 3_000)
        phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1), replyTag = "dana.v1"), danaKey)
        phone.advance(4_000)
        phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1, l2), replyTag = "dana.v2"), danaKey)
        phone.advance(4_000)
        val last = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1, l2, l3), replyTag = "dana.v3"), danaKey)
        phone.advance(DEBOUNCE_MS - 1)
        assertTrue(phone.engine.requests.isEmpty())
        phone.advance(1)

        assertEquals(1, phone.engine.requests.size)
        assertEquals(listOf("היי", "את פנויה מחר?", "בערב"), phone.engine.requests.single().messages.map { it.text })
        val d = phone.awaiting(phone.keyOf(last))
        phone.controller.sendApproved(phone.controller.approveDraft(d.id, d.finalText!!)!!)
        assertEquals(listOf("dana.v3"), repliesSent(context).map { it.first })
    }

    // ------------------------------------------------------------------ 13.1 two conversations in parallel / 13.2 other conversation

    @Test fun e2e_twoConversations_replyReachesOnlyTheApprovedChat() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val mDana = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי מדנה", 1_000))), danaKey)
        val mYossi = phone.post(wa.privateChat(wa.yossi, YOSSI_JID, listOf(Line(wa.yossi, "היי מיוסי", 1_000))), yossiKey)
        phone.advance(DEBOUNCE_MS)

        val dYossi = phone.awaiting(phone.keyOf(mYossi))
        val dDana = phone.awaiting(phone.keyOf(mDana))
        assertEquals("קיבלתי: היי מיוסי", dYossi.proposedText)
        assertEquals("קיבלתי: היי מדנה", dDana.proposedText)

        phone.controller.sendApproved(phone.controller.approveDraft(dYossi.id, dYossi.finalText!!)!!)
        assertEquals(listOf("yossi.v1" to "קיבלתי: היי מיוסי"), repliesSent(context))
        assertEquals(DraftState.AWAITING_APPROVAL, phone.awaiting(phone.keyOf(mDana)).state)
        assertNotNull(phone.registry.get(phone.keyOf(mDana)))
    }

    // ------------------------------------------------------------------ 13.1 group message

    @Test fun e2e_groupMessage_noDraftNoReplyHandleNoEngineCall() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val mapped = phone.post(
            wa.groupChat(listOf(Line(wa.dana, "מי מגיע בשבת?", 1_000), Line(wa.yossi, "אני!", 2_000))),
            "0|com.whatsapp|1|family|10",
        )
        assertEquals(true, mapped.snapshot.isGroupConversationFlag)
        phone.advance(DEBOUNCE_MS * 2)
        assertTrue(phone.drafts.isEmpty())
        assertEquals(0, phone.registry.size)
        assertTrue(phone.engine.requests.isEmpty())
        assertTrue(repliesSent(context).isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 excluded conversation

    @Test fun e2e_excludedConversation_draftExpired_handleDropped_futureMessagesIgnored() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m1 = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.post(wa.privateChat(wa.yossi, YOSSI_JID, listOf(Line(wa.yossi, "שלום", 1_000))), yossiKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m1))
        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!

        phone.controller.excludeConversationOf(d.id)
        assertEquals(1, phone.controller.exclusions.value.size)
        assertNull(phone.registry.get(phone.keyOf(m1)))
        // Exclusion is applied through the settings first, so the core expires the draft (reason: excluded).
        val excluded = phone.drafts.single { it.id == d.id }
        assertEquals(DraftState.EXPIRED, excluded.state)
        assertEquals("השיחה הוחרגה מהגשר", excluded.statusDetail)
        assertEquals(DraftState.EXPIRED, phone.controller.sendApproved(approval))

        phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000), Line(wa.dana, "?", 20_000)), "dana.v2"), danaKey)
        phone.advance(DEBOUNCE_MS)
        assertNull("no handle for an excluded chat", phone.registry.get(phone.keyOf(m1)))
        assertTrue(phone.drafts.filter { it.conversationKey == phone.keyOf(m1) }.all { it.state == DraftState.EXPIRED })
        assertEquals(2, phone.engine.requests.size) // Dana's first burst + Yossi's; nothing after exclusion
        assertTrue(repliesSent(context).isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 missing notification

    @Test fun e2e_hiddenOrRedactedNotification_noDraftNoHandleEvenWithReplyAction() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val hidden = phone.post(wa.plain("דנה", "2 הודעות חדשות", shortcutId = DANA_JID), danaKey)
        val redacted = phone.post(wa.plain("WhatsApp", "Sensitive notification content hidden", shortcutId = YOSSI_JID), yossiKey)
        assertTrue(hidden.replyAction != null && redacted.replyAction != null)
        assertTrue(redacted.isLikelyRedacted)
        phone.advance(DEBOUNCE_MS)
        assertTrue(phone.drafts.isEmpty())
        assertEquals(0, phone.registry.size)
        assertTrue(phone.engine.requests.isEmpty())
    }

    @Test fun e2e_notificationWithoutReplyAction_draftShownButSendFailsClosed() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000)), replyTag = null), danaKey)
        assertNull(m.replyAction)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        val outcome = phone.controller.sendApproved(phone.controller.approveDraft(d.id, d.finalText!!)!!)
        assertEquals(DraftState.FAILED, outcome)
        assertTrue(repliesSent(context).isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 removed notification

    @Test fun e2e_removedBecauseUserOpenedChat_draftExpired_nothingSent() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!

        phone.remove(m, NotificationListenerService.REASON_CLICK)
        assertEquals(DraftState.EXPIRED, phone.drafts.single { it.id == d.id }.state)
        assertEquals(DraftState.EXPIRED, phone.controller.sendApproved(approval))
        assertTrue(repliesSent(context).isEmpty())
    }

    @Test fun e2e_removedByTimeout_draftKept_butSendFailsClosedWithoutHandle() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        phone.remove(m, NotificationListenerService.REASON_TIMEOUT)
        assertEquals(DraftState.AWAITING_APPROVAL, phone.awaiting(phone.keyOf(m)).state)
        assertEquals(DraftState.FAILED, phone.controller.sendApproved(phone.controller.approveDraft(d.id, d.finalText!!)!!))
        assertTrue(repliesSent(context).isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 updated notification

    @Test fun e2e_updatedNotification_newLineVoidsApproval_newHandleAndNewTextUsed() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val l1 = Line(wa.dana, "היי", 1_000)
        val m1 = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1), "dana.v1"), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d1 = phone.awaiting(phone.keyOf(m1))
        val stale = phone.controller.approveDraft(d1.id, d1.finalText!!)!!

        phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1, Line(wa.dana, "רגע, שיניתי תוכנית", 30_000)), "dana.v2"), danaKey)
        assertEquals(DraftState.DEBOUNCING, phone.controller.sendApproved(stale))
        assertTrue(repliesSent(context).isEmpty())

        phone.advance(DEBOUNCE_MS)
        val d2 = phone.awaiting(phone.keyOf(m1))
        assertEquals("קיבלתי: רגע, שיניתי תוכנית", d2.proposedText)
        phone.controller.sendApproved(phone.controller.approveDraft(d2.id, d2.finalText!!)!!)
        assertEquals(listOf("dana.v2" to "קיבלתי: רגע, שיניתי תוכנית"), repliesSent(context))
    }

    @Test fun e2e_updatedNotificationAfterManualReply_expiresDraft() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val l1 = Line(wa.dana, "היי", 1_000)
        val m1 = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1)), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m1))
        // The owner replied from WhatsApp; WhatsApp updates the notification with the owner's line last.
        phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(l1, Line(null, "אני בדרך", 20_000)), "dana.v2"), danaKey)
        assertEquals(DraftState.EXPIRED, phone.drafts.single { it.id == d.id }.state)
        assertNull(phone.controller.approveDraft(d.id, d.finalText!!))
    }

    // ------------------------------------------------------------------ 13.1 permission revoked / listener disconnected

    @Test fun e2e_listenerDisconnected_sendFailsClosed_noBroadcast() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        phone.activeKeys = null // notification access revoked → listener unbound
        assertEquals(DraftState.FAILED, phone.controller.sendApproved(phone.controller.approveDraft(d.id, d.finalText!!)!!))
        assertTrue(repliesSent(context).isEmpty())
    }

    @Test fun e2e_permissionRevoked_statusShowsDisconnected_andProductionSenderRefuses() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        ListenerState.setConnected(true)
        runCurrent()
        assertTrue(phone.controller.status.value.listenerConnected)

        ListenerState.detach() // what onListenerDisconnected / onDestroy do
        runCurrent()
        assertFalse(phone.controller.status.value.listenerConnected)
        phone.controller.refreshPermissions()
        assertFalse("no listener package enabled on this device", phone.controller.status.value.notificationAccessGranted)

        // The production sender (default activeNotificationKeys = ListenerState) has no listener to ask.
        val registry = ReplyActionRegistry()
        val m = phone.map(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        registry.put(phone.keyOf(m), ai.noa.bridge.app.platform.ReplyHandle(m.replyAction!!.pendingIntent, m.replyAction!!.remoteInputs, danaKey, 1L))
        val productionSender = RemoteInputReplySender(context, registry, Dispatchers.Unconfined)
        assertEquals(SendOutcome.FAILED_NO_ACTION, productionSender.send(phone.keyOf(m), "שלום"))
        assertTrue(repliesSent(context).isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 screen locked

    @Test fun e2e_screenLocked_draftPreparedButSendRefusedUntilUnlock_thenExactlyOnce() = runTest {
        val phone = QaPhone(this, context).apply { onboard(); locked = true }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m)) // drafting works in the background while locked
        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!

        assertEquals(DraftState.APPROVED, phone.controller.sendApproved(approval))
        assertEquals(DefaultAppController.MSG_LOCKED, phone.controller.status.value.lastErrorHebrew)
        assertTrue(phone.controller.status.value.deviceLocked)
        assertTrue(repliesSent(context).isEmpty())

        phone.locked = false
        assertEquals(DraftState.SEND_ATTEMPTED, phone.controller.sendApproved(approval))
        assertEquals(DraftState.SEND_ATTEMPTED, phone.controller.sendApproved(approval))
        assertEquals(1, repliesSent(context).size)
    }

    // ------------------------------------------------------------------ 13.1 restart (process death)

    @Test fun e2e_restart_draftsGone_settingsKept_handlesRebuilt_noDraftsForOldMessages() = runTest {
        val secure = SecureStore(context, QaCipher())
        val settings = SettingsStore(context)
        val first = QaPhone(this, context, secureStore = secure, settingsStore = settings).apply { onboard() }
        val m = first.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        first.advance(DEBOUNCE_MS)
        val d = first.awaiting(first.keyOf(m))
        val oldApproval = first.controller.approveDraft(d.id, d.finalText!!)!!

        // Process death → a brand new process: new registry, new coordinator, same persisted stores.
        val second = QaPhone(this, context, secureStore = SecureStore(context, QaCipher()), settingsStore = SettingsStore(context))
        assertTrue("drafts are memory-only", second.drafts.isEmpty())
        assertTrue(second.controller.settings.value.cloudConsentGiven)
        assertTrue(second.controller.settings.value.sendingEnabled)
        assertEquals(0, second.registry.size)

        // onListenerConnected: rebuild reply handles from the notifications still showing.
        second.activeKeys!!.add(danaKey)
        second.ingestor.rebuildFrom(listOf(second.map(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)))
        assertNotNull(second.registry.get(second.keyOf(m)))
        second.advance(DEBOUNCE_MS * 2)
        assertTrue("old messages do not create drafts", second.drafts.isEmpty())
        assertTrue(second.engine.requests.isEmpty())

        // An approval from the dead process is meaningless now.
        assertEquals(DraftState.EXPIRED, second.controller.sendApproved(oldApproval))
        assertTrue(repliesSent(context).isEmpty())
    }

    // ------------------------------------------------------------------ 13.1 app crash (engine failure inside the app)

    @Test fun e2e_crash_engineThrows_draftFailed_appKeepsWorkingForOtherChats() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        phone.engine.answer = { r -> if (r.senderDisplayName == "דנה") error("engine crashed") else DraftResult.Success("בסדר", ai.noa.bridge.core.SafetyFlags(), "qa") }
        val mDana = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        val mYossi = phone.post(wa.privateChat(wa.yossi, YOSSI_JID, listOf(Line(wa.yossi, "שלום", 1_000))), yossiKey)
        phone.advance(DEBOUNCE_MS)
        assertEquals(DraftState.FAILED, phone.drafts.single { it.conversationKey == phone.keyOf(mDana) }.state)
        val y = phone.awaiting(phone.keyOf(mYossi))
        phone.controller.sendApproved(phone.controller.approveDraft(y.id, y.finalText!!)!!)
        assertEquals(listOf("yossi.v1" to "בסדר"), repliesSent(context))
    }

    // ------------------------------------------------------------------ 13.1 15 s debounce

    @Test fun e2e_debounce_is15sFromBuildConfig_andCannotBeOverriddenByStoredSettings() = runTest {
        assertEquals(15_000L, BuildConfig.DEBOUNCE_MILLIS)
        SettingsStore(context).save(BridgeSettings(cloudConsentGiven = true, sendingEnabled = true, debounceMillis = 1L))
        val phone = QaPhone(this, context)
        assertEquals(15_000L, phone.controller.settings.value.debounceMillis)

        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(14_999)
        assertEquals(DraftState.DEBOUNCING, phone.activeOf(phone.keyOf(m)).state)
        assertTrue(phone.engine.requests.isEmpty())
        phone.advance(1)
        assertEquals(1, phone.engine.requests.size)
    }

    // ------------------------------------------------------------------ 13.2 approval on the platform

    @Test fun e2e_noApproval_noSend_evenWithEverythingEnabled() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS + 24 * 60 * 60 * 1000L)
        assertTrue(repliesSent(context).isEmpty())
    }

    @Test fun e2e_sendingToggleOff_approvedDraftIsNotSent() = runTest {
        val phone = QaPhone(this, context).apply { controller.setCloudConsent(true) } // experimental send path left OFF
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!
        assertEquals(DraftState.APPROVED, phone.controller.sendApproved(approval))
        assertEquals(DefaultAppController.MSG_SENDING_DISABLED, phone.controller.status.value.lastErrorHebrew)
        assertTrue(repliesSent(context).isEmpty())
    }

    @Test fun e2e_cancel_sendsNothing() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!
        phone.controller.cancelDraft(d.id)
        assertEquals(DraftState.CANCELLED, phone.controller.sendApproved(approval))
        assertTrue(repliesSent(context).isEmpty())
    }

    @Test fun e2e_edit_requiresNewApproval_andWhatsAppReceivesExactlyTheEditedText() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        val first = phone.controller.approveDraft(d.id, d.finalText!!)!!
        val edited = "היי דנה! מחר ב־20:00 מתאים לי 😊\nנדבר"
        phone.controller.editDraft(d.id, edited)
        assertEquals(DraftState.AWAITING_APPROVAL, phone.controller.sendApproved(first))
        assertTrue(repliesSent(context).isEmpty())

        phone.controller.sendApproved(phone.controller.approveDraft(d.id, edited)!!)
        assertEquals(listOf("dana.v1" to edited), repliesSent(context))
    }

    @Test fun e2e_emergencyStop_dropsHandles_voidsApprovals_andSurvivesRestart() = runTest {
        val phone = QaPhone(this, context).apply { onboard() }
        val m = phone.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "היי", 1_000))), danaKey)
        phone.advance(DEBOUNCE_MS)
        val d = phone.awaiting(phone.keyOf(m))
        val approval = phone.controller.approveDraft(d.id, d.finalText!!)!!
        phone.controller.emergencyStop()
        assertEquals(0, phone.registry.size)
        phone.controller.setSendingEnabled(true) // even if the toggle is flipped back
        assertEquals(DraftState.EXPIRED, phone.controller.sendApproved(approval))

        val restarted = QaPhone(this, context)
        assertTrue(restarted.controller.settings.value.emergencyStopped)
        restarted.post(wa.privateChat(wa.dana, DANA_JID, listOf(Line(wa.dana, "עוד", 50_000))), danaKey)
        restarted.advance(DEBOUNCE_MS)
        assertTrue(restarted.drafts.isEmpty())
        assertTrue(repliesSent(context).isEmpty())
    }
}
