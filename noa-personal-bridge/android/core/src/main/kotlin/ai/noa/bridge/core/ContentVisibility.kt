package ai.noa.bridge.core

/**
 * The single detector for notifications whose real message content we did not see: WhatsApp
 * placeholders ("2 new messages") and Android 15+ "sensitive notification content hidden"
 * redaction. Used by BOTH the core filter (no draft is made) and the app's notification mapper /
 * ingestor (no reply handle is kept), so the two layers can never disagree.
 *
 * All checks ignore the bidi / zero-width marks WhatsApp wraps around Hebrew text.
 */
object ContentVisibility {
    /** Label Android puts in place of the conversation name when it redacts a notification. */
    const val WHATSAPP_LABEL = "WhatsApp"

    /** Bidi / zero-width marks WhatsApp puts around Hebrew placeholder text. */
    private val INVISIBLE_MARKS = Regex("[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]")

    /** Whole-line placeholders that stand in for one or more unseen messages. */
    private val HIDDEN_PATTERNS: List<Regex> = listOf(
        Regex("^\\d+ (הודעות חדשות|new messages)$", RegexOption.IGNORE_CASE),
        Regex("^הודעה חדשה$"),
        Regex("^new message$", RegexOption.IGNORE_CASE),
        Regex("^checking for new messages\\.*$", RegexOption.IGNORE_CASE),
        Regex("^בודק(ת)? (אם יש )?הודעות חדשות\\.*$"),
        Regex("^\\d+ (new )?messages from \\d+ chats$", RegexOption.IGNORE_CASE),
        Regex("^\\d+ הודעות (חדשות )?מ-?\\s?\\d+ (צ'אטים|שיחות)$"),
    )

    /** Redaction notices (matched anywhere in the text). Union of the former core and app lists. */
    private val REDACTION_NOTICES: List<Regex> = listOf(
        Regex("sensitive notification content hidden", RegexOption.IGNORE_CASE),
        Regex("sensitive.*hidden", RegexOption.IGNORE_CASE),
        Regex("content hidden", RegexOption.IGNORE_CASE),
        Regex("תוכן.*רגיש.*(הוסתר|מוסתר)"),
        Regex("(הוסתר|מוסתר).*תוכן.*רגיש"),
        Regex("רגיש.*(הוסתר|מוסתר)|(הוסתר|מוסתר).*רגיש"),
        Regex("התוכן (הוסתר|מוסתר)"),
    )

    private fun normalize(text: String): String = text.replace(INVISIBLE_MARKS, "").trim()

    /** A single line such as "2 new messages" / "הודעה חדשה" that hides the actual content. */
    fun isHiddenPlaceholder(text: String): Boolean {
        val normalized = normalize(text)
        return HIDDEN_PATTERNS.any { it.matches(normalized) }
    }

    /** Android's (or WhatsApp's) "content hidden" notice in place of the real message. */
    fun isSensitiveRedactionNotice(text: String): Boolean {
        val normalized = normalize(text)
        return REDACTION_NOTICES.any { it.containsMatchIn(normalized) }
    }

    /**
     * True when [snapshot] shows signs of redaction: the app label instead of the contact /
     * conversation name (title, conversation title or a sender), or a redaction notice in any line.
     * Never draft on, and never reply through, such a notification.
     */
    fun isRedactedSnapshot(snapshot: NotificationSnapshot): Boolean {
        val title = snapshot.title?.let(::normalize)
        val conversation = snapshot.conversationTitle?.let(::normalize)
        val labelled = title.equals(WHATSAPP_LABEL, ignoreCase = true) ||
            conversation.equals(WHATSAPP_LABEL, ignoreCase = true) ||
            snapshot.messages.any { it.sender?.let(::normalize).equals(WHATSAPP_LABEL, ignoreCase = true) }
        if (labelled) return true
        return snapshot.messages.any { m -> m.text?.takeIf { it.isNotBlank() }?.let(::isSensitiveRedactionNotice) == true }
    }
}
