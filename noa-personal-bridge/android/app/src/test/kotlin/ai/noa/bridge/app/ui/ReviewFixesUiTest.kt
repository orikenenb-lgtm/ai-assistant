package ai.noa.bridge.app.ui

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.drafts.DraftDetailScreen
import ai.noa.bridge.app.ui.drafts.SendTracker
import ai.noa.bridge.app.ui.drafts.SendUiState
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.DraftState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** UI regressions for docs/noa-personal-bridge/CODE_REVIEW.md (H-1, H-2, L-3). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ReviewFixesUiTest {
    @get:Rule val rule = createComposeRule()

    private val sendingOn = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)
    private val textA = FakeAppController.sampleDrafts().first { it.id == "draft-1" }.finalText!!

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

    /** The coordinator redrafts draft-1 after a new incoming message: new text, revision +2. */
    private fun FakeAppController.newMessageRedrafts(newText: String) {
        setDrafts(
            drafts.value.map {
                if (it.id == "draft-1") {
                    it.copy(proposedText = newText, editedText = null, revision = it.revision + 2, state = DraftState.AWAITING_APPROVAL)
                } else it
            },
        )
    }

    // ---------------------------------------------------------------- H-1

    @Test
    fun h1_staleDialogClosesWhenTheDraftChangesAndTheOldTextIsNeverApproved() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)

        // Reviewer scenario: "Approve & send" opened on revision N with text A ...
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialogText").assertTextEquals(textA)

        // ... the contact writes "actually cancel, don't come", NOA produces B while the dialog is open.
        val textB = "אין בעיה, ביטלנו"
        fake.newMessageRedrafts(textB)
        rule.waitForIdle()

        // The dialog is gone at once, with an explanation; A was neither edited back nor approved.
        rule.onNodeWithTag("approveDialog").assertDoesNotExist()
        rule.onNodeWithTag("draftChangedNotice").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(str(R.string.detail_draft_changed)).assertIsDisplayed()
        assertTrue(fake.approveCalls.isEmpty())
        assertTrue(fake.editCalls.isEmpty())
        assertTrue(fake.sendCalls.isEmpty())

        // Re-opening shows (and approves) the NEW stored text only.
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialogText").assertTextEquals(textB)
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf("draft-1" to textB), fake.approveCalls)
        assertTrue(fake.editCalls.isEmpty())
        assertEquals(1, fake.sendCalls.size)
    }

    @Test
    fun h1_stateChangeAtTheSameRevisionAlsoClosesTheDialog() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialog").assertIsDisplayed()

        fake.setDrafts(fake.drafts.value.map { if (it.id == "draft-1") it.copy(state = DraftState.EXPIRED) else it })
        rule.waitForIdle()

        rule.onNodeWithTag("approveDialog").assertDoesNotExist()
        assertTrue(fake.approveCalls.isEmpty())
    }

    @Test
    fun h1_localEditIsSavedBeforeTheDialogOpensAndConfirmNeverEdits() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        val edited = "נשמע מצוין, נתראה מחר ב-20:00"
        rule.onNodeWithTag("replyField").performScrollTo().performTextReplacement(edited)
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()

        // Saved first (new revision), then the dialog shows the STORED text.
        assertEquals(listOf("draft-1" to edited), fake.editCalls)
        assertTrue(fake.approveCalls.isEmpty())
        rule.onNodeWithTag("approveDialogText").assertTextEquals(fake.drafts.value.first { it.id == "draft-1" }.finalText!!)

        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals("confirm must not edit", 1, fake.editCalls.size)
        assertEquals(listOf("draft-1" to edited), fake.approveCalls)
        assertEquals(1, fake.sendCalls.size)
    }

    // ---------------------------------------------------------------- H-2

    @Test
    fun h2_editEndingInWhitespaceIsApprovedAsStored() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("replyField").performScrollTo().performTextReplacement("see you at 8 \n")
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()

        rule.onNodeWithTag("approveDialogText").assertTextEquals("see you at 8")
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()

        assertEquals(listOf("draft-1" to "see you at 8"), fake.approveCalls)
        assertEquals(1, fake.sendCalls.size)
        rule.onNodeWithTag("detailError").assertDoesNotExist()
    }

    @Test
    fun h2_textOverTheLimitShowsAnErrorInsteadOfBeingSilentlyDropped() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("replyField").performScrollTo().performTextReplacement("x".repeat(4_001))
        rule.onNodeWithTag("textTooLong").assertIsDisplayed()
        rule.onNodeWithText(str(R.string.detail_text_too_long)).assertIsDisplayed()
        assertTrue(fake.editCalls.isEmpty())

        // Exactly at the limit is fine and is stored as typed.
        val max = "y".repeat(4_000)
        rule.onNodeWithTag("replyField").performScrollTo().performTextReplacement(max)
        rule.onNodeWithTag("textTooLong").assertDoesNotExist()
        rule.onNodeWithTag("saveEditButton").performScrollTo().assertIsEnabled().performClick()
        rule.waitForIdle()
        assertEquals(listOf("draft-1" to max), fake.editCalls)
        assertEquals(max, fake.drafts.value.first { it.id == "draft-1" }.finalText)
    }

    // ---------------------------------------------------------------- L-3

    @Test
    fun l3_refusedSendDoesNotLockTheDraftAndAnotherApprovalIsPossible() {
        // The controller/core refused before any send step (e.g. locked): the draft stays APPROVED.
        val fake = FakeAppController(initialSettings = sendingOn, sendResult = DraftState.APPROVED)
        val tracker = SendTracker()
        setDetail(fake, tracker)

        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(1, fake.sendCalls.size)
        assertFalse("not an attempt", "draft-1" in tracker.attempts.value)

        // Not stuck: approve again (the coordinator issues a new approval) and send.
        fake.sendResult = DraftState.SEND_ATTEMPTED
        rule.onNodeWithTag("approveButton").performScrollTo().assertIsEnabled().performClick()
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(2, fake.approveCalls.size)
        assertEquals(2, fake.sendCalls.size)
        assertEquals(SendUiState.Finished(DraftState.SEND_ATTEMPTED), tracker.attempts.value["draft-1"])
    }

    @Test
    fun l3_sendTrackerMarksOnlyRealAttempts() {
        listOf(
            DraftState.APPROVED to false,
            DraftState.AWAITING_APPROVAL to false,
            DraftState.EXPIRED to false,
            DraftState.SENDING to true,
            DraftState.SEND_ATTEMPTED to true,
            DraftState.FAILED to true,
            DraftState.UNKNOWN_RESULT to true,
        ).forEach { (result, attempted) ->
            val fake = FakeAppController(initialSettings = sendingOn, sendResult = result)
            val tracker = SendTracker()
            val approval = fake.approveDraft("draft-1", textA)!!
            assertTrue(tracker.send(fake, approval))
            rule.waitForIdle()
            assertEquals(result.name, attempted, "draft-1" in tracker.attempts.value)
            assertEquals(result.name, !attempted, tracker.send(fake, fake.approveDraft("draft-1", textA) ?: approval))
            rule.waitForIdle()
        }
    }
}
