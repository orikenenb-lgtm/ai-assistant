package ai.noa.bridge.core

import ai.noa.bridge.core.Hashing.toHex
import java.security.SecureRandom

/**
 * Issues and validates single-use approvals. Thread-safe.
 *
 * An approval is valid only if ALL of these hold:
 * - its token was issued by this guard instance and the presented [Approval] is identical to the
 *   issued one (a forged/modified copy with a real token is rejected),
 * - it has not been consumed,
 * - draft id, revision and conversation match the current draft,
 * - the final text is byte-identical to what was approved (hash and equality with draft.finalText),
 * - now < expiresAtMillis,
 * - the draft is in [DraftState.APPROVED].
 *
 * [consume] is idempotent. Tokens are 128-bit [SecureRandom] values, hex encoded. Expired tokens are
 * forgotten (an unknown token never validates), which keeps memory bounded.
 */
internal class DefaultApprovalGuard(val clock: Clock, val ttlMillis: Long) : ApprovalGuard {
    init {
        require(ttlMillis > 0) { "ttlMillis must be > 0" }
    }

    private val random = SecureRandom()
    private val issued = HashMap<String, Approval>()
    private val consumed = HashSet<String>()

    @Synchronized
    override fun issue(draft: Draft, finalText: String): Approval {
        require(finalText.isNotBlank()) { "Cannot approve blank text" }
        val now = clock.nowMillis()
        purge(now)
        var token: String
        do {
            val bytes = ByteArray(TOKEN_BYTES).also(random::nextBytes)
            token = bytes.toHex()
        } while (issued.containsKey(token) || consumed.contains(token))
        val approval = Approval(
            token = token,
            draftId = draft.id,
            revision = draft.revision,
            conversationKey = draft.conversationKey,
            textSha256 = Hashing.sha256Hex(finalText),
            issuedAtMillis = now,
            expiresAtMillis = now + ttlMillis,
        )
        issued[token] = approval
        return approval
    }

    @Synchronized
    override fun validate(approval: Approval, draft: Draft, finalText: String): ApprovalCheck {
        val now = clock.nowMillis()
        if (approval.token in consumed) return invalid("consumed")
        val known = issued[approval.token] ?: return invalid("unknown token")
        if (known != approval) return invalid("approval does not match issued token")
        if (approval.draftId != draft.id) return invalid("different draft")
        if (approval.revision != draft.revision) return invalid("stale revision")
        if (approval.conversationKey != draft.conversationKey) return invalid("different conversation")
        if (!Hashing.constantTimeEquals(Hashing.sha256Hex(finalText), approval.textSha256)) {
            return invalid("text changed")
        }
        if (finalText != draft.finalText) return invalid("text differs from draft")
        if (now >= approval.expiresAtMillis) return invalid("expired")
        if (draft.state != DraftState.APPROVED) return invalid("draft not approved")
        return ApprovalCheck.Valid
    }

    @Synchronized
    override fun consume(approval: Approval) {
        consumed += approval.token
    }

    private fun purge(now: Long) {
        val it = issued.entries.iterator()
        while (it.hasNext()) {
            val entry = it.next()
            if (now >= entry.value.expiresAtMillis) {
                it.remove()
                consumed.remove(entry.key)
            }
        }
    }

    private fun invalid(reason: String) = ApprovalCheck.Invalid(reason)

    private companion object {
        const val TOKEN_BYTES = 16
    }
}
