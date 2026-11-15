package ai.noa.bridge.app.ui

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.app.ui.settings.SettingsScreen
import ai.noa.bridge.core.BridgeSettings
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class SettingsScreenTest {
    @get:Rule val rule = createComposeRule()

    private fun setSettings(fake: FakeAppController, compiledIn: Boolean = true) {
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                val settings by fake.settings.collectAsState()
                val exclusions by fake.exclusions.collectAsState()
                SettingsScreen(fake, status, settings, exclusions, "0.1.0", compiledIn, {}, {})
            }
        }
    }

    @Test
    fun consentSwitch_showsFullDisclosureBeforeConsenting() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = false))
        setSettings(fake)

        rule.onNodeWithTag("consentSwitch").performScrollTo().assertIsOff().performClick()
        rule.onNodeWithTag("consentDialog").assertIsDisplayed()
        rule.onNodeWithText(str(R.string.consent_dialog_what_body)).assertExists()
        assertTrue("no consent before the user agrees in the dialog", fake.consentCalls.isEmpty())

        rule.onNodeWithText(str(R.string.consent_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), fake.consentCalls)
        rule.onNodeWithTag("consentSwitch").assertIsOn()
    }

    @Test
    fun consentDialog_declineKeepsConsentOff() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = false))
        setSettings(fake)
        rule.onNodeWithTag("consentSwitch").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.consent_dialog_decline)).performClick()
        rule.waitForIdle()
        assertTrue(fake.consentCalls.isEmpty())
        rule.onNodeWithTag("consentSwitch").assertIsOff()
    }

    @Test
    fun revokingConsentIsImmediate() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true))
        setSettings(fake)
        rule.onNodeWithTag("consentSwitch").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf(false), fake.consentCalls)
    }

    @Test
    fun sendingSwitch_showsWarningBeforeEnabling() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true))
        setSettings(fake)
        rule.onNodeWithTag("sendingSwitch").performScrollTo().performClick()
        rule.onNodeWithTag("sendingDialog").assertIsDisplayed()
        assertTrue(fake.sendingEnabledCalls.isEmpty())
        rule.onNodeWithText(str(R.string.sending_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), fake.sendingEnabledCalls)
    }

    @Test
    fun removeExclusion_callsController() {
        val fake = FakeAppController()
        setSettings(fake)
        val key = fake.exclusions.value.single().conversationKeyValue
        rule.onNodeWithTag("removeExclusion_$key").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf(key), fake.removeExclusionCalls)
    }

    @Test
    fun wipe_requiresConfirmation() {
        val fake = FakeAppController()
        setSettings(fake)
        rule.onNodeWithTag("wipeRow").performScrollTo().performClick()
        assertEquals(0, fake.wipeCalls)
        rule.onNodeWithText(str(R.string.settings_wipe_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(1, fake.wipeCalls)
        rule.onNodeWithText(str(R.string.settings_wipe_done)).performScrollTo().assertIsDisplayed()
    }

    @Test
    fun disconnect_requiresConfirmation() {
        val fake = FakeAppController()
        setSettings(fake)
        rule.onNodeWithTag("disconnectRow").performScrollTo().performClick()
        assertEquals(0, fake.disconnectCalls)
        rule.onNodeWithText(str(R.string.settings_disconnect_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(1, fake.disconnectCalls)
    }
}
