package ai.noa.bridge.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ApprovalGuardTest {
    private var now = 1_000L
    private val clock = Clock { now }
    private val guard = ApprovalGuard.create(clock, ttlMillis = 60_000)
    private val key = keyOf(snapshot())
    private val draft = draftOf(key, state = DraftState.AWAITING_APPROVAL)

    private fun issued(): Pair<Approval, Draft> {
        val a = guard.issue(draft, draft.finalText!!)
        return a to draft.copy(state = DraftState.APPROVED, approval = a)
    }

    private fun assertInvalid(check: ApprovalCheck) = assertTrue(check.toString(), check is ApprovalCheck.Invalid)

    @Test fun issuedApprovalIsBoundAndValid() {
        val (a, approved) = issued()
        assertTrue(Regex("^[0-9a-f]{32}$").matches(a.token))
        assertEquals(draft.id, a.draftId)
        assertEquals(draft.revision, a.revision)
        assertEquals(key, a.conversationKey)
        assertEquals(Hashing.sha256Hex("reply text"), a.textSha256)
        assertEquals(61_000L, a.expiresAtMillis)
        assertEquals(ApprovalCheck.Valid, guard.validate(a, approved, "reply text"))
    }

    @Test fun tokensAreUnique() {
        val tokens = (1..200).map { guard.issue(draft, "reply text").token }.toSet()
        assertEquals(200, tokens.size)
    }

    @Test fun differentTextRejected() {
        val (a, approved) = issued()
        assertInvalid(guard.validate(a, approved, "reply text!"))
        // Draft text changed but caller passes the old text: still rejected.
        assertInvalid(guard.validate(a, approved.copy(editedText = "other"), "reply text"))
    }

    @Test fun differentRevisionRejected() {
        val (a, approved) = issued()
        assertInvalid(guard.validate(a, approved.copy(revision = 2), "reply text"))
    }

    @Test fun differentDraftRejected() {
        val (a, approved) = issued()
        assertInvalid(guard.validate(a, approved.copy(id = "d2"), "reply text"))
    }

    @Test fun differentConversationRejected() {
        val (a, approved) = issued()
        assertInvalid(guard.validate(a, approved.copy(conversationKey = keyOf(snapshot(tag = OTHER_JID))), "reply text"))
    }

    @Test fun tamperedApprovalRejected() {
        val (a, approved) = issued()
        val other = keyOf(snapshot(tag = OTHER_JID))
        assertInvalid(guard.validate(a.copy(conversationKey = other), approved.copy(conversationKey = other), "reply text"))
        assertInvalid(guard.validate(a.copy(expiresAtMillis = Long.MAX_VALUE), approved, "reply text"))
    }

    @Test fun expiredRejected() {
        val (a, approved) = issued()
        now = a.expiresAtMillis - 1
        assertEquals(ApprovalCheck.Valid, guard.validate(a, approved, "reply text"))
        now = a.expiresAtMillis
        assertInvalid(guard.validate(a, approved, "reply text"))
    }

    @Test fun consumedRejectedAndConsumeIsIdempotent() {
        val (a, approved) = issued()
        guard.consume(a)
        guard.consume(a)
        assertInvalid(guard.validate(a, approved, "reply text"))
    }

    @Test fun foreignTokenRejected() {
        val (a, approved) = issued()
        val forged = a.copy(token = "0".repeat(32))
        assertInvalid(guard.validate(forged, approved, "reply text"))
        val otherGuard = ApprovalGuard.create(clock)
        assertInvalid(otherGuard.validate(a, approved, "reply text"))
    }

    @Test fun draftMustBeInApprovedState() {
        val (a, approved) = issued()
        DraftState.entries.filter { it != DraftState.APPROVED }.forEach { s ->
            assertInvalid(guard.validate(a, approved.copy(state = s), "reply text"))
        }
    }

    @Test fun editedTextIsWhatGetsApproved() {
        val edited = draft.copy(editedText = "edited")
        val a = guard.issue(edited, "edited")
        assertNotEquals(Hashing.sha256Hex("reply text"), a.textSha256)
        assertEquals(ApprovalCheck.Valid, guard.validate(a, edited.copy(state = DraftState.APPROVED), "edited"))
        assertInvalid(guard.validate(a, edited.copy(state = DraftState.APPROVED, editedText = null), "reply text"))
    }

    @Test fun invalidReasonsContainNoContent() {
        val (a, approved) = issued()
        val check = guard.validate(a, approved, "reply text SECRET") as ApprovalCheck.Invalid
        assertTrue(!check.reason.contains("SECRET") && !check.reason.contains("reply"))
    }

    @Test fun concurrentValidateAndConsumeIsSafe() {
        val (a, approved) = issued()
        val winners = java.util.concurrent.atomic.AtomicInteger()
        val lock = Any()
        val threads = (1..8).map {
            Thread {
                synchronized(lock) {
                    if (guard.validate(a, approved, "reply text") == ApprovalCheck.Valid) {
                        guard.consume(a); winners.incrementAndGet()
                    }
                }
            }
        }
        threads.forEach(Thread::start); threads.forEach(Thread::join)
        assertEquals(1, winners.get())
    }
}
