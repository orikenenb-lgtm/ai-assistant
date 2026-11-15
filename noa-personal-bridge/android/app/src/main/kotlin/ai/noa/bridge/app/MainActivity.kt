package ai.noa.bridge.app

import ai.noa.bridge.app.ui.ControllerProvider
import ai.noa.bridge.app.ui.ControllerSource
import ai.noa.bridge.app.ui.NoaApp
import ai.noa.bridge.app.ui.onboarding.SharedPrefsOnboardingStore
import ai.noa.bridge.app.ui.preview.FakeAppController
import ai.noa.bridge.app.ui.theme.NoaTheme
import ai.noa.bridge.core.BridgeSettings
import ai.noa.bridge.app.platform.DraftNotifier
import android.content.Intent
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf

class MainActivity : ComponentActivity() {

    private lateinit var source: ControllerSource

    /** Draft to open, set when the user taps our "draft ready" notification. */
    private val openDraftId = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Private messages must never leak into screenshots, screen recordings or the recents view.
        window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)

        source = ControllerProvider.from(this) {
            // Only reachable when the Application is not BridgeApplication (e.g. a test harness).
            // Empty data, and NoaApp shows a permanent "preview mode" banner.
            FakeAppController(
                initialStatus = BridgeStatus(),
                initialSettings = BridgeSettings(),
                initialDrafts = emptyList(),
                initialExclusions = emptyList(),
            )
        }
        val onboardingStore = SharedPrefsOnboardingStore(this)
        if (savedInstanceState == null) readDraftExtra(intent)

        setContent {
            NoaTheme {
                NoaApp(
                    controller = source.controller,
                    onboardingStore = onboardingStore,
                    appVersion = BuildConfig.VERSION_NAME,
                    sendingCompiledIn = BuildConfig.REPLY_PATH_COMPILED_IN,
                    previewMode = source is ControllerSource.Unavailable,
                    openDraftId = openDraftId.value,
                    onOpenDraftHandled = { openDraftId.value = null },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        readDraftExtra(intent)
    }

    private fun readDraftExtra(intent: Intent?) {
        intent?.getStringExtra(DraftNotifier.EXTRA_DRAFT_ID)?.takeIf { it.isNotBlank() }?.let { openDraftId.value = it }
    }

    override fun onResume() {
        super.onResume()
        source.controller.refreshPermissions()
    }
}
