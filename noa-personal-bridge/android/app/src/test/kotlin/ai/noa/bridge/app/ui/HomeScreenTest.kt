package ai.noa.bridge.app.ui

import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.home.HomeScreen
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.core.BridgeSettings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class HomeScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun setHome(fake: FakeAppController) {
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                val settings by fake.settings.collectAsState()
                val drafts by fake.drafts.collectAsState()
                HomeScreen(fake, status, settings, drafts, {}, {}, {}, {})
            }
        }
    }

    @Test
    fun emergencyStop_requiresConfirmation_thenCallsController() {
        val fake = FakeAppController()
        setHome(fake)

        rule.onNodeWithTag("emergencyStopButton").performScrollTo().assertIsDisplayed().performClick()
        rule.onNodeWithText(str(R.string.home_emergency_dialog_title)).assertIsDisplayed()
        assertEquals("nothing happens before confirming", 0, fake.emergencyStopCalls)

        rule.onNodeWithText(str(R.string.home_emergency_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(1, fake.emergencyStopCalls)

        // Stopped state: clear banner + resume action, emergency button gone.
        rule.onNodeWithTag("emergencyBanner").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("emergencyStopButton").assertDoesNotExist()
    }

    @Test
    fun emergencyStop_dismissDoesNothing() {
        val fake = FakeAppController()
        setHome(fake)
        rule.onNodeWithTag("emergencyStopButton").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.action_cancel)).performClick()
        rule.waitForIdle()
        assertEquals(0, fake.emergencyStopCalls)
    }

    @Test
    fun resumeAfterEmergencyStop_requiresConfirmation() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true, emergencyStopped = true))
        setHome(fake)
        rule.onNodeWithTag("resumeButton").performScrollTo().performClick()
        assertEquals(0, fake.resumeCalls)
        rule.onNodeWithText(str(R.string.home_resume_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(1, fake.resumeCalls)
        rule.onNodeWithTag("emergencyBanner").assertDoesNotExist()
    }

    @Test
    fun pauseToggle_callsSetPaused() {
        val fake = FakeAppController()
        setHome(fake)
        rule.onNodeWithTag("pauseToggle").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), fake.pausedCalls)
    }

    @Test
    fun missingNotificationAccess_grantButtonOpensSystemSettings() {
        val fake = FakeAppController(initialStatus = BridgeStatus(paired = true, backendReachable = true, postNotificationsGranted = true))
        setHome(fake)
        rule.onNodeWithText(str(R.string.home_whatsapp_no_access)).performScrollTo().assertIsDisplayed()
        // First "grant" button in reading order is the WhatsApp card's.
        rule.onAllNodesWithText(str(R.string.action_grant))[0].performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(1, fake.openNotificationAccessCalls)
    }

    @Test
    fun experimentalSendingNotice_shownOnlyWhenSendingEnabled() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true))
        setHome(fake)
        rule.onNodeWithText(str(R.string.home_experimental_title)).performScrollTo().assertIsDisplayed()
    }
}
