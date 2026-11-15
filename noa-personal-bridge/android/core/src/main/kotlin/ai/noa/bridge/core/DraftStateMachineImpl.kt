package ai.noa.bridge.core

import ai.noa.bridge.core.DraftState.AWAITING_APPROVAL
import ai.noa.bridge.core.DraftState.APPROVED
import ai.noa.bridge.core.DraftState.CANCELLED
import ai.noa.bridge.core.DraftState.DEBOUNCING
import ai.noa.bridge.core.DraftState.DRAFT_READY
import ai.noa.bridge.core.DraftState.EXPIRED
import ai.noa.bridge.core.DraftState.FAILED
import ai.noa.bridge.core.DraftState.FILTERED
import ai.noa.bridge.core.DraftState.PROCESSING
import ai.noa.bridge.core.DraftState.RECEIVED
import ai.noa.bridge.core.DraftState.SENDING
import ai.noa.bridge.core.DraftState.SEND_ATTEMPTED
import ai.noa.bridge.core.DraftState.UNKNOWN_RESULT

/**
 * Allowed draft transitions. Anything not listed is illegal. Safety-relevant properties:
 * - The only way into [SENDING] is from [APPROVED].
 * - [DRAFT_READY] → [APPROVED] is illegal: a draft must be shown ([AWAITING_APPROVAL]) first.
 * - Terminal states have no outgoing transitions; a terminal draft can never be sent.
 * - Self-transitions are illegal except DEBOUNCING→DEBOUNCING (new message) and
 *   AWAITING_APPROVAL→AWAITING_APPROVAL (edit).
 */
internal object DraftStateMachineImpl {
    private val transitions: Map<DraftState, Set<DraftState>> = mapOf(
        RECEIVED to setOf(FILTERED, DEBOUNCING),
        DEBOUNCING to setOf(DEBOUNCING, PROCESSING, CANCELLED, EXPIRED, FAILED),
        PROCESSING to setOf(DRAFT_READY, FAILED, CANCELLED, EXPIRED, DEBOUNCING),
        DRAFT_READY to setOf(AWAITING_APPROVAL, CANCELLED, EXPIRED, DEBOUNCING),
        AWAITING_APPROVAL to setOf(AWAITING_APPROVAL, APPROVED, CANCELLED, EXPIRED, DEBOUNCING),
        APPROVED to setOf(SENDING, AWAITING_APPROVAL, CANCELLED, EXPIRED, DEBOUNCING),
        SENDING to setOf(SEND_ATTEMPTED, FAILED, UNKNOWN_RESULT),
    )

    val terminalStates: Set<DraftState> =
        setOf(FILTERED, CANCELLED, EXPIRED, SEND_ATTEMPTED, FAILED, UNKNOWN_RESULT)

    fun canTransition(from: DraftState, to: DraftState): Boolean =
        transitions[from]?.contains(to) == true
}
