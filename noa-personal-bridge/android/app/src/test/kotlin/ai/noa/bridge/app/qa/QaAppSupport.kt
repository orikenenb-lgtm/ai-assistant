package ai.noa.bridge.app.qa

import ai.noa.bridge.app.BuildConfig
import ai.noa.bridge.app.platform.BridgeApiClient
import ai.noa.bridge.app.platform.DefaultAppController
import ai.noa.bridge.app.platform.MappedNotification
import ai.noa.bridge.app.platform.NotificationIngestor
import ai.noa.bridge.app.platform.NotificationMapper
import ai.noa.bridge.app.platform.RemoteInputReplySender
import ai.noa.bridge.app.platform.ReplyActionRegistry
import ai.noa.bridge.app.platform.SecretCipher
import ai.noa.bridge.app.platform.SecureStore
import ai.noa.bridge.app.platform.SettingsStore
import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.Clock
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.ConversationKeys
import ai.noa.bridge.core.Draft
import ai.noa.bridge.core.DraftEngineClient
import ai.noa.bridge.core.DraftRequest
import ai.noa.bridge.core.DraftResult
import ai.noa.bridge.core.DraftState
import ai.noa.bridge.core.DraftStateMachine
import ai.noa.bridge.core.FilterResult
import ai.noa.bridge.core.SafetyFlags
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.RemoteInput
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import org.robolectric.Shadows.shadowOf
import java.util.Collections

/*
 * QA support for the app module (Agent 28). Builds REAL notifications with NotificationCompat
 * (MessagingStyle + a RemoteInput reply action, the shape WhatsApp posts) and wires the REAL
 * platform pieces together exactly like PlatformGraph does:
 *
 *   Notification → NotificationMapper → NotificationIngestor → DefaultAppController
 *     → BridgeCoordinator (core) → RemoteInputReplySender → PendingIntent.send (Robolectric)
 *
 * Only the draft engine is faked (no network) and the "active notifications" set of the listener
 * is simulated. A reply that would reach WhatsApp shows up as a recorded broadcast whose action
 * names the conversation and the notification version it came from.
 */

const val QA_REPLY_PREFIX = "ai.noa.bridge.qa.REPLY."
const val QA_RESULT_KEY = "reply_text"

const val DANA_JID = "972501112222@s.whatsapp.net"
const val YOSSI_JID = "972503334444@s.whatsapp.net"
const val FAMILY_JID = "120363025555555555@g.us"

/** Reversible, non-plaintext cipher (AndroidKeyStore does not exist on Robolectric). */
class QaCipher : SecretCipher {
    override fun encrypt(plaintext: String): String =
        "qa:" + Base64.encodeToString(plaintext.toByteArray(Charsets.UTF_8).reversedArray(), Base64.NO_WRAP)

    override fun decrypt(encoded: String): String? =
        if (!encoded.startsWith("qa:")) null
        else String(Base64.decode(encoded.removePrefix("qa:"), Base64.NO_WRAP).reversedArray(), Charsets.UTF_8)

    override fun destroyKey() = Unit
}

/** One line of a chat: who wrote it ([from] null = the device owner), text and time. */
data class Line(val from: Person?, val text: String, val ts: Long)

class WhatsAppNotifications(private val context: Context) {
    val me: Person = Person.Builder().setName("אני").setKey("me").build()
    val dana: Person = Person.Builder().setName("דנה").setKey("dana").build()
    val yossi: Person = Person.Builder().setName("יוסי").setKey("yossi").build()

    private var requestCodes = 100

    /** The reply PendingIntent WhatsApp attaches; its action identifies conversation + version. */
    fun replyIntent(tag: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        requestCodes++,
        Intent(QA_REPLY_PREFIX + tag).setPackage(context.packageName),
        PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun replyAction(tag: String) =
        NotificationCompat.Action.Builder(0, "השב", replyIntent(tag))
            .addRemoteInput(RemoteInput.Builder(QA_RESULT_KEY).setLabel("השב").build())
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setShowsUserInterface(false)
            .build()

    fun privateChat(
        contact: Person,
        jid: String,
        lines: List<Line>,
        replyTag: String? = "${contact.key}.v1",
    ): Notification {
        val style = NotificationCompat.MessagingStyle(me)
        lines.forEach { style.addMessage(it.text, it.ts, it.from) }
        return NotificationCompat.Builder(context, "qa")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(contact.name)
            .setStyle(style)
            .setShortcutId(jid)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .apply { if (replyTag != null) addAction(replyAction(replyTag)) }
            .build()
    }

    fun groupChat(lines: List<Line>, replyTag: String = "family.v1"): Notification {
        val style = NotificationCompat.MessagingStyle(me).setConversationTitle("משפחה").setGroupConversation(true)
        lines.forEach { style.addMessage(it.text, it.ts, it.from) }
        return NotificationCompat.Builder(context, "qa")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle("משפחה")
            .setStyle(style)
            .setShortcutId(FAMILY_JID)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .addAction(replyAction(replyTag))
            .build()
    }

    /** A style-less notification (content hidden by the user, or Android 15 redaction) that still has Reply. */
    fun plain(title: String, text: String, replyTag: String = "plain.v1"): Notification =
        NotificationCompat.Builder(context, "qa")
            .setSmallIcon(android.R.drawable.sym_action_chat)
            .setContentTitle(title)
            .setContentText(text)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .addAction(replyAction(replyTag))
            .build()
}

/** Draft engine fake for the app tests: records requests, answers deterministically, no network. */
class QaEngine : DraftEngineClient {
    val requests: MutableList<DraftRequest> = Collections.synchronizedList(mutableListOf())
    var answer: (DraftRequest) -> DraftResult = { r ->
        DraftResult.Success("קיבלתי: " + r.messages.last().text, SafetyFlags(), "qa")
    }

