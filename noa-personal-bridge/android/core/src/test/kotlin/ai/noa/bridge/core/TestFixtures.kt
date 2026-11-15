package ai.noa.bridge.core

import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.atomic.AtomicInteger

const val CONTACT_JID = "972501234567@s.whatsapp.net"
const val OTHER_JID = "972509999999@s.whatsapp.net"

fun msg(text: String?, ts: Long, sender: String? = "Dana", self: Boolean = false) =
    SnapshotMessage(sender = sender, text = text, timestampMillis = ts, isFromSelf = self)

fun snapshot(
    messages: List<SnapshotMessage> = listOf(msg("hi", 1_000)),
    packageName: String = ConversationFilter.WHATSAPP_PACKAGE,
    tag: String? = CONTACT_JID,
    shortcutId: String? = null,
    title: String? = "Dana",
    conversationTitle: String? = null,
    isGroupConversationFlag: Boolean? = false,
    isGroupSummary: Boolean = false,
    isOngoing: Boolean = false,
    category: String? = "msg",
) = NotificationSnapshot(
    packageName = packageName,
    notificationKey = "0|com.whatsapp|1|$tag|10001",
    tag = tag,
    postTimeMillis = messages.maxOfOrNull { it.timestampMillis } ?: 0L,
    isGroupSummary = isGroupSummary,
    isGroupConversationFlag = isGroupConversationFlag,
    conversationTitle = conversationTitle,
    shortcutId = shortcutId,
    title = title,
    messages = messages,
    hasReplyAction = true,
    isOngoing = isOngoing,
    category = category,
)

fun keyOf(s: NotificationSnapshot): ConversationKey = ConversationKeys.derive(s)!!

/** Draft engine fake: records requests; optionally suspends until [gate] completes. */
class FakeEngine(
    var result: DraftResult = DraftResult.Success("reply text", SafetyFlags(), "fake"),
) : DraftEngineClient {
    val requests = mutableListOf<DraftRequest>()
    var gate: CompletableDeferred<Unit>? = null
    var throwable: Throwable? = null
    var results: ArrayDeque<DraftResult>? = null

    override suspend fun requestDraft(request: DraftRequest): DraftResult {
        requests += request
        gate?.await()
        throwable?.let { throw it }
        return results?.removeFirstOrNull() ?: result
    }
}

class FakeSender(var outcome: SendOutcome = SendOutcome.ATTEMPTED) : ReplySender {
    val calls = AtomicInteger(0)
    val sent = mutableListOf<Pair<ConversationKey, String>>()
    var gate: CompletableDeferred<Unit>? = null
    var throwable: Throwable? = null

    override suspend fun send(conversationKey: ConversationKey, text: String): SendOutcome {
        calls.incrementAndGet()
        synchronized(sent) { sent += conversationKey to text }
        gate?.await()
        throwable?.let { throw it }
        return outcome
    }
}

fun incoming(key: ConversationKey, text: String, ts: Long) = IncomingMessage(
    eventId = EventIds.of(key, msg(text, ts)),
    conversationKey = key,
    senderDisplayName = "Dana",
    text = text,
    timestampMillis = ts,
)

fun draftOf(
    key: ConversationKey,
    state: DraftState = DraftState.APPROVED,
    revision: Int = 1,
    proposed: String? = "reply text",
    edited: String? = null,
    id: String = "d1",
) = Draft(
    id = id,
    conversationKey = key,
    senderDisplayName = "Dana",
    sourceMessages = emptyList(),
    proposedText = proposed,
    editedText = edited,
    state = state,
    revision = revision,
    createdAtMillis = 0,
    updatedAtMillis = 0,
)

/**
 * advanceUntilIdle() ignores backgroundScope work, so tests advance virtual time explicitly:
 * 61 s covers the 15 s debounce plus the 45 s engine timeout, and stays below the 2 min approval TTL.
 */
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
fun kotlinx.coroutines.test.TestScope.settle() {
    testScheduler.advanceTimeBy(61_000)
    testScheduler.runCurrent()
}
