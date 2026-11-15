package ai.noa.bridge.core

import ai.noa.bridge.core.DraftState.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DraftStateMachineTest {
    private val legal: Set<Pair<DraftState, DraftState>> = buildSet {
        fun add(from: DraftState, vararg to: DraftState) = to.forEach { add(from to it) }
        add(RECEIVED, FILTERED, DEBOUNCING)
        add(DEBOUNCING, DEBOUNCING, PROCESSING, CANCELLED, EXPIRED, FAILED)
        add(PROCESSING, DRAFT_READY, FAILED, CANCELLED, EXPIRED, DEBOUNCING)
        add(DRAFT_READY, AWAITING_APPROVAL, CANCELLED, EXPIRED, DEBOUNCING)
        add(AWAITING_APPROVAL, AWAITING_APPROVAL, APPROVED, CANCELLED, EXPIRED, DEBOUNCING)
        add(APPROVED, SENDING, AWAITING_APPROVAL, CANCELLED, EXPIRED, DEBOUNCING)
        add(SENDING, SEND_ATTEMPTED, FAILED, UNKNOWN_RESULT)
    }

    @Test fun exhaustiveTransitionTable() {
        var illegalCount = 0
        for (from in DraftState.entries) for (to in DraftState.entries) {
            val expected = (from to to) in legal
            assertEquals("$from -> $to", expected, DraftStateMachine.canTransition(from, to))
            if (!expected) {
                illegalCount++
                try {
                    DraftStateMachine.requireTransition(from, to)
                    throw AssertionError("requireTransition allowed $from -> $to")
                } catch (_: IllegalStateException) {
                }
            } else {
                DraftStateMachine.requireTransition(from, to)
            }
        }
        assertEquals(13 * 13 - legal.size, illegalCount)
    }

    @Test fun draftReadyCannotBeApprovedDirectly() = assertFalse(DraftStateMachine.canTransition(DRAFT_READY, APPROVED))

    @Test fun onlyApprovedLeadsToSending() {
        DraftState.entries.forEach { from ->
            assertEquals("$from -> SENDING", from == APPROVED, DraftStateMachine.canTransition(from, SENDING))
        }
    }

    @Test fun terminalStatesHaveNoExits() {
        assertEquals(
            setOf(FILTERED, CANCELLED, EXPIRED, SEND_ATTEMPTED, FAILED, UNKNOWN_RESULT),
            DraftStateMachine.terminalStates,
        )
        DraftStateMachine.terminalStates.forEach { t ->
            DraftState.entries.forEach { to -> assertFalse("$t -> $to", DraftStateMachine.canTransition(t, to)) }
        }
    }

    @Test fun sendingCannotBeCancelledOrExpired() {
        assertFalse(DraftStateMachine.canTransition(SENDING, CANCELLED))
        assertFalse(DraftStateMachine.canTransition(SENDING, EXPIRED))
        assertFalse(DraftStateMachine.canTransition(SENDING, SENDING))
        assertTrue(DraftStateMachine.canTransition(APPROVED, SENDING))
    }
}
