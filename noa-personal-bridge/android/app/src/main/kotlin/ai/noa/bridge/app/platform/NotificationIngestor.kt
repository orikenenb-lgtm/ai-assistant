package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ContentVisibility
import ai.noa.bridge.core.ConversationFilter
import ai.noa.bridge.core.ConversationKey
import ai.noa.bridge.core.ConversationKeys
import ai.noa.bridge.core.NotificationSnapshot
import android.service.notification.NotificationListenerService

/**
 * The listener service's logic, separated from the Service so it can be tested with fakes.
 * Cheap and synchronous: no network, no disk, no wake locks. The coordinator does its own
 * asynchronous work on the application scope.
 */
class NotificationIngestor(
    private val registry: ReplyActionRegistry,
    private val onNotification: (NotificationSnapshot) -> Unit,
    private val onConversationRemoved: (ConversationKey) -> Unit,
    private val deriveKey: (NotificationSnapshot) -> ConversationKey? = ConversationKeys::derive,
    /**
     * True when the core filter would accept this snapshot (production: ConversationFilter.evaluate
     * with the current settings is FilterResult.Accepted). Reply handles are only kept for those.
     */
    private val wouldAccept: (NotificationSnapshot) -> Boolean = { true },
    /**
     * Receives the snapshots showing when the listener (re)connects so their lines are marked as
     * seen (production: BridgeCoordinator.seedSeen) and are never sent to the backend again (S-L7).
     */
    private val onSeed: (List<NotificationSnapshot>) -> Unit = {},
) {

    /** Only personal WhatsApp (not WhatsApp Business, not a Samsung Dual Messenger / work-profile clone). */
    fun accepts(packageName: String, isSameUser: Boolean): Boolean =
        isSameUser && packageName == ConversationFilter.WHATSAPP_PACKAGE

    fun onPosted(mapped: MappedNotification) {
        val snapshot = mapped.snapshot
        registerReplyAction(mapped)
        onNotification(snapshot)
    }

    /** Refreshes reply handles only (e.g. for notifications already showing when the listener connects). */
    fun registerReplyAction(mapped: MappedNotification) {
        val snapshot = mapped.snapshot
        // Never reply through a redacted / placeholder notification (Android 15+ sensitive-content
        // redaction, "2 new messages"), and do not keep the OLDER handle either (S-M1): the
        // conversation now has a message nobody read, so any reply prepared before it is stale.
        if (isHiddenContent(mapped)) {
            val removed = (listOfNotNull(deriveKey(snapshot)?.takeIf { registry.remove(it) != null }) +
                registry.removeByNotificationKey(snapshot.notificationKey)).toSet()
            if (removed.isNotEmpty()) SafeLog.i(SafeLog.Event.NOTIFICATION_HIDDEN_HANDLE_REMOVED, removed.size)
            return
        }
        val action = mapped.replyAction
        val hasChatTarget = mapped.contentIntent != null || mapped.chatPhoneDigits != null
        if (action == null && !hasChatTarget) return
        // Cheap local guard; the core filter is the authority on private vs. group.
        if (snapshot.isGroupSummary || snapshot.isOngoing || snapshot.isGroupConversationFlag == true) return
        if (!wouldAccept(snapshot)) return
        val key = deriveKey(snapshot)
        if (key == null) {
            SafeLog.i(SafeLog.Event.NOTIFICATION_NO_KEY)
            return
        }
        if (action != null) {
            registry.put(
                key,
                ReplyHandle(
                    pendingIntent = action.pendingIntent,
                    remoteInputs = action.remoteInputs,
                    notificationKey = snapshot.notificationKey,
                    postTimeMillis = snapshot.postTimeMillis,
                ),
            )
            SafeLog.i(SafeLog.Event.REPLY_HANDLE_STORED, registry.size)
        }
        // D-020: how to open this chat in WhatsApp itself. Memory only; the phone digits are never
        // logged (SafeLog takes no strings), persisted or sent to the backend.
        if (hasChatTarget) {
            registry.putChatTarget(
                key,
                ChatTarget(
                    phoneDigits = mapped.chatPhoneDigits,
                    contentIntent = mapped.contentIntent,
                    notificationKey = snapshot.notificationKey,
                    postTimeMillis = snapshot.postTimeMillis,
                ),
            )
            SafeLog.i(SafeLog.Event.CHAT_TARGET_STORED, registry.chatTargetCount)
        }
    }

    /**
     * Rebuilds the registry from the notifications currently showing (on listener connect). Reply
     * handles only: old messages are NOT fed to the coordinator, so no drafts are made for old chats.
     */
    fun rebuildFrom(active: List<MappedNotification>) {
        registry.clear()
        active.forEach { registerReplyAction(it) }
        // Old unread lines must not reach the backend after a restart (the dedup is memory-only).
        onSeed(active.map { it.snapshot })
        SafeLog.i(SafeLog.Event.LISTENER_SEEDED, active.size)
    }

    fun onRemoved(mapped: MappedNotification, reason: Int) {
        val snapshot = mapped.snapshot
        val removed = registry.removeByNotificationKey(snapshot.notificationKey)
        if (removed.isNotEmpty()) SafeLog.i(SafeLog.Event.REPLY_HANDLE_REMOVED, removed.size)
        SafeLog.i(SafeLog.Event.NOTIFICATION_REMOVED, reason)
        if (snapshot.isGroupSummary || reason !in USER_OR_APP_REMOVAL_REASONS) return
        val key = deriveKey(snapshot) ?: removed.firstOrNull() ?: return
        onConversationRemoved(key)
    }

    /** Same rule as the core filter's HIDDEN_CONTENT, from the single shared detector. */
    private fun isHiddenContent(mapped: MappedNotification): Boolean {
        val snapshot = mapped.snapshot
        if (mapped.isLikelyRedacted || ContentVisibility.isRedactedSnapshot(snapshot)) return true
        val nonBlank = snapshot.messages.mapNotNull { m -> m.text?.takeIf { it.isNotBlank() } }
        return nonBlank.size == 1 && ContentVisibility.isHiddenPlaceholder(nonBlank.single())
    }

    companion object {
        /**
         * Removal reasons meaning "the user opened/answered/dismissed this chat, or WhatsApp itself
         * withdrew the notification". Others (timeout, snooze, channel banned, listener cancel,
         * group-summary cascade...) only drop the reply handle.
         */
        val USER_OR_APP_REMOVAL_REASONS: Set<Int> = setOf(
            NotificationListenerService.REASON_CLICK,
            NotificationListenerService.REASON_CANCEL,
            NotificationListenerService.REASON_CANCEL_ALL,
            NotificationListenerService.REASON_APP_CANCEL,
            NotificationListenerService.REASON_APP_CANCEL_ALL,
        )
    }
}
