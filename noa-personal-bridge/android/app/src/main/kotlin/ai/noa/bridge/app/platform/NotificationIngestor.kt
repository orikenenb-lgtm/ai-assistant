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
        val action = mapped.replyAction ?: return
        // Never reply through a redacted notification (Android 15+ sensitive-content redaction).
        if (mapped.isLikelyRedacted || ContentVisibility.isRedactedSnapshot(snapshot)) return
        // Cheap local guard; the core filter is the authority on private vs. group.
        if (snapshot.isGroupSummary || snapshot.isOngoing || snapshot.isGroupConversationFlag == true) return
        if (!wouldAccept(snapshot)) return
        val key = deriveKey(snapshot)
        if (key == null) {
            SafeLog.i(SafeLog.Event.NOTIFICATION_NO_KEY)
            return
        }
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

    /**
     * Rebuilds the registry from the notifications currently showing (on listener connect). Reply
     * handles only: old messages are NOT fed to the coordinator, so no drafts are made for old chats.
     */
    fun rebuildFrom(active: List<MappedNotification>) {
        registry.clear()
        active.forEach { registerReplyAction(it) }
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
