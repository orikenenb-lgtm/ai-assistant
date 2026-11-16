package ai.noa.bridge.app.platform

/**
 * Reads the chat's phone number from WhatsApp's own conversation identity (D-020).
 *
 * WhatsApp sets a private chat's notification shortcutId (and often its tag) to the chat JID,
 * `<E.164 digits>@s.whatsapp.net`. Only that exact form yields a number:
 * - `@lid` ids (WhatsApp's privacy "linked ids") are NOT phone numbers and are never converted;
 * - `@g.us` (groups), `@broadcast`, `@newsletter` and anything else yield nothing.
 *
 * The result lives in memory only ([ReplyActionRegistry.putChatTarget]); it is never persisted,
 * logged ([SafeLog] cannot take strings) or sent to the backend.
 */
object WhatsAppChatIds {
    /** E.164 allows at most 15 digits; shorter than 7 is not a real subscriber number. */
    private val PHONE_JID = Regex("""^(\d{7,15})@s\.whatsapp\.net$""")

    /** The digits of the first of [shortcutId] / [tag] that is a phone JID, or null. */
    fun phoneDigits(shortcutId: String?, tag: String?): String? =
        sequenceOf(shortcutId, tag).firstNotNullOfOrNull { phoneDigits(it) }

    fun phoneDigits(id: String?): String? {
        val trimmed = id?.trim()?.lowercase() ?: return null
        return PHONE_JID.matchEntire(trimmed)?.groupValues?.get(1)
    }
}
