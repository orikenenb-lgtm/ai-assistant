package ai.noa.bridge.core

import kotlinx.coroutines.CoroutineScope

// TEMPORARY stubs so the contract compiles. Agent 07 replaces this file with real implementations
// (one file per class is preferred) and deletes it.
internal object ConversationKeysImpl { fun derive(snapshot: NotificationSnapshot): ConversationKey? = TODO() }
internal object EventIdsImpl { fun of(key: ConversationKey, message: SnapshotMessage): String = TODO() }
internal class DefaultConversationFilter(val allowedPackages: Set<String>) : ConversationFilter {
    override fun classify(snapshot: NotificationSnapshot): ChatKind = TODO()
    override fun evaluate(snapshot: NotificationSnapshot, settings: BridgeSettings): FilterResult = TODO()
}
internal class LruDeduplicator(val clock: Clock, val capacity: Int, val ttlMillis: Long) : Deduplicator {
    override fun checkAndRecord(eventId: String): Boolean = TODO()
    override fun clear() = TODO()
}
internal object DraftStateMachineImpl {
    fun canTransition(from: DraftState, to: DraftState): Boolean = TODO()
    val terminalStates: Set<DraftState> get() = TODO()
}
internal class DefaultApprovalGuard(val clock: Clock, val ttlMillis: Long) : ApprovalGuard {
    override fun issue(draft: Draft, finalText: String): Approval = TODO()
    override fun validate(approval: Approval, draft: Draft, finalText: String): ApprovalCheck = TODO()
    override fun consume(approval: Approval) = TODO()
}
internal class CoroutineConversationDebouncer(
    val scope: CoroutineScope,
    val delayMillis: () -> Long,
    val onFire: suspend (ConversationKey, List<IncomingMessage>) -> Unit,
) : ConversationDebouncer {
    override fun submit(message: IncomingMessage) = TODO()
    override fun cancel(key: ConversationKey) = TODO()
    override fun cancelAll() = TODO()
    override fun pendingKeys(): Set<ConversationKey> = TODO()
}
internal class DefaultBridgeCoordinator(
    val scope: CoroutineScope,
    val clock: Clock,
    val engine: DraftEngineClient,
    val sender: ReplySender,
    val initialSettings: BridgeSettings,
    val filter: ConversationFilter,
    val idGenerator: () -> String,
) : BridgeCoordinator {
    override val drafts get() = TODO()
    override fun onNotification(snapshot: NotificationSnapshot) = TODO()
    override fun onNotificationRemoved(conversationKey: ConversationKey) = TODO()
    override fun updateSettings(settings: BridgeSettings) = TODO()
    override fun edit(draftId: String, newText: String) = TODO()
    override fun cancel(draftId: String) = TODO()
    override fun approve(draftId: String, finalText: String): Approval? = TODO()
    override suspend fun sendApproved(approval: Approval): DraftState = TODO()
    override fun emergencyStop() = TODO()
    override fun clearAll() = TODO()
}
