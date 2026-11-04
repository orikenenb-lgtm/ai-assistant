package com.disciplineos.app.enforcement

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.disciplineos.app.R
import com.disciplineos.app.designsystem.theme.DisciplineTheme
import com.disciplineos.app.enforcement.ui.BlockScreen
import com.disciplineos.app.enforcement.ui.BlockScreenState
import com.disciplineos.app.enforcement.ui.BlockScreenTags
import com.disciplineos.core.domain.blocker.BypassAvailability
import com.disciplineos.core.model.BlockReason
import com.disciplineos.core.model.PendingTaskSummary
import com.disciplineos.core.model.Priority
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Plain Compose UI test (no Hilt): BlockScreen rendered with fake state. */
@RunWith(AndroidJUnit4::class)
class BlockScreenTest {

    @get:Rule
    val rule = createAndroidComposeRule<ComponentActivity>()

    private val pending = listOf(
        PendingTaskSummary(taskId = 1, occurrenceId = 11, title = "אימון בוקר", priority = Priority.HIGH, overdue = false),
        PendingTaskSummary(taskId = 2, occurrenceId = 12, title = "שיעורי בית", priority = Priority.MEDIUM, overdue = true),
    )

    private var homeCalls = 0
    private var tasksCalls = 0

    private fun render(reason: BlockReason = BlockReason.MANDATORY_TASKS_PENDING) {
        rule.setContent {
            DisciplineTheme(reduceMotion = true) {
                BlockScreen(
                    state = BlockScreenState(
                        reason = reason,
                        pending = pending,
                        appLabel = "Social",
                        availability = BypassAvailability(remainingToday = 2, nextAllowedAt = null, active = null),
                    ),
                    onOpenTasks = { tasksCalls++ },
                    onGoHome = { homeCalls++ },
                    onRequestBypass = { _, _ -> },
                    onOpenRecovery = {},
                )
            }
        }
    }

    @Test
    fun showsRemainingTasksAndEmergencyButton() {
        render()
        rule.onNodeWithText("אימון בוקר").assertIsDisplayed()
        rule.onNodeWithText("שיעורי בית").assertIsDisplayed()
        assertEquals(2, rule.onAllNodesWithTag(BlockScreenTags.TASK_ITEM).fetchSemanticsNodes().size)
        rule.onNodeWithTag(BlockScreenTags.EMERGENCY).assertIsDisplayed()
        rule.onNodeWithText(rule.activity.getString(R.string.block_title)).assertIsDisplayed()
    }

    @Test
    fun backPressGoesHome() {
        render()
        rule.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }
        rule.waitForIdle()
        assertEquals(1, homeCalls)
    }

    @Test
    fun homeAndTasksButtonsInvokeCallbacks() {
        render()
        rule.onNodeWithTag(BlockScreenTags.GO_HOME).performClick()
        rule.onNodeWithTag(BlockScreenTags.OPEN_TASKS).performClick()
        assertEquals(1, homeCalls)
        assertEquals(1, tasksCalls)
    }

    @Test
    fun emergencyOpensBypassSheet() {
        render()
        rule.onNodeWithTag(BlockScreenTags.EMERGENCY).performClick()
        rule.onNodeWithText(rule.activity.getString(R.string.bypass_reason_emergency)).assertIsDisplayed()
    }

    @Test
    fun focusVariantShowsFocusTitle() {
        render(BlockReason.FOCUS_SESSION_ACTIVE)
        rule.onNodeWithText(rule.activity.getString(R.string.block_title_focus)).assertIsDisplayed()
        assertTrue(homeCalls == 0)
    }
}
