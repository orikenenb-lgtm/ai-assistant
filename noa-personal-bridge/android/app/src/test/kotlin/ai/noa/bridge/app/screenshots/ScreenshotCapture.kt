package ai.noa.bridge.app.screenshots

import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.ui.NoaApp
import ai.noa.bridge.app.ui.drafts.SendTracker
import ai.noa.bridge.app.ui.onboarding.InMemoryOnboardingStore
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.app.ui.theme.NoaTheme
import ai.noa.bridge.core.BridgeSettings
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.runtime.remember
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToKey
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.io.FileOutputStream

/**
 * Renders the real Compose screens (with FakeAppController sample data) through Robolectric's
 * native graphics and writes PNGs to docs/noa-personal-bridge/screenshots/.
 *
 * Viewport: 384x832 dp at 3.75x (600 dpi) = 1440x3120 px, the Galaxy S25 Ultra's WQHD+ panel at
 * Samsung's default display size.
 *
 * Opt-in only: skipped (Assume) unless NOA_SCREENSHOTS=1 is set as an environment variable or a
 * system property, so normal CI runs are unaffected. Run with:
 *   NOA_SCREENSHOTS=1 ./gradlew :app:testDebugUnitTest --tests 'ai.noa.bridge.app.screenshots.*' --rerun
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w384dp-h832dp-port-600dpi")
class ScreenshotCapture {
    @get:Rule val rule = createAndroidComposeRule<ComponentActivity>()

    @Before
    fun onlyWhenRequested() {
        val flag = System.getenv("NOA_SCREENSHOTS") ?: System.getProperty("NOA_SCREENSHOTS")
        assumeTrue("Set NOA_SCREENSHOTS=1 to render screenshots", flag == "1")
    }

    // ---------------------------------------------------------------- setup helpers

    private fun app(
        fake: FakeAppController,
        onboardingDone: Boolean = true,
        dark: Boolean? = null,
    ) {
        rule.setContent {
            val content = @androidx.compose.runtime.Composable {
                NoaApp(
                    controller = fake,
                    onboardingStore = remember { InMemoryOnboardingStore(done = onboardingDone, asked = true) },
                    appVersion = "0.1.0",
                    sendingCompiledIn = true,
                    liveClock = false,
                    sendTracker = remember { SendTracker() },
                )
            }
            if (dark == null) NoaTheme(content = content) else NoaTheme(darkTheme = dark, content = content)
        }
        rule.waitForIdle()
    }

    private fun sendingOn() = FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true))

    private fun openDraft(id: String) {
        rule.onNodeWithTag("tab_drafts").performClick()
        rule.onNodeWithTag("draftsList").performScrollToKey(id)
        rule.onNodeWithTag("draftCard_$id").performClick()
        rule.waitForIdle()
    }

    private fun outDir(): File {
        System.getenv("NOA_SCREENSHOTS_DIR")?.let { return File(it).apply { mkdirs() } }
        var dir: File? = File(System.getProperty("user.dir")!!).absoluteFile
        while (dir != null && !File(dir, "docs/noa-personal-bridge").isDirectory) dir = dir.parentFile
        checkNotNull(dir) { "Could not locate docs/noa-personal-bridge above ${System.getProperty("user.dir")}" }
        return File(dir, "docs/noa-personal-bridge/screenshots").apply { mkdirs() }
    }

    /**
     * Software-draws the real window(s) into a bitmap. (compose-ui-test's captureToImage() waits for
     * a hardware frame that never arrives under Robolectric's paused looper, so we draw the decor
     * view directly — the same Compose draw path View.drawToBitmap() uses on a device.)
     * With [dialog] = true the topmost dialog window is drawn centred over the activity with the
     * Material scrim (32% black), as AlertDialog appears on screen.
     */
    private fun shoot(name: String, dialog: Boolean = false) {
        rule.waitForIdle()
        if (dialog) rule.onNode(isDialog()).assertExists()
        val activityRoot = rule.activity.window.decorView
        val bitmap = render(activityRoot)
        if (dialog) {
            val dialogRoot = topmostRootView().takeIf { it !== activityRoot } ?: error("no dialog window found")
            val canvas = Canvas(bitmap)
            canvas.drawColor(Color.argb(82, 0, 0, 0))
            val d = render(dialogRoot)
            canvas.drawBitmap(d, (bitmap.width - d.width) / 2f, (bitmap.height - d.height) / 2f, null)
        }
        val file = File(outDir(), "$name.png")
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        println("SCREENSHOT ${file.absolutePath} ${bitmap.width}x${bitmap.height}")
    }

    private fun render(view: View): Bitmap {
        check(view.width > 0 && view.height > 0) { "view not laid out: ${view.width}x${view.height}" }
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        rule.runOnUiThread { view.draw(canvas) }
        return bitmap
    }

    /** Hidden-but-public WindowManagerGlobal API, reached by reflection (fine under Robolectric). */
    private fun topmostRootView(): View {
        val wmgClass = Class.forName("android.view.WindowManagerGlobal")
        val wmg = wmgClass.getMethod("getInstance").invoke(null)
        @Suppress("UNCHECKED_CAST")
        val names = wmgClass.getMethod("getViewRootNames").invoke(wmg) as Array<String>
        val getRootView = wmgClass.getMethod("getRootView", String::class.java)
        return names.map { getRootView.invoke(wmg, it) as View }.last { it.isShown && it.width > 0 }
    }

    // ---------------------------------------------------------------- screens

    @Test
    fun home() {
        app(FakeAppController())
        shoot("01_home")
        rule.onNodeWithTag("emergencyStopButton").performScrollTo()
        shoot("01b_home_bottom")
    }

    @Test
    fun homeEmergencyStopped() {
        val fake = FakeAppController()
        fake.emergencyStop()
        app(fake)
        shoot("02_home_emergency_stopped")
    }

    @Test
    fun homeNoConsentSendingOn() {
        app(FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = false, sendingEnabled = true)))
        shoot("02b_home_no_consent_experimental")
    }

    @Test
    fun draftsList() {
        app(FakeAppController())
        rule.onNodeWithTag("tab_drafts").performClick()
        shoot("03_drafts_list")
        rule.onNodeWithTag("draftsList").performScrollToKey("draft-13")
        shoot("03b_drafts_list_history")
    }

    @Test
    fun draftsEmpty() {
        app(FakeAppController(initialDrafts = emptyList()))
        rule.onNodeWithTag("tab_drafts").performClick()
        shoot("03c_drafts_empty")
    }

    @Test
    fun draftDetailWithSafetyBanner() {
        app(sendingOn())
        openDraft("draft-2")
        shoot("04_draft_detail_safety")
        rule.onNodeWithTag("excludeButton").performScrollTo()
        shoot("04b_draft_detail_safety_actions")
    }

    @Test
    fun approveConfirmationDialog() {
        app(sendingOn())
        openDraft("draft-1")
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        shoot("05_approve_dialog", dialog = true)
    }

    @Test
    fun approveDialogSendingOff() {
        app(FakeAppController())
        openDraft("draft-1")
        rule.onNodeWithTag("approveButton").performScrollTo().performClick()
        shoot("05b_approve_dialog_sending_off", dialog = true)
    }

    @Test
    fun draftDetailSendAttempted() {
        app(sendingOn())
        openDraft("draft-8")
        shoot("05c_draft_detail_send_attempted")
    }

    @Test
    fun settings() {
        app(sendingOn())
        rule.onNodeWithTag("tab_settings").performClick()
        shoot("06_settings")
        rule.onNodeWithTag("disconnectRow").performScrollTo()
        shoot("06b_settings_bottom")
    }

    @Test
    fun pairing() {
        val fake = FakeAppController(initialStatus = BridgeStatus(notificationAccessGranted = true, postNotificationsGranted = true, listenerConnected = true))
        app(fake)
        rule.onNodeWithTag("tab_settings").performClick()
        rule.onNodeWithTag("pairRow").performScrollTo().performClick()
        shoot("07_pairing")
        rule.onNodeWithTag("pairingSubmit").performClick() // empty code -> validation errors
        shoot("07b_pairing_validation")
    }

    @Test
    fun onboardingPage1() {
        app(FakeAppController(initialSettings = BridgeSettings()), onboardingDone = false)
        shoot("08_onboarding_p1")
    }

    @Test
    @Config(qualifiers = "+night")
    fun homeDark() {
        app(FakeAppController())
        shoot("09_home_dark")
    }

    @Test
    @Config(qualifiers = "+night")
    fun draftDetailDark() {
        app(sendingOn())
        openDraft("draft-2")
        shoot("10_draft_detail_dark")
    }

    @Test
    @Config(fontScale = 2.0f)
    fun draftDetailFontScale200() {
        app(sendingOn())
        openDraft("draft-2")
        shoot("11_draft_detail_font200")
        rule.onNodeWithTag("approveButton").performScrollTo()
        shoot("11b_draft_detail_font200_actions")
        rule.onNodeWithTag("approveButton").performClick()
        shoot("11c_approve_dialog_font200", dialog = true)
    }

    @Test
    @Config(fontScale = 2.0f)
    fun homeFontScale200() {
        app(FakeAppController())
        shoot("12_home_font200")
    }
}
