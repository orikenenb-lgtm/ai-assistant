package ai.noa.bridge.core

/**
 * CONTRACT FILE (owned by Agent 04 — Chief Architect). Public signatures here are shared by the
 * core and app teams. Do not change them without recording the change in DECISION_LOG.md.
 */

/** Injectable time source so every timing rule (debounce, approval expiry, dedup TTL) is testable. */
fun interface Clock {
    fun nowMillis(): Long

    companion object {
        val SYSTEM: Clock = Clock { System.currentTimeMillis() }
    }
}

/**
 * Opaque, locally-derived identifier of one WhatsApp conversation. It is a SHA-256 hex digest
 * (see [ConversationKeys]) and never contains a phone number or name, so it is safe to send to
 * the bridge backend and to keep in memory.
 */
@JvmInline
value class ConversationKey(val value: String) {
    init {
        require(value.isNotBlank()) { "ConversationKey must not be blank" }
    }

    override fun toString(): String = "ConversationKey(${value.take(8)}…)"
}

enum class ChatKind { PRIVATE, GROUP, UNKNOWN }

/** One message line as read from a notification's MessagingStyle (or the EXTRA_TEXT fallback). */
data class SnapshotMessage(
    val sender: String?,
    val text: String?,
    val timestampMillis: Long,
    /** True when MessagingStyle marks the line as sent by the device owner (sender person == user). */
    val isFromSelf: Boolean,
)

/**
 * Platform-neutral copy of the fields the bridge reads from an Android StatusBarNotification.
 * The app module fills it in; the core never touches Android classes.
 */
data class NotificationSnapshot(
    val packageName: String,
    /** StatusBarNotification.key — stable per notification slot. */
    val notificationKey: String,
    val tag: String?,
    val postTimeMillis: Long,
    /** Notification.FLAG_GROUP_SUMMARY — the "N new messages" bundle header. */
    val isGroupSummary: Boolean,
    /** MessagingStyle.isGroupConversation / EXTRA_IS_GROUP_CONVERSATION; null when absent. */
    val isGroupConversationFlag: Boolean?,
    /** MessagingStyle conversation title / EXTRA_CONVERSATION_TITLE; groups usually set it. */
    val conversationTitle: String?,
    /** Notification shortcut id (conversation shortcut) when present. */
    val shortcutId: String?,
    /** EXTRA_TITLE (usually the contact's display name for private chats). */
    val title: String?,
    val messages: List<SnapshotMessage>,
    /** True when the notification has an action carrying a free-form RemoteInput. */
    val hasReplyAction: Boolean,
    /** FLAG_ONGOING_EVENT / foreground-service notifications (calls, backups, "checking for messages"). */
    val isOngoing: Boolean,
    /** Notification.category, e.g. "msg", "call". */
    val category: String?,
)

/** A message that passed every filter and belongs to one private conversation. */
data class IncomingMessage(
    /** Deterministic id used for de-duplication (see [EventIds]). */
    val eventId: String,
    val conversationKey: ConversationKey,
    val senderDisplayName: String,
    val text: String,
    val timestampMillis: Long,
)

enum class RejectReason {
    NOT_WHATSAPP,
    GROUP,
    /** We could not reliably tell private from group — fail closed. */
    UNKNOWN_CHAT_KIND,
    GROUP_SUMMARY,
    ONGOING_OR_SYSTEM,
    EXCLUDED,
    NO_CONTENT,
    /** Content hidden by the user's lock-screen / WhatsApp privacy settings ("1 new message"). */
    HIDDEN_CONTENT,
    FROM_SELF,
    PAUSED,
    DUPLICATE,
}

sealed interface FilterResult {
    data class Accepted(val conversationKey: ConversationKey, val messages: List<IncomingMessage>) : FilterResult
    data class Rejected(val reason: RejectReason) : FilterResult
}

