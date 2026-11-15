package ai.noa.bridge.app.ui.preview

import ai.noa.bridge.app.BridgeStatus
import ai.noa.bridge.app.ui.drafts.DraftDetailScreen
import ai.noa.bridge.app.ui.drafts.DraftsListScreen
import ai.noa.bridge.app.ui.home.HomeScreen
import ai.noa.bridge.app.ui.onboarding.OnboardingScreen
import ai.noa.bridge.app.ui.pairing.PairingScreen
import ai.noa.bridge.app.ui.settings.SettingsScreen
import ai.noa.bridge.app.ui.theme.NoaTheme
import ai.noa.bridge.core.BridgeSettings
import android.content.res.Configuration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.LayoutDirection

@Composable
private fun Frame(dark: Boolean = false, content: @Composable () -> Unit) {
    NoaTheme(darkTheme = dark) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            Surface(color = MaterialTheme.colorScheme.background) { content() }
        }
    }
}

@Preview(name = "Home", showBackground = true, widthDp = 412, heightDp = 1400, locale = "iw")
@Composable
private fun HomePreview() = Frame {
    val c = remember { FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)) }
    HomeScreen(c, c.status.value, c.settings.value, c.drafts.value, {}, {}, {}, {})
}

@Preview(name = "Home – emergency stopped, dark", showBackground = true, widthDp = 412, heightDp = 1400, uiMode = Configuration.UI_MODE_NIGHT_YES, locale = "iw")
@Composable
private fun HomeStoppedPreview() = Frame(dark = true) {
    val c = remember {
        FakeAppController(
            initialStatus = BridgeStatus(lastErrorHebrew = "השרת לא זמין כרגע"),
            initialSettings = BridgeSettings(emergencyStopped = true),
        )
    }
    HomeScreen(c, c.status.value, c.settings.value, c.drafts.value, {}, {}, {}, {})
}

@Preview(name = "Drafts", showBackground = true, widthDp = 412, heightDp = 2000, locale = "iw")
@Composable
private fun DraftsPreview() = Frame {
    DraftsListScreen(FakeAppController.sampleDrafts(), onOpenDraft = {})
}

@Preview(name = "Drafts – empty, 200% font", showBackground = true, widthDp = 412, heightDp = 900, fontScale = 2f, locale = "iw")
@Composable
private fun DraftsEmptyPreview() = Frame {
    DraftsListScreen(emptyList(), onOpenDraft = {})
}

@Preview(name = "Draft detail – safety", showBackground = true, widthDp = 412, heightDp = 1400, locale = "iw")
@Composable
private fun DetailPreview() = Frame {
    val c = remember { FakeAppController(initialSettings = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)) }
    DraftDetailScreen("draft-2", c.drafts.value, c.status.value, c.settings.value, c, null, { false }, {})
}

@Preview(name = "Settings", showBackground = true, widthDp = 412, heightDp = 2000, locale = "iw")
@Composable
private fun SettingsPreview() = Frame {
    val c = remember { FakeAppController() }
    SettingsScreen(c, c.status.value, c.settings.value, c.exclusions.value, "0.1.0", true, {}, {})
}

@Preview(name = "Pairing", showBackground = true, widthDp = 412, heightDp = 900, locale = "iw")
@Composable
private fun PairingPreview() = Frame {
    val c = remember { FakeAppController(initialStatus = BridgeStatus()) }
    PairingScreen(c, c.status.value, onBack = {})
}

@Preview(name = "Onboarding", showBackground = true, widthDp = 412, heightDp = 900, locale = "iw")
@Composable
private fun OnboardingPreview() = Frame {
    val c = remember { FakeAppController(initialStatus = BridgeStatus()) }
    OnboardingScreen(c, c.status.value, onRequestPostNotifications = {}, onFinished = {})
}
