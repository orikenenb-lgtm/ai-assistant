package ai.noa.bridge.app.ui

import ai.noa.bridge.app.AppController
import ai.noa.bridge.app.R
import ai.noa.bridge.app.ui.components.BannerKind
import ai.noa.bridge.app.ui.components.LocalNowMillis
import ai.noa.bridge.app.ui.components.NoticeBanner
import ai.noa.bridge.app.ui.components.pendingCount
import ai.noa.bridge.app.ui.drafts.DraftDetailScreen
import ai.noa.bridge.app.ui.drafts.DraftsListScreen
import ai.noa.bridge.app.ui.drafts.SendTracker
import ai.noa.bridge.app.ui.home.HomeScreen
import ai.noa.bridge.app.ui.navigation.Overlay
import ai.noa.bridge.app.ui.navigation.Tab
import ai.noa.bridge.app.ui.navigation.rememberNavState
import ai.noa.bridge.app.ui.onboarding.OnboardingScreen
import ai.noa.bridge.app.ui.onboarding.OnboardingStore
import ai.noa.bridge.app.ui.pairing.PairingScreen
import ai.noa.bridge.app.ui.settings.SettingsScreen
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.delay

/**
 * Root of the UI. Forces RTL so the Hebrew layout holds even when the phone language is English.
 * Every control below talks to [controller] only.
 *
 * @param previewMode true when no real controller is wired (see ControllerProvider); shows a
 *   permanent banner so fake data can never be mistaken for real messages.
 * @param liveClock ticks relative timestamps every 30 s (disabled in tests).
 */
@Composable
fun NoaApp(
    controller: AppController,
    onboardingStore: OnboardingStore,
    appVersion: String,
    sendingCompiledIn: Boolean,
    modifier: Modifier = Modifier,
    previewMode: Boolean = false,
    liveClock: Boolean = true,
    openDraftId: String? = null,
    onOpenDraftHandled: () -> Unit = {},
    sendTracker: SendTracker = viewModel(),
) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        val now by produceState(initialValue = 0L, liveClock) {
            if (!liveClock) return@produceState
            while (true) {
                value = System.currentTimeMillis()
                delay(30_000L)
            }
        }
        CompositionLocalProvider(LocalNowMillis provides now) {
            Surface(color = MaterialTheme.colorScheme.background, modifier = modifier.fillMaxSize().testTag("noaRoot")) {
                NoaAppContent(
                    controller, onboardingStore, appVersion, sendingCompiledIn, previewMode,
                    openDraftId, onOpenDraftHandled, sendTracker,
                )
            }
        }
    }
}