/** Explicit state machine of a draft. See [DraftStateMachine] for the allowed transitions. */
enum class DraftState {
    RECEIVED,
    FILTERED,
    DEBOUNCING,
    PROCESSING,
    DRAFT_READY,
    AWAITING_APPROVAL,
    APPROVED,
    CANCELLED,
    EXPIRED,
    SENDING,
    SEND_ATTEMPTED,
    FAILED,
    UNKNOWN_RESULT,
}

data class SafetyFlags(
    /** The incoming text looks like it tries to instruct the AI ("ignore your instructions"...). */
    val injectionSuspected: Boolean = false,
    /** The incoming text asks for secrets, codes, money, personal data. */
    val sensitiveRequest: Boolean = false,
    val notes: List<String> = emptyList(),
)

/**
 * An approval binds ONE draft revision, ONE exact final text and ONE conversation. Any change to
 * any of these invalidates it. It is single-use and short-lived.
 */
data class Approval(
    val token: String,
    val draftId: String,
    val revision: Int,
    val conversationKey: ConversationKey,
    /** SHA-256 hex of the exact text the user saw when approving. */
    val textSha256: String,
    val issuedAtMillis: Long,
    val expiresAtMillis: Long,
)

data class Draft(
    val id: String,
    val conversationKey: ConversationKey,
    val senderDisplayName: String,
    val sourceMessages: List<IncomingMessage>,
    /** Text proposed by NOA (null until the engine answered). */
    val proposedText: String?,
    /** Text after the user edited it (null = not edited). */
    val editedText: String?,
    val state: DraftState,
    /** Incremented on every content change (new message, edit). Approvals are bound to it. */
    val revision: Int,
    val createdAtMillis: Long,
    val updatedAtMillis: Long,
    val safety: SafetyFlags = SafetyFlags(),
    val approval: Approval? = null,
    /** Human-readable (Hebrew) reason for FAILED / EXPIRED / UNKNOWN_RESULT; never message content. */
    val statusDetail: String? = null,
) {
    /** The text that would actually be sent. */
    val finalText: String? get() = editedText ?: proposedText
}

data class DraftRequest(
    /** Unique per request; the backend uses it as an idempotency key. */
    val requestId: String,
    val conversationKey: ConversationKey,
    val senderDisplayName: String,
    val messages: List<IncomingMessage>,
)

sealed interface DraftResult {
    data class Success(val text: String, val safety: SafetyFlags, val engine: String) : DraftResult
    data class Failure(val reason: String, val retryable: Boolean) : DraftResult
}

/** Something that turns a conversation burst into a proposed reply (the bridge backend client). */
fun interface DraftEngineClient {
    suspend fun requestDraft(request: DraftRequest): DraftResult
}

/**
 * Result of handing a reply to WhatsApp's own notification Reply action.
 * There is deliberately no "DELIVERED": Android gives no delivery confirmation for RemoteInput.
 */
enum class SendOutcome {
    /** PendingIntent.send() returned without error. The message MAY have been sent. */
    ATTEMPTED,
    /** No live reply action for this conversation (notification gone, process restarted...). */
    FAILED_NO_ACTION,
    /** The PendingIntent was cancelled by WhatsApp (CanceledException). */
    FAILED_CANCELED,
    /** Anything else — we do not know whether it was sent. Never retried automatically. */
    UNKNOWN,
}

/** Implemented by the app (RemoteInput). The core calls it only with a validated approval. */
fun interface ReplySender {
    suspend fun send(conversationKey: ConversationKey, text: String): SendOutcome
}

/** User-controlled settings the core needs. Persisted by the app. */
data class BridgeSettings(
    val paused: Boolean = false,
    val emergencyStopped: Boolean = false,
    /** User consented to sending message content to the AI backend. Without it nothing is sent out. */
    val cloudConsentGiven: Boolean = false,
    /** Experimental send path explicitly enabled by the user. Off by default. */
    val sendingEnabled: Boolean = false,
    val excludedConversations: Set<ConversationKey> = emptySet(),
    val debounceMillis: Long = DEFAULT_DEBOUNCE_MILLIS,
) {
    companion object {
        const val DEFAULT_DEBOUNCE_MILLIS = 15_000L
    }
}
