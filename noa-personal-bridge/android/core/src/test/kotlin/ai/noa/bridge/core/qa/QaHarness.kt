package ai.noa.bridge.core.qa

import ai.noa.bridge.core.BridgeCoordinator
import ai.noa.bridge.core.BridgeSettings
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
import ai.noa.bridge.core.NotificationSnapshot
import ai.noa.bridge.core.ReplySender
import ai.noa.bridge.core.SafetyFlags
import ai.noa.bridge.core.SendOutcome
import ai.noa.bridge.core.SnapshotMessage
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import java.util.Collections
import java.util.concurrent.atomic.AtomicInteger

/*
 * QA harness (Agent 27/28). Independent of the dev team's TestFixtures so the QA suite keeps its own
 * vocabulary: every scenario is written in terms of "WhatsApp posts a notification", "16 s pass",
 * "the user approves", and asserts only on observable behaviour (drafts flow, engine requests,
 * sender calls).
 */

internal const val JID_DANA = "972501112222@s.whatsapp.net"
internal const val JID_YOSSI = "972503334444@s.whatsapp.net"
internal const val JID_GROUP = "120363025555555555@g.us"

internal const val DEBOUNCE = BridgeSettings.DEFAULT_DEBOUNCE_MILLIS

/** Settings of a user who finished onboarding: consent given and the experimental send path on. */
internal val READY = BridgeSettings(cloudConsentGiven = true, sendingEnabled = true)

internal fun line(text: String?, ts: Long, sender: String? = "דנה", self: Boolean = false) =
    SnapshotMessage(sender = sender, text = text, timestampMillis = ts, isFromSelf = self)

/** A WhatsApp notification as the app module would map it. Defaults describe a private chat with Dana. */
internal fun wa(
    lines: List<SnapshotMessage>,
    jid: String? = JID_DANA,
    title: String? = "דנה",
    conversationTitle: String? = null,
    groupFlag: Boolean? = false,
    groupSummary: Boolean = false,
    ongoing: Boolean = false,
    category: String? = "msg",
    pkg: String = ConversationFilter.WHATSAPP_PACKAGE,
    shortcutId: String? = jid,
) = NotificationSnapshot(
    packageName = pkg,
    notificationKey = "0|$pkg|1|$jid|10123",
    tag = jid,
    postTimeMillis = lines.maxOfOrNull { it.timestampMillis } ?: 0L,
    isGroupSummary = groupSummary,
    isGroupConversationFlag = groupFlag,
    conversationTitle = conversationTitle,
    shortcutId = shortcutId,
    title = title,
    messages = lines,
    hasReplyAction = true,
    isOngoing = ongoing,
    category = category,
)

internal fun keyOfJid(jid: String): ConversationKey = ConversationKeys.derive(wa(listOf(line("x", 1)), jid = jid))!!

/** Engine fake: records every request; the reply text names the conversation so cross-talk is visible. */
internal class RecordingEngine : DraftEngineClient {
    val requests: MutableList<DraftRequest> = Collections.synchronizedList(mutableListOf())
    var gate: CompletableDeferred<Unit>? = null
    var throwable: Throwable? = null
    var responder: (DraftRequest) -> DraftResult = { r ->
        DraftResult.Success("תשובה ל-" + r.messages.last().text, SafetyFlags(), "qa-fake")
    }

    override suspend fun requestDraft(request: DraftRequest): DraftResult {
        requests += request
        gate?.await()
        throwable?.let { throw it }
        return responder(request)
    }
}

/** Sender fake: counts attempts and records (conversation, exact text). Never touches anything real. */
internal class RecordingSender(var outcome: SendOutcome = SendOutcome.ATTEMPTED) : ReplySender {
    val calls = AtomicInteger(0)
    val sent: MutableList<Pair<ConversationKey, String>> = Collections.synchronizedList(mutableListOf())
    var gate: CompletableDeferred<Unit>? = null
    var throwable: Throwable? = null

    override suspend fun send(conversationKey: ConversationKey, text: String): SendOutcome {
        calls.incrementAndGet()
        sent += conversationKey to text
        gate?.await()
        throwable?.let { throw it }
        return outcome
    }
}

/** A coordinator on virtual time (TestScope.backgroundScope) with recording fakes. */
@OptIn(ExperimentalCoroutinesApi::class)
internal class QaBridge(
    private val test: TestScope,
    settings: BridgeSettings = READY,
    val engine: RecordingEngine = RecordingEngine(),
    val sender: RecordingSender = RecordingSender(),
) {
    private var ids = 0
    val coordinator: BridgeCoordinator = BridgeCoordinator.create(
        scope = test.backgroundScope,
        clock = Clock { test.testScheduler.currentTime },
        engine = engine,
        sender = sender,
        initialSettings = settings,
        idGenerator = { "qa-${++ids}" },
    )

    val drafts: List<Draft> get() = coordinator.drafts.value

    fun post(s: NotificationSnapshot) = coordinator.onNotification(s)

    fun advance(ms: Long) {
        test.advanceTimeBy(ms)
        test.runCurrent()
    }

    fun byId(id: String): Draft = drafts.single { it.id == id }

    /** The one non-terminal draft of [key] (fails if there is none or more than one). */
    fun activeOf(key: ConversationKey): Draft =
        drafts.single { it.conversationKey == key && it.state !in DraftStateMachine.terminalStates }

    fun activeOrNull(key: ConversationKey): Draft? =
        drafts.singleOrNull { it.conversationKey == key && it.state !in DraftStateMachine.terminalStates }

    /** Posts [s], waits out the 15 s debounce and returns the draft that is now awaiting approval. */
    fun awaiting(s: NotificationSnapshot): Draft {
        post(s)
        advance(DEBOUNCE)
        val d = activeOf(ConversationKeys.derive(s)!!)
        check(d.state == DraftState.AWAITING_APPROVAL) { "expected AWAITING_APPROVAL, was ${d.state}" }
        return d
    }
}