    override suspend fun requestDraft(request: DraftRequest): DraftResult {
        requests += request
        return answer(request)
    }
}

/** The phone: every real platform component, one fake engine, simulated listener state. */
@OptIn(ExperimentalCoroutinesApi::class)
class QaPhone(
    private val test: TestScope,
    private val context: Context,
    val engine: QaEngine = QaEngine(),
    secureStore: SecureStore = SecureStore(context, QaCipher()),
    settingsStore: SettingsStore = SettingsStore(context),
) {
    /** Keys of notifications currently showing; null = listener not connected / access revoked. */
    @Volatile var activeKeys: MutableSet<String>? = mutableSetOf()
    @Volatile var locked: Boolean = false

    val registry = ReplyActionRegistry()
    private val filter = ConversationFilter.create()
    val sender = RemoteInputReplySender(context, registry, Dispatchers.Unconfined) { activeKeys?.toSet() }

    val controller = DefaultAppController(
        context = context,
        scope = test.backgroundScope,
        secureStore = secureStore,
        settingsStore = settingsStore,
        registry = registry,
        notifier = null,
        replySender = sender,
        apiClientFactory = { creds, onUnauthorized ->
            BridgeApiClient(credentials = creds, allowDebugCleartext = true, onUnauthorized = onUnauthorized)
        },
        // Same as PlatformGraph, except virtual time and the fake engine instead of the HTTP client.
        coordinatorFactory = { _, replySender, settings ->
            BridgeCoordinator.create(test.backgroundScope, Clock { test.testScheduler.currentTime }, engine, replySender, settings)
        },
        replyPathCompiledIn = BuildConfig.REPLY_PATH_COMPILED_IN,
        allowDebugCleartext = true,
        debounceMillis = BuildConfig.DEBOUNCE_MILLIS,
        ioDispatcher = UnconfinedTestDispatcher(test.testScheduler),
        isDeviceLocked = { locked },
        deviceName = "SM-S938B",
    )

    val ingestor = NotificationIngestor(
        registry = registry,
        onNotification = { controller.coordinator.onNotification(it) },
        onConversationRemoved = { controller.coordinator.onNotificationRemoved(it) },
        wouldAccept = { s -> filter.evaluate(s, controller.settings.value) is FilterResult.Accepted },
    )

    fun onboard() {
        controller.setCloudConsent(true)
        controller.setSendingEnabled(true)
    }

    fun map(n: Notification, notificationKey: String, postTime: Long = test.testScheduler.currentTime): MappedNotification =
        NotificationMapper.map(n, "com.whatsapp", notificationKey, null, postTime)

    /** WhatsApp posts (or updates) [n] under [notificationKey]. */
    fun post(n: Notification, notificationKey: String): MappedNotification {
        val mapped = map(n, notificationKey)
        activeKeys?.add(notificationKey)
        ingestor.onPosted(mapped)
        return mapped
    }

    fun remove(mapped: MappedNotification, reason: Int) {
        activeKeys?.remove(mapped.snapshot.notificationKey)
        ingestor.onRemoved(mapped, reason)
    }

    fun advance(ms: Long) {
        test.advanceTimeBy(ms)
        test.runCurrent()
    }

    val drafts: List<Draft> get() = controller.drafts.value

    fun keyOf(mapped: MappedNotification): ConversationKey = ConversationKeys.derive(mapped.snapshot)!!

    fun activeOf(key: ConversationKey): Draft =
        drafts.single { it.conversationKey == key && it.state !in DraftStateMachine.terminalStates }

    fun awaiting(key: ConversationKey): Draft = activeOf(key).also {
        check(it.state == DraftState.AWAITING_APPROVAL) { "expected AWAITING_APPROVAL, was ${it.state}" }
    }
}

/** Every reply that reached a (simulated) WhatsApp reply action: action suffix → text. */
fun repliesSent(context: Context): List<Pair<String, String>> =
    shadowOf(context as android.app.Application).broadcastIntents
        .filter { it.action?.startsWith(QA_REPLY_PREFIX) == true }
        .map { intent ->
            val results = android.app.RemoteInput.getResultsFromIntent(intent)
            intent.action!!.removePrefix(QA_REPLY_PREFIX) to results?.getCharSequence(QA_RESULT_KEY).toString()
        }

const val DEBOUNCE_MS = 15_000L
