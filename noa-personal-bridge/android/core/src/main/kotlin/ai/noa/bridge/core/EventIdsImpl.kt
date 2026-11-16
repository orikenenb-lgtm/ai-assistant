package ai.noa.bridge.core

/**
 * Deterministic event id: `sha256Hex("${key.value}|$timestampMillis|$sender|$text")`.
 * The same MessagingStyle line re-posted in a later notification yields the same id, so the
 * coordinator can drop history it has already seen. Contains no raw content (hash only).
 */
internal object EventIdsImpl {
    fun of(key: ConversationKey, message: SnapshotMessage): String =
        Hashing.sha256Hex("${key.value}|${message.timestampMillis}|${message.sender}|${message.text}")
}
