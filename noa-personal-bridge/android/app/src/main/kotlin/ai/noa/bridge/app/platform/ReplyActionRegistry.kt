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
 * In-memory, thread-safe map ConversationKey → [ReplyHandle].
 *
 * - Updated on every posted notification that carries a free-form reply action.
 * - Entries are removed when the notification is removed and after ONE send attempt ([take]).
 * - Nothing is persisted: PendingIntents cannot be persisted, so after process death there is no
 *   handle until WhatsApp posts/updates the conversation's notification again, and a send reports
 *   FAILED_NO_ACTION.
 * - Bounded to [maxEntries]; the entry with the oldest post time is evicted first.
 */
class ReplyActionRegistry(private val maxEntries: Int = DEFAULT_MAX_ENTRIES) {
    init {
        require(maxEntries > 0)
    }

    private val lock = Any()
    private val handles = LinkedHashMap<ConversationKey, ReplyHandle>()

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

    /** Returns and removes the handle: a handle is used for at most one send attempt. */
    fun take(key: ConversationKey): ReplyHandle? = synchronized(lock) { handles.remove(key) }

    fun remove(key: ConversationKey): ReplyHandle? = synchronized(lock) { handles.remove(key) }

    /** Removes every entry that came from the notification [notificationKey]; returns their conversation keys. */
    fun removeByNotificationKey(notificationKey: String): Set<ConversationKey> = synchronized(lock) {
        val keys = handles.filterValues { it.notificationKey == notificationKey }.keys.toSet()
        keys.forEach { handles.remove(it) }
        keys
    }

    fun clear() = synchronized(lock) { handles.clear() }

    val size: Int get() = synchronized(lock) { handles.size }

    companion object {
        const val DEFAULT_MAX_ENTRIES = 50
    }
}
