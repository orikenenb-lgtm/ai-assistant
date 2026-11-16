package ai.noa.bridge.app.ui

import androidx.compose.runtime.collectAsState
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.drafts.DraftDetailScreen
import ai.noa.bridge.app.ui.home.HomeScreen
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.core.BridgeSettings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** 200% font scale on a Galaxy S25 Ultra-sized screen: every action stays reachable. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w412dp-h891dp-xxhdpi")
class FontScaleTest {
    @get:Rule val rule = createComposeRule()

    @Composable
    private fun Big(content: @Composable () -> Unit) {
        val d = LocalDensity.current
        CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale = 2f)) { TestFrame(content) }
    }

    @Test
    fun home_allActionsReachableAt200Percent() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = false, sendingEnabled = true))
        rule.setContent {
            Big { HomeScreen(fake, fake.status.collectAsState().value, fake.settings.collectAsState().value, fake.drafts.collectAsState().value, {}, {}, {}, {}) }
        }
        rule.onNodeWithText(str(R.string.home_no_consent_body)).performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("pauseToggle").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("emergencyStopButton").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun detail_approveDialogReadableAt200Percent() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true))
        rule.setContent {
            Big {
                DraftDetailScreen("draft-1", fake.drafts.collectAsState().value, fake.status.collectAsState().value, fake.settings.collectAsState().value, fake, null, { true }, {})
            }
        }
        rule.onNodeWithTag("excludeButton").performScrollTo().assertIsDisplayed()
        rule.onNodeWithTag("approveButton").performScrollTo().assertIsDisplayed().performClick()
        rule.onNodeWithTag("approveDialogText").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).assertIsDisplayed()
    }
}
