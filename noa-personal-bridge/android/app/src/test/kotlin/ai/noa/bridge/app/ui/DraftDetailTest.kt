package ai.noa.bridge.app.ui

import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.drafts.DraftDetailScreen
import ai.noa.bridge.app.ui.drafts.SendTracker
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.DraftState
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DraftDetailTest {
    @get:Rule val rule = createComposeRule()

    private val sendingOn = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)
    private val sendingOff = BridgeSettings(cloudConsentGiven = true, sendingEnabled = false)
    private val draft1Text = FakeAppController.sampleDrafts().first { it.id == "draft-1" }.finalText!!

    private fun setDetail(fake: FakeAppController, tracker: SendTracker = SendTracker(), id: String = "draft-1") {
        rule.setContent {
            TestFrame {
                val drafts by fake.drafts.collectAsState()
                val status by fake.status.collectAsState()
                val settings by fake.settings.collectAsState()
                val attempts by tracker.attempts.collectAsState()
                DraftDetailScreen(
                    draftId = id,
                    drafts = drafts,
                    status = status,
                    settings = settings,
                    controller = fake,
                    sendAttempt = attempts[id],
                    onSend = { tracker.send(fake, it) },
                    onBack = {},
                )
            }
        }
    }

    @Test
    fun approveDialog_showsExactTextAndRecipient_confirmApprovesThenSendsOnce() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)

        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialog").assertIsDisplayed()
        rule.onNodeWithTag("approveDialogText").assertTextEquals(draft1Text)
        rule.onNodeWithTag("approveDialogRecipient").assertTextEquals(str(R.string.approve_dialog_recipient, "דנה כהן"))
        assertTrue("nothing is approved before confirming", fake.approveCalls.isEmpty())

        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()

        assertEquals(listOf("draft-1" to draft1Text), fake.approveCalls)
        assertEquals(1, fake.sendCalls.size)
        assertEquals("draft-1", fake.sendCalls.single().draftId)
        assertEquals(listOf("approveDraft", "sendApproved"), fake.calls.filter { it == "approveDraft" || it == "sendApproved" })

        // Honest result, and no way to send the same draft again.
        rule.onNodeWithTag("sendResult_SEND_ATTEMPTED").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("approveButton").performScrollTo().assertIsNotEnabled()
        assertEquals(1, fake.sendCalls.size)
    }

    @Test
    fun sendTracker_neverSendsTheSameDraftTwice() {
        val fake = FakeAppController(initialSettings = sendingOn)
        val tracker = SendTracker()
        val approval = fake.approveDraft("draft-1", draft1Text)!!
        assertTrue(tracker.send(fake, approval))
        assertEquals(false, tracker.send(fake, approval))
        rule.waitForIdle()
        assertEquals(1, fake.sendCalls.size)
    }

    @Test
    fun approveReturnsNull_showsErrorAndDoesNotSend() {
        val fake = FakeAppController(initialSettings = sendingOn, rejectApprovals = true)
        setDetail(fake)
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(1, fake.approveCalls.size)
        assertTrue(fake.sendCalls.isEmpty())
        rule.onNodeWithTag("detailError").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun sendingDisabled_offersCopyAndNeverSends() {
        val fake = FakeAppController(initialSettings = sendingOff)
        setDetail(fake)

        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.approve_dialog_off_title)).assertIsDisplayed()
        rule.onNodeWithTag("approveDialogText").assertTextEquals(draft1Text)
        rule.onNodeWithText(str(R.string.approve_dialog_copy)).assertIsDisplayed().performClick()
        rule.waitForIdle()

        assertTrue(fake.sendCalls.isEmpty())
        assertTrue(fake.approveCalls.isEmpty())
        val clipboard = ApplicationProvider.getApplicationContext<Context>().getSystemService(ClipboardManager::class.java)
        assertEquals(draft1Text, clipboard.primaryClip?.getItemAt(0)?.text?.toString())
        rule.onNodeWithText(str(R.string.detail_copied)).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun cancel_requiresConfirmation_thenCallsCancelDraft() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("cancelDraftButton").performScrollTo().performClick()
        assertTrue(fake.cancelCalls.isEmpty())
        rule.onNodeWithText(str(R.string.cancel_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf("draft-1"), fake.cancelCalls)
        assertEquals(DraftState.CANCELLED, fake.drafts.value.first { it.id == "draft-1" }.state)
    }

    @Test
    fun exclude_requiresConfirmation_thenCallsExclude() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("excludeButton").performScrollTo().performClick()
        assertTrue(fake.excludeCalls.isEmpty())
        rule.onNodeWithText(str(R.string.exclude_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf("draft-1"), fake.excludeCalls)
    }

    @Test
    fun edit_saveCallsEditDraft() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("replyField").performScrollTo().performTextReplacement("נשמע מצוין, נתראה מחר")
        rule.onNodeWithTag("saveEditButton").performScrollTo().assertIsEnabled().performClick()
        rule.waitForIdle()
        assertEquals(listOf("draft-1" to "נשמע מצוין, נתראה מחר"), fake.editCalls)
    }

    @Test
    fun editedTextIsWhatGetsApproved() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        val edited = "נשמע מצוין, נתראה מחר ב-20:00"
        rule.onNodeWithTag("replyField").performScrollTo().performTextReplacement(edited)
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialogText").assertTextEquals(edited)
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf("draft-1" to edited), fake.editCalls)
        assertEquals(listOf("draft-1" to edited), fake.approveCalls)
        assertEquals(1, fake.sendCalls.size)
    }

    @Test
    fun deviceLocked_disablesSendingWithExplanation() {
        val fake = FakeAppController(
            initialStatus = BridgeStatus(notificationAccessGranted = true, listenerConnected = true, paired = true, deviceLocked = true),
            initialSettings = sendingOn,
        )
        setDetail(fake)
        rule.onNodeWithText(str(R.string.detail_locked_notice)).performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("approveButton").performScrollTo().assertIsNotEnabled()
    }

    @Test
    fun safetyBanner_shownForInjectionAttempt() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake, id = "draft-2")
        rule.onNodeWithTag("safetyBanner").assertIsDisplayed()
        rule.onNodeWithText(str(R.string.detail_safety_injection), substring = true).assertIsDisplayed()
    }

    @Test
    fun statusDetail_isShown() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake, id = "draft-10")
        rule.onNodeWithTag("statusDetail").assertIsDisplayed()
        rule.onNodeWithTag("approveButton").performScrollTo().assertIsNotEnabled()
    }
}
