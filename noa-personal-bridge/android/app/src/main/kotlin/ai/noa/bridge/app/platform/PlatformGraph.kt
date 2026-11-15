package ai.noa.bridge.app.platform

import ai.noa.bridge.app.BuildConfig
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.Clock
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.FilterResult
import android.content.Context
import kotlinx.coroutines.CoroutineScope

/** Composition root of the platform layer. Created lazily, once per process, by BridgeApplication. */
internal class PlatformGraph(context: Context, scope: CoroutineScope) {
    private val appContext = context.applicationContext

    val registry = ReplyActionRegistry()
    private val filter = ConversationFilter.create()
    val notifier = DraftNotifier(appContext)
    private val secureStore = SecureStore(appContext, KeystoreCipher())
    private val settingsStore = SettingsStore(appContext)
    // The gate reads the controller lazily (at send time), so the forward reference is safe.
    private val replySender = RemoteInputReplySender(appContext, registry, sendGate = { controller.canSendNow() })

    val controller: DefaultAppController = DefaultAppController(
        context = appContext,
        scope = scope,
        secureStore = secureStore,
        settingsStore = settingsStore,
        registry = registry,
        notifier = notifier,
        replySender = replySender,
        apiClientFactory = { credentials, onUnauthorized ->
            BridgeApiClient(
                credentials = credentials,
                allowDebugCleartext = BuildConfig.DEBUG,
                onUnauthorized = onUnauthorized,
            )
        },
        coordinatorFactory = { engine, sender, settings ->
            BridgeCoordinator.create(scope, Clock.SYSTEM, engine, sender, settings)
        },
        replyPathCompiledIn = BuildConfig.REPLY_PATH_COMPILED_IN,
        allowDebugCleartext = BuildConfig.DEBUG,
        debounceMillis = BuildConfig.DEBOUNCE_MILLIS,
    )

    val ingestor = NotificationIngestor(
        registry = registry,
        onNotification = { controller.coordinator.onNotification(it) },
        onConversationRemoved = { controller.coordinator.onNotificationRemoved(it) },
        wouldAccept = { snapshot -> filter.evaluate(snapshot, controller.settings.value) is FilterResult.Accepted },
    )
}
