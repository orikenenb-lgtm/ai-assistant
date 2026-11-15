package ai.noa.bridge.app.ui

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.drafts.DraftsListScreen
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.core.DraftState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToKey
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class DraftsListTest {
    @get:Rule val rule = createComposeRule()

    @Test
    fun rendersAHebrewStateChipForEveryDraftState() {
        val drafts = FakeAppController.sampleDrafts()
        assertEquals("sample data covers every state", DraftState.entries.toSet(), drafts.map { it.state }.toSet())
        rule.setContent { TestFrame { DraftsListScreen(drafts, onOpenDraft = {}) } }

        drafts.forEach { draft ->
            rule.onNodeWithTag("draftsList").performScrollToKey(draft.id)
            // Several drafts can share a state (UX-01 groups them), so look inside this draft's card.
            rule.onNode(
                hasTestTag("stateChip_${draft.state.name}") and hasAnyAncestor(hasTestTag("draftCard_${draft.id}")),
                useUnmergedTree = true,
            ).assertIsDisplayed()
        }
        rule.onNodeWithTag("draftsList").performScrollToKey("draft-8")
        rule.onNodeWithText(str(R.string.state_send_attempted), useUnmergedTree = true).assertIsDisplayed()
        rule.onNodeWithTag("draftsList").performScrollToKey("draft-3")
        rule.onNodeWithText(str(R.string.state_debouncing), useUnmergedTree = true).assertIsDisplayed()
        // DEBOUNCING explains the 15 second wait right on the card.
        rule.onNodeWithText(str(R.string.explain_debouncing), useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun tappingACardOpensThatDraft() {
        val opened = mutableListOf<String>()
        rule.setContent { TestFrame { DraftsListScreen(FakeAppController.sampleDrafts(), onOpenDraft = { opened += it }) } }
        rule.onNodeWithTag("draftsList").performScrollToKey("draft-1")
        rule.onNodeWithTag("draftCard_draft-1").performClick()
        assertEquals(listOf("draft-1"), opened)
    }

    @Test
    fun emptyStateGivesGuidance() {
        rule.setContent { TestFrame { DraftsListScreen(emptyList(), onOpenDraft = {}) } }
        rule.onNodeWithText(str(R.string.drafts_empty_title)).assertIsDisplayed()
        rule.onNodeWithText(str(R.string.drafts_empty_body)).assertExists()
    }
}
