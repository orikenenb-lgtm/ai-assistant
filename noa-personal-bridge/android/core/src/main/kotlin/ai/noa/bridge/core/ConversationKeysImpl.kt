package ai.noa.bridge.core

/**
 * Derives the opaque [ConversationKey] of a notification.
 *
 * Identity priority (first non-blank wins): shortcutId → tag. Fail closed: a display name
 * (conversationTitle / title) is NOT an identity — two contacts can share one — so a notification
 * with neither shortcutId nor tag has no key (null → the filter rejects it as UNKNOWN_CHAT_KIND).
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
        ).firstOrNull { !it.isNullOrBlank() }?.trim() ?: return null
        return ConversationKey(Hashing.sha256Hex("${snapshot.packageName}|$identity"))
    }
}
