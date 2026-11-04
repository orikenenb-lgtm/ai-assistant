package com.disciplineos.app.ui.coach

/** Pure input rules for the coach composer (unit-tested in CoachInputTest). */
object CoachInput {
    /** Mirrors PromptInjectionGuard.MAX_USER_CHARS; kept here so the UI rule is testable without the domain body. */
    const val MAX_CHARS = 2_000

    /** Hard-caps what the text field accepts (paste of a huge text is truncated, never rejected silently). */
    fun clamp(raw: String): String = if (raw.length <= MAX_CHARS) raw else raw.take(MAX_CHARS)

    fun canSend(text: String, sending: Boolean, limitReached: Boolean): Boolean =
        !sending && !limitReached && text.isNotBlank() && text.length <= MAX_CHARS

    /** Show the counter only when it is useful (last 20%), to keep the composer calm. */
    fun showCounter(length: Int): Boolean = length >= MAX_CHARS * 8 / 10

    /** Provider ids that mean "runs fully on device". */
    fun isLocalProvider(providerName: String): Boolean =
        providerName.isBlank() || providerName.startsWith("local", ignoreCase = true)
}