@Composable
private fun NoaAppContent(
    controller: AppController,
    onboardingStore: OnboardingStore,
    appVersion: String,
    sendingCompiledIn: Boolean,
    previewMode: Boolean,
    openDraftId: String?,
    onOpenDraftHandled: () -> Unit,
    sendTracker: SendTracker,
) {
    val status by controller.status.collectAsStateWithLifecycle()
    val rawSettings by controller.settings.collectAsStateWithLifecycle()
    // If the reply path is compiled out, the UI treats sending as off everywhere (no send dialog).
    val settings = if (sendingCompiledIn || !rawSettings.sendingEnabled) rawSettings else rawSettings.copy(sendingEnabled = false)
    val drafts by controller.drafts.collectAsStateWithLifecycle()
    val exclusions by controller.exclusions.collectAsStateWithLifecycle()
    val attempts by sendTracker.attempts.collectAsStateWithLifecycle()
    val nav = rememberNavState()

    val postNotifications = rememberPostNotificationsRequester(
        controller = controller,
        store = onboardingStore,
        autoPrompt = onboardingStore.onboardingDone,
    )

    // Deep link from our own "draft ready" notification.
    LaunchedEffect(openDraftId, onboardingStore.onboardingDone) {
        if (openDraftId != null && onboardingStore.onboardingDone) {
            nav.select(Tab.DRAFTS)
            nav.push(Overlay.DraftDetail(openDraftId))
            onOpenDraftHandled()
        }
    }

    if (!onboardingStore.onboardingDone) {
        OnboardingScreen(
            controller = controller,
            status = status,
            onRequestPostNotifications = postNotifications::request,
            onFinished = onboardingStore::markOnboardingDone,
        )
        return
    }

    BackHandler(enabled = nav.hasOverlay) { nav.pop() }
    BackHandler(enabled = !nav.hasOverlay && nav.tab != Tab.HOME) { nav.select(Tab.HOME) }

    when (val top = nav.top) {
        is Overlay.DraftDetail -> DraftDetailScreen(
            draftId = top.draftId,
            drafts = drafts,
            status = status,
            settings = settings,
            controller = controller,
            sendAttempt = attempts[top.draftId],
            onSend = { approval -> sendTracker.send(controller, approval) },
            onBack = { nav.pop() },
        )
        Overlay.Pairing -> PairingScreen(controller = controller, status = status, onBack = { nav.pop() })
        null -> {
            val pending = drafts.pendingCount()
            Scaffold(
                topBar = { if (previewMode) PreviewModeBanner() },
                bottomBar = {
                    NavigationBar {
                        NavigationBarItem(
                            selected = nav.tab == Tab.HOME,
                            onClick = { nav.select(Tab.HOME) },
                            icon = { Icon(Icons.Filled.Home, contentDescription = null) },
                            label = { Text(stringResource(R.string.tab_home)) },
                            modifier = Modifier.testTag("tab_home"),
                        )
                        val badgeCd = stringResource(R.string.cd_drafts_badge, pending)
                        NavigationBarItem(
                            selected = nav.tab == Tab.DRAFTS,
                            onClick = { nav.select(Tab.DRAFTS) },
                            icon = {
                                BadgedBox(
                                    badge = {
                                        if (pending > 0) {
                                            Badge(Modifier.semantics { contentDescription = badgeCd }) {
                                                Text(if (pending > 99) "99+" else pending.toString())
                                            }
                                        }
                                    },
                                ) { Icon(Icons.Filled.Email, contentDescription = null) }
                            },
                            label = { Text(stringResource(R.string.tab_drafts)) },
                            modifier = Modifier.testTag("tab_drafts"),
                        )
                        NavigationBarItem(
                            selected = nav.tab == Tab.SETTINGS,
                            onClick = { nav.select(Tab.SETTINGS) },
                            icon = { Icon(Icons.Filled.Settings, contentDescription = null) },
                            label = { Text(stringResource(R.string.tab_settings)) },
                            modifier = Modifier.testTag("tab_settings"),
                        )
                    }
                },
            ) { inner ->
                val contentModifier = Modifier.padding(inner).consumeWindowInsets(inner)
                when (nav.tab) {
                    Tab.HOME -> HomeScreen(
                        controller = controller,
                        status = status,
                        settings = settings,
                        drafts = drafts,
                        onOpenDrafts = { nav.select(Tab.DRAFTS) },
                        onOpenPairing = { nav.push(Overlay.Pairing) },
                        onOpenSettings = { nav.select(Tab.SETTINGS) },
                        onRequestPostNotifications = postNotifications::request,
                        modifier = contentModifier,
                    )
                    Tab.DRAFTS -> DraftsListScreen(
                        drafts = drafts,
                        onOpenDraft = { nav.push(Overlay.DraftDetail(it)) },
                        modifier = contentModifier,
                    )
                    Tab.SETTINGS -> SettingsScreen(
                        controller = controller,
                        status = status,
                        settings = settings,
                        exclusions = exclusions,
                        appVersion = appVersion,
                        sendingCompiledIn = sendingCompiledIn,
                        onOpenPairing = { nav.push(Overlay.Pairing) },
                        onRequestPostNotifications = postNotifications::request,
                        modifier = contentModifier,
                    )
                }
            }
        }
    }
}

@Composable
private fun PreviewModeBanner() {
    NoticeBanner(
        kind = BannerKind.DANGER,
        body = stringResource(R.string.preview_mode_banner),
        modifier = Modifier.statusBarsPadding().padding(8.dp).testTag("previewModeBanner"),
    )
}
