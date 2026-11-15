package ai.noa.bridge.app.ui

import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.drafts.SendTracker
import ai.noa.bridge.app.ui.onboarding.InMemoryOnboardingStore
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.app.ui.theme.NoaTheme
import ai.noa.bridge.core.BridgeSettings
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.LayoutDirection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NoaAppTest {
    @get:Rule val rule = createComposeRule()

    private fun setApp(fake: FakeAppController, store: InMemoryOnboardingStore) {
        rule.setContent {
            NoaTheme(darkTheme = false) {
                // Simulate a phone set to English (LTR): NoaApp must still force RTL.
                CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
                    NoaApp(
                        controller = fake,
                        onboardingStore = store,
                        appVersion = "test",
                        sendingCompiledIn = true,
                        liveClock = false,
                        sendTracker = remember { SendTracker() },
                    )
                }
            }
        }
    }

    @Test
    fun layoutIsRtl_evenWhenThePlatformIsLtr() {
        setApp(FakeAppController(), InMemoryOnboardingStore(done = true, asked = true))
        val home = rule.onNodeWithTag("tab_home").getBoundsInRoot()
        val settings = rule.onNodeWithTag("tab_settings").getBoundsInRoot()
        // In RTL the first tab ("בית") sits at the right edge, to the right of "הגדרות".
        assertTrue("home tab (${home.left}) should be right of settings (${settings.left})", home.left > settings.left)
    }

    @Test
    fun tabsNavigate_andDraftsBadgeCountsPending() {
        val fake = FakeAppController()
        setApp(fake, InMemoryOnboardingStore(done = true, asked = true))
        rule.onNodeWithContentDescription(str(R.string.cd_drafts_badge, 3), useUnmergedTree = true).assertExists() // draft-1, draft-2 (awaiting) + draft-5 (ready)
        rule.onNodeWithTag("tab_drafts").performClick()
        rule.onNodeWithTag("draftsList").assertIsDisplayed()
        rule.onNodeWithTag("draftCard_draft-1").performClick()
        rule.onNodeWithTag("approveButton").assertExists()
        rule.onNodeWithTag("backButton").performClick()
        rule.onNodeWithTag("draftsList").assertIsDisplayed()
        rule.onNodeWithTag("tab_settings").performClick()
        rule.onNodeWithTag("consentSwitch").assertExists()
    }

    @Test
    fun onboarding_canSkipConsent_appStillWorks() {
        val fake = FakeAppController(initialSettings = BridgeSettings())
        val store = InMemoryOnboardingStore(done = false, asked = true)
        setApp(fake, store)
        rule.onNodeWithTag("onboarding").assertIsDisplayed()
        repeat(3) { rule.onNodeWithTag("onboardingNext").performClick() }
        rule.onNodeWithTag("onboardingSkip").performClick()
        rule.waitForIdle()
        assertTrue(store.onboardingDone)
        assertTrue("skipping never consents", fake.consentCalls.isEmpty())
        rule.onNodeWithTag("tab_home").assertIsDisplayed()
        rule.onNodeWithText(str(R.string.home_no_consent_title)).assertExists()
    }

    @Test
    fun onboarding_consentGoesThroughDisclosure() {
        val fake = FakeAppController(initialSettings = BridgeSettings())
        val store = InMemoryOnboardingStore(done = false, asked = true)
        setApp(fake, store)
        repeat(3) { rule.onNodeWithTag("onboardingNext").performClick() }
        rule.onNodeWithTag("onboardingConsent").performClick()
        rule.onNodeWithTag("consentDialog").assertIsDisplayed()
        assertTrue(fake.consentCalls.isEmpty())
        rule.onNodeWithText(str(R.string.consent_dialog_confirm)).performClick()
        rule.waitForIdle()
        assertEquals(listOf(true), fake.consentCalls)
        assertTrue(store.onboardingDone)
    }

    @Test
    fun deepLinkOpensDraftDetail() {
        val fake = FakeAppController()
        rule.setContent {
            NoaTheme(darkTheme = false) {
                NoaApp(
                    controller = fake,
                    onboardingStore = InMemoryOnboardingStore(done = true, asked = true),
                    appVersion = "test",
                    sendingCompiledIn = true,
                    liveClock = false,
                    openDraftId = "draft-1",
                    sendTracker = remember { SendTracker() },
                )
            }
        }
        rule.onNodeWithTag("approveButton").assertExists()
    }
}
