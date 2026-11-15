package ai.noa.bridge.app.ui

import ai.noa.bridge.app.MainActivity
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ServerRevokeResult
import ai.noa.bridge.app.ui.components.chipIconRes
import ai.noa.bridge.app.ui.drafts.DraftDetailScreen
import ai.noa.bridge.app.ui.drafts.DraftsListScreen
import ai.noa.bridge.app.ui.drafts.SendTracker
import ai.noa.bridge.app.ui.drafts.groupDrafts
import ai.noa.bridge.app.ui.home.HomeScreen
import ai.noa.bridge.app.ui.pairing.PairingScreen
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.app.ui.settings.SettingsScreen
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.core.DraftState
import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.view.View
import android.view.WindowManager
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isHeading
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToKey
import androidx.compose.ui.test.performTextReplacement
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * UI regressions for docs/noa-personal-bridge/UX_PERFORMANCE_REVIEW.md (UX-*, A11Y-*, PERF-08) and the
 * UI side of SECURITY.md (S-M5 pin field, S-L5 messaging, S-L8 tapjacking). See the "Fix status" tables.
 */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SecurityUxFixesUiTest {
    @get:Rule val rule = createComposeRule()

    private val sendingOn = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)

    private fun setDetail(fake: FakeAppController, id: String = "draft-1", tracker: SendTracker = SendTracker()) {
        rule.setContent {
            TestFrame {
                val drafts by fake.drafts.collectAsState()
                val status by fake.status.collectAsState()
                val settings by fake.settings.collectAsState()
                val attempts by tracker.attempts.collectAsState()
                DraftDetailScreen(
                    draftId = id, drafts = drafts, status = status, settings = settings, controller = fake,
                    sendAttempt = attempts[id], onSend = { tracker.send(fake, it) }, onBack = {},
                )
            }
        }
    }

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

    private fun liveRegionOf(tag: String): LiveRegionMode? =
        rule.onNodeWithTag(tag).fetchSemanticsNode().config.getOrNull(SemanticsProperties.LiveRegion)

    // ------------------------------------------------------------------ A11Y-01

    @Test
    fun a11y01_incomingBubbleExposesTheMessageTextWithSenderAndTimeAsState() {
        val fake = FakeAppController()
        setDetail(fake)
        val message = fake.drafts.value.first { it.id == "draft-1" }.sourceMessages.first()
        val node = rule.onAllNodesWithTag("incomingBubble")[0].fetchSemanticsNode()
        assertNull("no contentDescription that would replace the text", node.config.getOrNull(SemanticsProperties.ContentDescription))
        val text = node.config.getOrNull(SemanticsProperties.Text).orEmpty().joinToString(" ") { it.text }
        assertTrue("TalkBack reads the message itself: $text", text.contains(message.text))
        val state = node.config.getOrNull(SemanticsProperties.StateDescription).orEmpty()
        assertTrue(state.contains(message.senderDisplayName))
    }

    // ------------------------------------------------------------------ UX-01

    @Test
    fun ux01_awaitingThenApprovedFirst_thenInProgress_thenHistory_newestFirstInEachGroup() {
        val now = 1_000_000L
        val base = FakeAppController.sampleDrafts().first { it.id == "draft-1" }
        fun d(id: String, state: DraftState, updated: Long) = base.copy(id = id, state = state, updatedAtMillis = now + updated)
        val groups = groupDrafts(
            listOf(
                d("debouncing-new", DraftState.DEBOUNCING, 900),
                d("approved-new", DraftState.APPROVED, 800),
                d("awaiting-old", DraftState.AWAITING_APPROVAL, 100),
                d("history", DraftState.CANCELLED, 1_000),
                d("awaiting-new", DraftState.AWAITING_APPROVAL, 500),
                d("processing-old", DraftState.PROCESSING, 50),
            ),
        )
        assertEquals(listOf("awaiting-new", "awaiting-old", "approved-new"), groups.needsYou.map { it.id })
        assertEquals(listOf("debouncing-new", "processing-old"), groups.inProgress.map { it.id })
        assertEquals(listOf("history"), groups.history.map { it.id })
    }

    @Test
    fun ux01_a11y05_sectionsAreTheOnlyHeadingsAndNeedsYouComesFirst() {
        rule.setContent { TestFrame { DraftsListScreen(FakeAppController.sampleDrafts(), onOpenDraft = {}) } }
        rule.onNodeWithTag("section_needs_you").assertIsDisplayed()
        val needsTop = rule.onNodeWithTag("section_needs_you").fetchSemanticsNode().boundsInRoot.top
        // Awaiting cards are directly under the first section (before any in-progress card).
        rule.onNodeWithTag("draftCard_draft-1").assertIsDisplayed()
        assertTrue(rule.onNodeWithTag("draftCard_draft-1").fetchSemanticsNode().boundsInRoot.top > needsTop)
        // A11Y-05: clickable cards are never headings.
        FakeAppController.sampleDrafts().forEach { draft ->
            rule.onNodeWithTag("draftsList").performScrollToKey(draft.id)
            rule.onAllNodes(isHeading() and hasAnyAncestor(hasTestTag("draftCard_${draft.id}")), useUnmergedTree = true)
                .assertCountEquals(0)
            val card = rule.onNodeWithTag("draftCard_${draft.id}").fetchSemanticsNode()
            assertFalse(card.config.contains(SemanticsProperties.Heading))
        }
    }

    // ------------------------------------------------------------------ UX-02

    @Test
    fun ux02_dialogDismissReadsCloseAndTheDraftButtonReadsCancelDraft() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("cancelDraftButton").performScrollTo().assertTextEquals("בטל טיוטה").performClick()
        rule.onNodeWithText("סגור").assertIsDisplayed()
        rule.onNodeWithText("ביטול טיוטה").assertIsDisplayed()
        rule.onNodeWithText("סגור").performClick()
        assertTrue(fake.cancelCalls.isEmpty())

        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithText("סגור").assertIsDisplayed()
        rule.onNodeWithText("ביטול").assertDoesNotExist()
    }

    // ------------------------------------------------------------------ UX-03

    @Test
    fun ux03_homeTopBarStopIsVisibleWithoutScrollingAndConfirms() {
        val fake = FakeAppController()
        setHome(fake)
        rule.onNodeWithTag("topEmergencyStop").assertIsDisplayed().performClick()
        assertEquals(0, fake.emergencyStopCalls)
        rule.onNodeWithText(str(R.string.home_emergency_dialog_confirm)).performClick()
        assertEquals(1, fake.emergencyStopCalls)
    }

    @Test
    fun ux03_draftDetailTopBarHasTheSameStop() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("topEmergencyStop").assertIsDisplayed().performClick()
        rule.onNodeWithText(str(R.string.home_emergency_dialog_title)).assertIsDisplayed()
        rule.onNodeWithText(str(R.string.home_emergency_dialog_confirm)).performClick()
        assertEquals(1, fake.emergencyStopCalls)
    }

    // ------------------------------------------------------------------ UX-04

    @Test
    fun ux04_approveDialogRepeatsTheSafetyWarningOnlyForFlaggedDrafts() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake, id = "draft-2") // flagged: injection + sensitive
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialogSafety").assertIsDisplayed()
    }

    @Test
    fun ux04_noSafetyWarningForAnUnflaggedDraft() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake, id = "draft-1")
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialog").assertIsDisplayed()
        rule.onNodeWithTag("approveDialogSafety").assertDoesNotExist()
    }

    // ------------------------------------------------------------------ UX-06 / A11Y-09

    @Test
    fun ux06_stateIconsAreHonest() {
        assertEquals(R.drawable.ic_state_forwarded, DraftState.SEND_ATTEMPTED.chipIconRes())
        assertEquals(R.drawable.ic_state_unknown, DraftState.UNKNOWN_RESULT.chipIconRes())
        assertEquals(R.drawable.ic_state_hourglass, DraftState.DEBOUNCING.chipIconRes())
    }

    @Test
    fun ux06_afterASendAttemptTheTextIsLabelledForwardedAndApproveIsHidden() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake, id = "draft-8") // SEND_ATTEMPTED
        rule.onNodeWithTag("approveButton").assertDoesNotExist()
        rule.onNodeWithText("הטקסט שהועבר").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(str(R.string.detail_reply_header)).assertDoesNotExist()
    }

    @Test
    fun ux06_a11y02_sendResultIsAnnouncedAssertively() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("sendResult_SEND_ATTEMPTED").performScrollTo().assertIsDisplayed()
        assertEquals(LiveRegionMode.Assertive, liveRegionOf("sendResult_SEND_ATTEMPTED"))
        rule.onNodeWithTag("approveButton").assertDoesNotExist()
        rule.onNodeWithText("הטקסט שהועבר").performScrollTo().assertIsDisplayed()
    }

    // ------------------------------------------------------------------ UX-07

    @Test
    fun ux07_sendingOffButtonCopiesAndApprovesNothing() {
        val fake = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true))
        setDetail(fake)
        rule.onNodeWithTag("approveButton").performScrollTo().assertTextEquals("העתק טקסט").performClick()
        rule.waitForIdle()
        assertTrue(fake.approveCalls.isEmpty())
        assertTrue(fake.sendCalls.isEmpty())
        assertEquals(DraftState.AWAITING_APPROVAL, fake.drafts.value.first { it.id == "draft-1" }.state)
        rule.onNodeWithText(str(R.string.detail_copied)).performScrollTo().assertIsDisplayed()
    }

    // ------------------------------------------------------------------ S-L7 (UI)

    @Test
    fun sL7_scrubbedTerminalDraftExplainsWhyItsContentIsGone() {
        val base = FakeAppController.sampleDrafts().first { it.id == "draft-13" } // CANCELLED
        val fake = FakeAppController(initialDrafts = listOf(base.copy(sourceMessages = emptyList(), proposedText = null, editedText = null)))
        setDetail(fake, id = "draft-13")
        rule.onNodeWithTag("contentScrubbed").assertIsDisplayed()
        rule.onNodeWithTag("incomingBubble").assertDoesNotExist()
    }

    // ------------------------------------------------------------------ A11Y-02

    @Test
    fun a11y02_detailErrorIsAPoliteLiveRegion() {
        val fake = FakeAppController(initialSettings = sendingOn, rejectApprovals = true)
        setDetail(fake)
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.approve_dialog_confirm)).performClick()
        rule.onNodeWithTag("detailError").performScrollTo().assertIsDisplayed()
        assertEquals(LiveRegionMode.Polite, liveRegionOf("detailError"))
    }

    // ------------------------------------------------------------------ S-L5 (UI)

    @Test
    fun sL5_settingsSaysHonestlyWhenTheServerDidNotConfirmTheRevoke() {
        val fake = FakeAppController(revokeResult = ServerRevokeResult.NOT_CONFIRMED)
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                val settings by fake.settings.collectAsState()
                SettingsScreen(fake, status, settings, emptyList(), "1", true, {}, {})
            }
        }
        rule.onNodeWithTag("disconnectRow").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.settings_disconnect_dialog_confirm)).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("settingsResult").performScrollTo().assertIsDisplayed()
        rule.onNodeWithText(str(R.string.settings_revoke_not_confirmed)).assertIsDisplayed()
        rule.onNodeWithText(str(R.string.settings_disconnect_done)).assertDoesNotExist()
        assertEquals(LiveRegionMode.Polite, liveRegionOf("settingsResult"))
        assertTrue(str(R.string.settings_revoke_not_confirmed).startsWith("הניתוק המקומי בוצע, אבל השרת לא אישר את הביטול"))
    }

    @Test
    fun sL5_confirmedDisconnectSaysDone() {
        val fake = FakeAppController(revokeResult = ServerRevokeResult.CONFIRMED)
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                val settings by fake.settings.collectAsState()
                SettingsScreen(fake, status, settings, emptyList(), "1", true, {}, {})
            }
        }
        rule.onNodeWithTag("disconnectRow").performScrollTo().performClick()
        rule.onNodeWithText(str(R.string.settings_disconnect_dialog_confirm)).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(str(R.string.settings_disconnect_done)).performScrollTo().assertIsDisplayed()
    }

    // ------------------------------------------------------------------ S-M5 (UI)

    @Test
    fun sM5_invalidPinIsRejectedInPairingValidationAndNothingIsSent() {
        val fake = FakeAppController(initialStatus = ai.noa.bridge.app.BridgeStatus())
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                PairingScreen(fake, status, onBack = {})
            }
        }
        rule.onNodeWithText(str(R.string.pairing_pin_label)).assertIsDisplayed()
        rule.onNodeWithTag("pairingUrl").performTextReplacement("https://bridge.example.com")
        rule.onNodeWithTag("pairingCode").performTextReplacement("AB12CD34")
        rule.onNodeWithTag("pairingPin").performTextReplacement("sha256/short")
        rule.onNodeWithTag("pairingSubmit").performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag("pairingPinError", useUnmergedTree = true).assertIsDisplayed()
        assertTrue(fake.pairCalls.isEmpty())
    }

    @Test
    fun sM5_validPinIsPassedToPairing_emptyPinMeansNone() {
        val pin = "sha256/" + java.util.Base64.getEncoder().encodeToString(ByteArray(32) { 7 })
        val fake = FakeAppController(initialStatus = ai.noa.bridge.app.BridgeStatus())
        rule.setContent {
            TestFrame {
                val status by fake.status.collectAsState()
                PairingScreen(fake, status, onBack = {})
            }
        }
        rule.onNodeWithTag("pairingUrl").performTextReplacement("https://bridge.example.com")
        rule.onNodeWithTag("pairingCode").performTextReplacement("AB12CD34")
        rule.onNodeWithTag("pairingPin").performTextReplacement(pin)
        rule.onNodeWithTag("pairingSubmit").performScrollTo().performClick()
        rule.waitForIdle()
        assertEquals(listOf<String?>(pin), fake.pinCalls)
        rule.onNodeWithTag("pairingSuccess").performScrollTo().assertIsDisplayed()
        assertEquals(LiveRegionMode.Polite, liveRegionOf("pairingSuccess"))
    }

    // ------------------------------------------------------------------ S-L8 (dialog)

    private fun rootViews(): List<View> {
        val wmgClass = Class.forName("android.view.WindowManagerGlobal")
        val wmg = wmgClass.getMethod("getInstance").invoke(null)
        @Suppress("UNCHECKED_CAST")
        val names = wmgClass.getMethod("getViewRootNames").invoke(wmg) as Array<String>
        val getRootView = wmgClass.getMethod("getRootView", String::class.java)
        return names.map { getRootView.invoke(wmg, it) as View }
    }

    @Test
    fun sL8_approveDialogFiltersTouchesWhileObscured() {
        val fake = FakeAppController(initialSettings = sendingOn)
        setDetail(fake)
        assertTrue("nothing filtered before the dialog", rootViews().none { it.filterTouchesWhenObscured })
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        rule.onNodeWithTag("approveDialog").assertIsDisplayed()
        rule.waitForIdle()
        assertTrue("the dialog window drops obscured touches", rootViews().any { it.filterTouchesWhenObscured })
    }
}

