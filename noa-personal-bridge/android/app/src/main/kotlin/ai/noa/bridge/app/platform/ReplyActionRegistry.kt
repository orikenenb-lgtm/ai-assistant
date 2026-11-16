package ai.noa.bridge.app.platform

import ai.noa.bridge.core.ConversationKey
import android.app.PendingIntent
import android.app.RemoteInput

/** WhatsApp's live reply action for one conversation, as last seen in a posted notification. */
class ReplyHandle(
    val pendingIntent: PendingIntent,
    val remoteInputs: Array<RemoteInput>,
    val notificationKey: String,
    val postTimeMillis: Long,
)

/**
 * How to open one conversation inside WhatsApp itself (D-020), as last seen in a posted notification:
 * the chat's phone digits (only from a `<digits>@s.whatsapp.net` JID) and/or the notification's
 * contentIntent. Memory only: never persisted, logged or sent to the backend.
 */
class ChatTarget(
    val phoneDigits: String?,
    val contentIntent: PendingIntent?,
    val notificationKey: String,
    val postTimeMillis: Long,
) {
    /** Never prints the phone number. */
    override fun toString(): String =
        "ChatTarget(hasPhone=${phoneDigits != null}, hasContentIntent=${contentIntent != null})"
}

/**
 * In-memory, thread-safe map ConversationKey → [ReplyHandle], plus ConversationKey → [ChatTarget].
 *
 * - Updated on every posted notification that carries a free-form reply action.
 * - Entries are removed when the notification is removed and after ONE send attempt ([take]).
 * - Nothing is persisted: PendingIntents cannot be persisted, so after process death there is no
 *   handle until WhatsApp posts/updates the conversation's notification again, and a send reports
 *   FAILED_NO_ACTION.
 * - Bounded to [maxEntries]; the entry with the oldest post time is evicted first.
 * - [ChatTarget]s follow the same rules (removed with the notification, on hidden content, on
 *   [remove] / [clear], same bound and eviction), except that [take] does not touch them: opening a
 *   chat in WhatsApp is not a send attempt.
 */
class ReplyActionRegistry(private val maxEntries: Int = DEFAULT_MAX_ENTRIES) {
    init {
        require(maxEntries > 0)
    }

    private val lock = Any()
    private val handles = LinkedHashMap<ConversationKey, ReplyHandle>()
    private val chatTargets = LinkedHashMap<ConversationKey, ChatTarget>()

    fun put(key: ConversationKey, handle: ReplyHandle) {
        synchronized(lock) {
            handles.remove(key)
            handles[key] = handle
            while (handles.size > maxEntries) {
                val oldest = handles.entries.minByOrNull { it.value.postTimeMillis }?.key ?: break
                handles.remove(oldest)
                SafeLog.i(SafeLog.Event.REPLY_HANDLE_EVICTED)
            }
        }
    }

    fun get(key: ConversationKey): ReplyHandle? = synchronized(lock) { handles[key] }

    fun putChatTarget(key: ConversationKey, target: ChatTarget) {
        synchronized(lock) {
            chatTargets.remove(key)
            chatTargets[key] = target
            while (chatTargets.size > maxEntries) {
                val oldest = chatTargets.entries.minByOrNull { it.value.postTimeMillis }?.key ?: break
                chatTargets.remove(oldest)
            }
        }
    }

    fun chatTarget(key: ConversationKey): ChatTarget? = synchronized(lock) { chatTargets[key] }

    /** Returns and removes the handle: a handle is used for at most one send attempt. */
    fun take(key: ConversationKey): ReplyHandle? = synchronized(lock) { handles.remove(key) }

    /** Removes the conversation's reply handle and chat target; returns the reply handle. */
    fun remove(key: ConversationKey): ReplyHandle? = synchronized(lock) {
        chatTargets.remove(key)
        handles.remove(key)
    }

    /**
     * Removes every reply handle and chat target that came from the notification [notificationKey];
     * returns the conversation keys of the removed reply handles.
     */
    fun removeByNotificationKey(notificationKey: String): Set<ConversationKey> = synchronized(lock) {
        chatTargets.filterValues { it.notificationKey == notificationKey }.keys.toList().forEach { chatTargets.remove(it) }
        val keys = handles.filterValues { it.notificationKey == notificationKey }.keys.toSet()
        keys.forEach { handles.remove(it) }
        keys
    }

    fun clear() = synchronized(lock) {
        handles.clear()
        chatTargets.clear()
    }

    /** Number of reply handles. */
    val size: Int get() = synchronized(lock) { handles.size }

    val chatTargetCount: Int get() = synchronized(lock) { chatTargets.size }

    companion object {
        const val DEFAULT_MAX_ENTRIES = 50
    }
}
