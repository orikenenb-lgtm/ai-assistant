package ai.noa.bridge.core

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * CONTRACT FILE (Agent 04). Signatures are fixed; Agent 07 (core) implements bodies, Agent 06's
 * app team consumes them. Implementations live in the same package, in files owned by the core team.
 */

/** Stable, privacy-preserving identifiers. */
object ConversationKeys {
    /**
     * Derives a ConversationKey from the most stable identity available, in this order:
     * shortcutId, tag, conversationTitle/title. Returns null when nothing stable exists.
     * Output is SHA-256 hex of "packageName|kind|identity", never the raw identity.
     */
    fun derive(snapshot: NotificationSnapshot): ConversationKey? = ConversationKeysImpl.derive(snapshot)
}

object EventIds {
    /** Deterministic per (conversation, message timestamp, sender, text) so re-posted notifications dedupe. */
    fun of(key: ConversationKey, message: SnapshotMessage): String = EventIdsImpl.of(key, message)
}

/** Classifies a snapshot and decides whether it may be processed. Fail-closed on any doubt. */
interface ConversationFilter {
    fun classify(snapshot: NotificationSnapshot): ChatKind
    fun evaluate(snapshot: NotificationSnapshot, settings: BridgeSettings): FilterResult

    companion object {
        const val WHATSAPP_PACKAGE = "com.whatsapp"
        fun create(allowedPackages: Set<String> = setOf(WHATSAPP_PACKAGE)): ConversationFilter =
            DefaultConversationFilter(allowedPackages)
    }
}

/** Bounded, TTL-based set of already-seen event ids. Thread-safe. */
interface Deduplicator {
    /** Returns true if [eventId] was already seen (and records it otherwise). */
    fun checkAndRecord(eventId: String): Boolean
    fun clear()

    companion object {
        fun create(clock: Clock, capacity: Int = 2_000, ttlMillis: Long = 6 * 60 * 60 * 1000L): Deduplicator =
            LruDeduplicator(clock, capacity, ttlMillis)
    }
}

object DraftStateMachine {
    fun canTransition(from: DraftState, to: DraftState): Boolean = DraftStateMachineImpl.canTransition(from, to)

    /** Throws IllegalStateException on an illegal transition. */
    fun requireTransition(from: DraftState, to: DraftState) {
        check(canTransition(from, to)) { "Illegal draft transition $from -> $to" }
    }

    val terminalStates: Set<DraftState>
        get() = DraftStateMachineImpl.terminalStates
}

sealed interface ApprovalCheck {
    data object Valid : ApprovalCheck
    data class Invalid(val reason: String) : ApprovalCheck
}

/** Issues and validates single-use approvals bound to (draft id, revision, conversation, exact text). */
interface ApprovalGuard {
    fun issue(draft: Draft, finalText: String): Approval
    fun validate(approval: Approval, draft: Draft, finalText: String): ApprovalCheck
    /** Marks the token used. A consumed token never validates again. */
    fun consume(approval: Approval)

    companion object {
        fun create(clock: Clock, ttlMillis: Long = 2 * 60 * 1000L): ApprovalGuard = DefaultApprovalGuard(clock, ttlMillis)
    }
}

/**
 * Per-conversation debounce: every new message for a key restarts that key's timer; after
 * [delayMillis] of silence [onFire] receives all messages buffered for that key. Keys are independent.
 */
interface ConversationDebouncer {
    fun submit(message: IncomingMessage)
    fun cancel(key: ConversationKey)
    fun cancelAll()
    fun pendingKeys(): Set<ConversationKey>

    companion object {
        fun create(
            scope: CoroutineScope,
            delayMillis: () -> Long,
            onFire: suspend (ConversationKey, List<IncomingMessage>) -> Unit,
        ): ConversationDebouncer = CoroutineConversationDebouncer(scope, delayMillis, onFire)
    }
}

/**
 * The single orchestrator the app talks to. It owns all drafts (in memory only — nothing is
 * persisted), enforces the state machine, and is the ONLY component that may call [ReplySender].
 */
interface BridgeCoordinator {
    val drafts: StateFlow<List<Draft>>

    /** Entry point for every notification the listener sees. */
    fun onNotification(snapshot: NotificationSnapshot)

    /** The notification for a conversation was removed (user opened/answered the chat elsewhere). */
    fun onNotificationRemoved(conversationKey: ConversationKey)

    fun updateSettings(settings: BridgeSettings)

    /** User edited the text. Bumps revision and invalidates any approval. */
    fun edit(draftId: String, newText: String)

    /** User cancelled. Nothing is ever sent for a cancelled draft. */
    fun cancel(draftId: String)

    /**
     * Step 1 of sending: the UI shows [finalText] and the user confirms → returns the approval
     * (or null if the draft is not in a state that can be approved).
     */
    fun approve(draftId: String, finalText: String): Approval?

    /**
     * Step 2: validates the approval against the current draft and, only if valid and sending is
     * enabled, performs exactly one send attempt. Never retries. Returns the resulting draft state.
     */
    suspend fun sendApproved(approval: Approval): DraftState

    /** Stops everything: cancels timers and in-flight requests, expires all drafts, blocks sending. */
    fun emergencyStop()

    /** Removes all drafts from memory. */
    fun clearAll()

    companion object {
        fun create(
            scope: CoroutineScope,
            clock: Clock,
            engine: DraftEngineClient,
            sender: ReplySender,
            initialSettings: BridgeSettings = BridgeSettings(),
            filter: ConversationFilter = ConversationFilter.create(),
            idGenerator: () -> String = { java.util.UUID.randomUUID().toString() },
        ): BridgeCoordinator = DefaultBridgeCoordinator(scope, clock, engine, sender, initialSettings, filter, idGenerator)
    }
}