/** Activity / manifest / lifecycle checks (no Compose rule: they build their own activity). */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SecurityPlatformUiTest {
    private val context: Application = ApplicationProvider.getApplicationContext()

    @Test
    fun sL8_manifestRequestsHideOverlayWindows() {
        val info = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
        assertTrue(info.requestedPermissions.orEmpty().contains("android.permission.HIDE_OVERLAY_WINDOWS"))
    }

    @Test
    fun sL8_mainActivityHidesNonSystemOverlays() {
        shadowOf(context).grantPermissions("android.permission.HIDE_OVERLAY_WINDOWS")
        val activity = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        val attrs = activity.window.attributes
        val privateFlags = WindowManager.LayoutParams::class.java.getField("privateFlags").getInt(attrs)
        val hideFlag = WindowManager.LayoutParams::class.java.getField("SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS").getInt(null)
        assertNotEquals("SYSTEM_FLAG_HIDE_NON_SYSTEM_OVERLAY_WINDOWS set", 0, privateFlags and hideFlag)
        assertNotEquals("FLAG_SECURE still set", 0, attrs.flags and WindowManager.LayoutParams.FLAG_SECURE)
    }

    @Test
    fun a11y03_a11y04_latinRunsAreIsolatedAndArrowsPointLeftInRtl() {
        val r = context.resources
        val all = R.string::class.java.fields.map { it.name to r.getString(it.getInt(null)) }
        assertTrue("no right arrow in RTL text", all.none { (_, v) -> v.contains('→') })
        all.filter { (name, v) -> v.contains("https://") && name != "pairing_url_placeholder" }.forEach { (name, v) ->
            assertTrue("$name isolates https://", v.contains("⁦https://⁩"))
        }
        assertEquals("כתובת: ⁦https://bridge.example.com⁩", context.getString(R.string.home_server_address, "https://bridge.example.com"))
        assertTrue(context.getString(R.string.settings_pair_desc_paired, "x").contains("⁦x⁩"))
        assertTrue(context.getString(R.string.pairing_already_paired, "x").contains("⁦x⁩"))
        assertTrue(context.getString(R.string.settings_revoke_not_confirmed).contains("⁦revoke-device⁩"))
        // S-M4: the consent text is accurate about the identifier.
        val consent = context.getString(R.string.consent_dialog_what_body)
        assertTrue(consent.contains("מספרי טלפון לא נשלחים לשרת; השיחה מזוהה במזהה אקראי שנוצר במכשיר"))
    }

    @Test
    fun perf08_clockTicksOnlyWhileResumed() = runTest {
        val main = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(main)
        try {
            val owner = object : LifecycleOwner {
                val registry = LifecycleRegistry.createUnsafe(this)
                override val lifecycle: Lifecycle get() = registry
            }
            owner.registry.currentState = Lifecycle.State.CREATED
            val ticks = mutableListOf<Long>()
            backgroundScope.launch { tickWhileResumed(owner.lifecycle, 30_000L, { testScheduler.currentTime }) { ticks += it } }
            advanceTimeBy(120_000); runCurrent()
            assertTrue("no ticks while not resumed", ticks.isEmpty())

            owner.registry.currentState = Lifecycle.State.RESUMED
            runCurrent()
            advanceTimeBy(60_001); runCurrent()
            assertEquals(3, ticks.size) // immediately, +30 s, +60 s

            owner.registry.currentState = Lifecycle.State.STARTED // app went to the background
            runCurrent()
            val before = ticks.size
            advanceTimeBy(10 * 60_000L); runCurrent()
            assertEquals("stopped in the background", before, ticks.size)
        } finally {
            Dispatchers.resetMain()
        }
    }
}
