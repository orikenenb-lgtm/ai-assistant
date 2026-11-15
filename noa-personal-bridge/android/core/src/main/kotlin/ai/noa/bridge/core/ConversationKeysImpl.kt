package ai.noa.bridge.core

/**
 * Derives the opaque [ConversationKey] of a notification.
 *
 * Identity priority (first non-blank wins): shortcutId → tag → conversationTitle → title.
 * Output: `sha256Hex("$packageName|$identity")` — the raw identity (phone JID, contact name) never
 * leaves this function. Note: the KDoc on [ConversationKeys.derive] mentions a `kind` component;
 * the implemented (and agreed) format is `packageName|identity` without kind, so that a chat's key
 * does not change when its classification changes.
 */
internal object ConversationKeysImpl {
    fun derive(snapshot: NotificationSnapshot): ConversationKey? {
        val identity = sequenceOf(
            snapshot.shortcutId,
            snapshot.tag,
            snapshot.conversationTitle,
            snapshot.title,
        ).firstOrNull { !it.isNullOrBlank() }?.trim() ?: return null
        return ConversationKey(Hashing.sha256Hex("${snapshot.packageName}|$identity"))
    }
}
