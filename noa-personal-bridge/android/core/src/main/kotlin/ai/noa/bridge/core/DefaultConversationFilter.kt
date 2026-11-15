package ai.noa.bridge.core

/**
 * Fail-closed classifier for WhatsApp notifications. Only notifications that are positively
 * identified as a private chat, with readable content whose latest line came from the other
 * person, are accepted.
 *
 * Evaluation order (first match wins):
 * 1. package not in [allowedPackages] → [RejectReason.NOT_WHATSAPP]
 * 2. ongoing notification or category "call" → [RejectReason.ONGOING_OR_SYSTEM]
 * 3. group summary (bundle header) → [RejectReason.GROUP_SUMMARY]
 * 4. emergency stop / paused → [RejectReason.PAUSED]
 * 5. [classify] GROUP → [RejectReason.GROUP]; UNKNOWN → [RejectReason.UNKNOWN_CHAT_KIND]
 * 6. no stable conversation key → [RejectReason.UNKNOWN_CHAT_KIND]
 * 7. excluded conversation → [RejectReason.EXCLUDED]
 * 8. no messages / only blank text → [RejectReason.NO_CONTENT]
 * 9. single placeholder line ("2 new messages") → [RejectReason.HIDDEN_CONTENT]
 * 10. latest line (by timestamp) is from the device owner → [RejectReason.FROM_SELF]
 * 11. otherwise Accepted with the last [MAX_MESSAGES] non-self, non-blank lines.
 *
 * [RejectReason.DUPLICATE] is never produced here; the coordinator de-duplicates.
 */
internal class DefaultConversationFilter(val allowedPackages: Set<String>) : ConversationFilter {

    override fun classify(snapshot: NotificationSnapshot): ChatKind {
        val ids = listOfNotNull(snapshot.tag, snapshot.shortcutId)
        val distinctOtherSenders = snapshot.messages
            .asSequence()
            .filter { !it.isFromSelf }
            .mapNotNull { it.sender?.trim()?.takeIf(String::isNotEmpty) }
            .distinct()
            .count()
        val convTitle = snapshot.conversationTitle?.trim().orEmpty()
        val title = snapshot.title?.trim().orEmpty()

        val groupSignal = snapshot.isGroupConversationFlag == true ||
            ids.any { it.contains(GROUP_JID_SUFFIX) } ||
            distinctOtherSenders > 1 ||
            (convTitle.isNotEmpty() && title.isNotEmpty() && convTitle != title)
        if (groupSignal) return ChatKind.GROUP

        val privateSignal = snapshot.isGroupConversationFlag == false ||
            ids.any { it.contains(PRIVATE_JID_SUFFIX) }
        return if (privateSignal) ChatKind.PRIVATE else ChatKind.UNKNOWN
    }

    override fun evaluate(snapshot: NotificationSnapshot, settings: BridgeSettings): FilterResult {
        if (snapshot.packageName !in allowedPackages) return reject(RejectReason.NOT_WHATSAPP)
        if (snapshot.isOngoing || snapshot.category == CATEGORY_CALL) return reject(RejectReason.ONGOING_OR_SYSTEM)
        if (snapshot.isGroupSummary) return reject(RejectReason.GROUP_SUMMARY)
        if (settings.emergencyStopped || settings.paused) return reject(RejectReason.PAUSED)

        when (classify(snapshot)) {
            ChatKind.GROUP -> return reject(RejectReason.GROUP)
            ChatKind.UNKNOWN -> return reject(RejectReason.UNKNOWN_CHAT_KIND)
            ChatKind.PRIVATE -> Unit
        }

        val key = ConversationKeys.derive(snapshot) ?: return reject(RejectReason.UNKNOWN_CHAT_KIND)
        if (key in settings.excludedConversations) return reject(RejectReason.EXCLUDED)

        val nonBlank = snapshot.messages.filter { !it.text.isNullOrBlank() }
        if (nonBlank.isEmpty()) return reject(RejectReason.NO_CONTENT)
        if (nonBlank.size == 1 && isHiddenPlaceholder(nonBlank.single().text!!)) {
            return reject(RejectReason.HIDDEN_CONTENT)
        }

        // sortedBy is stable: on equal timestamps the later list entry counts as "last".
        val ordered = snapshot.messages.sortedBy { it.timestampMillis }
        if (ordered.last().isFromSelf) return reject(RejectReason.FROM_SELF)

        val fallbackName = snapshot.title?.takeIf { it.isNotBlank() }
        val accepted = ordered
            .filter { !it.isFromSelf && !it.text.isNullOrBlank() }
            .takeLast(MAX_MESSAGES)
            .map { m ->
                IncomingMessage(
                    eventId = EventIds.of(key, m),
                    conversationKey = key,
                    senderDisplayName = m.sender?.takeIf { it.isNotBlank() } ?: fallbackName ?: "",
                    text = m.text!!.trim(),
                    timestampMillis = m.timestampMillis,
                )
            }
        if (accepted.isEmpty()) return reject(RejectReason.NO_CONTENT)
        return FilterResult.Accepted(key, accepted)
    }

    private fun reject(reason: RejectReason) = FilterResult.Rejected(reason)

    internal companion object {
        const val MAX_MESSAGES = 20
        const val GROUP_JID_SUFFIX = "@g.us"
        const val PRIVATE_JID_SUFFIX = "@s.whatsapp.net"
        const val CATEGORY_CALL = "call"

        /** Bidi / zero-width marks WhatsApp puts around Hebrew placeholder text. */
        private val INVISIBLE_MARKS = Regex("[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]")

        private val HIDDEN_PATTERNS: List<Regex> = listOf(
            Regex("^\\d+ (הודעות חדשות|new messages)$", RegexOption.IGNORE_CASE),
            Regex("^הודעה חדשה$"),
            Regex("^new message$", RegexOption.IGNORE_CASE),
            Regex("^checking for new messages\\.*$", RegexOption.IGNORE_CASE),
            Regex("^בודק(ת)? (אם יש )?הודעות חדשות\\.*$"),
            Regex("^\\d+ (new )?messages from \\d+ chats$", RegexOption.IGNORE_CASE),
            Regex("^\\d+ הודעות (חדשות )?מ-?\\s?\\d+ (צ'אטים|שיחות)$"),
        )

        fun isHiddenPlaceholder(text: String): Boolean {
            val normalized = text.replace(INVISIBLE_MARKS, "").trim()
            return HIDDEN_PATTERNS.any { it.matches(normalized) }
        }
    }
}
