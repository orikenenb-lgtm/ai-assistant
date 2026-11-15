package ai.noa.bridge.core

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

/**
 * The single orchestrator. All state is in memory only and every mutation happens under [lock].
 * Sending is additionally serialized by [sendMutex] so that exactly one [ReplySender.send] call can
 * ever happen per approval.
 *
 * Limits and policies (see also the class-level constants):
 * - At most [MAX_ACTIVE_DRAFTS] non-terminal drafts. When full, notifications for conversations
 *   that have no active draft are ignored (not recorded as seen, so a later re-post can still be
 *   picked up once capacity frees). Existing drafts keep receiving messages.
 * - At most [MAX_MESSAGES_PER_DRAFT] source messages per draft (oldest dropped).
 * - Privacy pruning on every mutation: terminal drafts older than [TERMINAL_RETENTION_MILLIS]
 *   are dropped, and at most [MAX_TERMINAL_DRAFTS] terminal drafts are kept.
 * - Engine requests time out after [ENGINE_TIMEOUT_MILLIS]; failures are never retried.
 * - A draft in [DraftState.SENDING] is never modified by anything except the send result.
 * - [BridgeCoordinator.emergencyStop] sets `emergencyStopped=true, sendingEnabled=false` in the
 *   coordinator's copy of the settings only; the app must persist that itself.
 */
internal class DefaultBridgeCoordinator(
    val scope: CoroutineScope,
    val clock: Clock,
    val engine: DraftEngineClient,
    val sender: ReplySender,
    val initialSettings: BridgeSettings,
    val filter: ConversationFilter,
    val idGenerator: () -> String,
) : BridgeCoordinator {

    private val lock = Any()
    private val sendMutex = Mutex()

    @Volatile
    private var settings: BridgeSettings = initialSettings

    private val draftsById = LinkedHashMap<String, Draft>()
    private val engineJobs = HashMap<String, Job>()

    private val dedup: Deduplicator = Deduplicator.create(clock)
    private val guard: ApprovalGuard = ApprovalGuard.create(clock)
    private val debouncer: ConversationDebouncer = ConversationDebouncer.create(
        scope = scope,
        delayMillis = { settings.debounceMillis },
        onFire = { key, _ -> onDebounceFired(key) },
    )

    private val _drafts = MutableStateFlow<List<Draft>>(emptyList())
    override val drafts: StateFlow<List<Draft>> = _drafts.asStateFlow()

    // ---------------------------------------------------------------- notifications

    override fun onNotification(snapshot: NotificationSnapshot) {
        val current = settings
        when (val result = filter.evaluate(snapshot, current)) {
            is FilterResult.Accepted -> onAccepted(result)
            is FilterResult.Rejected -> if (result.reason == RejectReason.FROM_SELF) {
                val key = ConversationKeys.derive(snapshot) ?: return
                synchronized(lock) {
                    expireActiveLocked(key, DETAIL_MANUAL_REPLY)
                    publishLocked()
                }
            }
            // Every other rejection: store nothing at all.
        }
    }

    private fun onAccepted(result: FilterResult.Accepted) {
        val key = result.conversationKey
        synchronized(lock) {
            val s = settings
            if (s.paused || s.emergencyStopped || key in s.excludedConversations) return
            val existing = activeDraftLocked(key)
            if (existing == null && activeCountLocked() >= MAX_ACTIVE_DRAFTS) {
                pruneLocked()
                publishLocked()
                return
            }
            val fresh = result.messages.filter { !dedup.checkAndRecord(it.eventId) }
            if (fresh.isEmpty()) return

            val now = clock.nowMillis()
            val latestName = fresh.last().senderDisplayName
            val updated: Draft = if (existing == null) {
                val received = Draft(
                    id = idGenerator(),
                    conversationKey = key,
                    senderDisplayName = latestName,
                    sourceMessages = fresh.takeLast(MAX_MESSAGES_PER_DRAFT),
                    proposedText = null,
                    editedText = null,
                    state = DraftState.RECEIVED,
                    revision = 0,
                    createdAtMillis = now,
                    updatedAtMillis = now,
                )
                DraftStateMachine.requireTransition(received.state, DraftState.DEBOUNCING)
                received.copy(state = DraftState.DEBOUNCING)
            } else {
                if (existing.state != DraftState.DEBOUNCING) {
                    // PROCESSING / DRAFT_READY / AWAITING_APPROVAL / APPROVED: the draft is stale.
                    engineJobs.remove(existing.id)?.cancel()
                }
                DraftStateMachine.requireTransition(existing.state, DraftState.DEBOUNCING)
                existing.copy(
                    senderDisplayName = latestName.ifBlank { existing.senderDisplayName },
                    sourceMessages = (existing.sourceMessages + fresh).takeLast(MAX_MESSAGES_PER_DRAFT),
                    proposedText = if (existing.state == DraftState.DEBOUNCING) existing.proposedText else null,
                    editedText = if (existing.state == DraftState.DEBOUNCING) existing.editedText else null,
                    approval = null,
                    safety = SafetyFlags(),
                    statusDetail = null,
                    revision = existing.revision + 1,
                    state = DraftState.DEBOUNCING,
                    updatedAtMillis = now,
                )
            }
            draftsById[updated.id] = updated
            fresh.forEach(debouncer::submit)
            pruneLocked()
            publishLocked()
        }
    }

    override fun onNotificationRemoved(conversationKey: ConversationKey) {
        synchronized(lock) {
            expireActiveLocked(conversationKey, DETAIL_NOTIFICATION_REMOVED)
            publishLocked()
        }
    }

    // ---------------------------------------------------------------- engine

    private fun onDebounceFired(key: ConversationKey) {
        synchronized(lock) {
            val draft = activeDraftLocked(key)?.takeIf { it.state == DraftState.DEBOUNCING } ?: return
            val s = settings
            when {
                s.emergencyStopped || s.paused -> {
                    putLocked(draft, DraftState.EXPIRED, DETAIL_PAUSED)
                }
                !s.cloudConsentGiven -> {
                    putLocked(draft, DraftState.FAILED, DETAIL_NO_CONSENT)
                }
                else -> {
                    val processing = putLocked(draft, DraftState.PROCESSING, null) ?: return
                    val request = DraftRequest(
                        requestId = idGenerator(),
                        conversationKey = processing.conversationKey,
                        senderDisplayName = processing.senderDisplayName,
                        messages = processing.sourceMessages,
                    )
                    val job = scope.launch(start = CoroutineStart.LAZY) {
                        runEngine(processing.id, processing.revision, request)
                    }
                    engineJobs[processing.id] = job
                    job.start()
                }
            }
            pruneLocked()
            publishLocked()
        }
    }

    private suspend fun runEngine(draftId: String, revision: Int, request: DraftRequest) {
        val self = currentCoroutineContext().job
        var failureDetail: String? = null
        val result: DraftResult? = try {
            withTimeout(ENGINE_TIMEOUT_MILLIS) { engine.requestDraft(request) }
        } catch (e: TimeoutCancellationException) {
            failureDetail = DETAIL_ENGINE_TIMEOUT
            null
        } catch (e: CancellationException) {
            // Our job was cancelled (draft went stale / cancelled / stopped): drop silently.
            if (!currentCoroutineContext().isActive) {
                synchronized(lock) { if (engineJobs[draftId] === self) engineJobs.remove(draftId) }
                throw e
            }
            failureDetail = DETAIL_ENGINE_ERROR // engine threw a stray CancellationException
            null
        } catch (e: Throwable) {
            failureDetail = DETAIL_ENGINE_ERROR
            null
        }

        synchronized(lock) {
            if (engineJobs[draftId] === self) engineJobs.remove(draftId)
            val draft = draftsById[draftId] ?: return
            if (draft.revision != revision || draft.state != DraftState.PROCESSING) return // stale result
            when {
                result is DraftResult.Success && result.text.isNotBlank() -> {
                    val ready = putLocked(draft, DraftState.DRAFT_READY, null) {
                        it.copy(proposedText = result.text.trim(), editedText = null, safety = result.safety)
                    } ?: return
                    putLocked(ready, DraftState.AWAITING_APPROVAL, null)
                }
                result is DraftResult.Success -> putLocked(draft, DraftState.FAILED, DETAIL_ENGINE_EMPTY)
                result is DraftResult.Failure -> putLocked(draft, DraftState.FAILED, DETAIL_ENGINE_FAILED)
                else -> putLocked(draft, DraftState.FAILED, failureDetail ?: DETAIL_ENGINE_ERROR)
            }
            pruneLocked()
            publishLocked()
        }
    }

    // ---------------------------------------------------------------- user actions

    override fun updateSettings(settings: BridgeSettings) {
        synchronized(lock) {
            val consentRevoked = this.settings.cloudConsentGiven && !settings.cloudConsentGiven
            this.settings = settings
            when {
                settings.emergencyStopped -> stopAllLocked(DETAIL_EMERGENCY_STOP)
                settings.paused -> stopAllLocked(DETAIL_PAUSED)
                else -> settings.excludedConversations.forEach { expireActiveLocked(it, DETAIL_EXCLUDED) }
            }
            if (consentRevoked) revokeConsentLocked()
            pruneLocked()
            publishLocked()
        }
    }

    /**
     * The single normalization point for user edits: the text is stored trimmed, and the UI approves
     * the stored [Draft.finalText]. Text longer than [MAX_TEXT_LENGTH] is rejected (the UI enforces
     * the limit and explains it; this is the defensive backstop).
     */
    override fun edit(draftId: String, newText: String) {
        val text = newText.trim()
        if (text.isEmpty() || text.length > MAX_TEXT_LENGTH) return
        synchronized(lock) {
            val draft = draftsById[draftId] ?: return
            if (draft.state !in EDITABLE_STATES) return
            putLocked(draft, DraftState.AWAITING_APPROVAL, null) {
                it.copy(editedText = text, revision = draft.revision + 1, approval = null)
            }
            pruneLocked()
            publishLocked()
        }
    }

    override fun cancel(draftId: String) {
        synchronized(lock) {
            val draft = draftsById[draftId] ?: return
            if (draft.state == DraftState.SENDING || draft.state in DraftStateMachine.terminalStates) return
            if (!DraftStateMachine.canTransition(draft.state, DraftState.CANCELLED)) return
            stopWorkLocked(draft)
            putLocked(draft, DraftState.CANCELLED, null)
            pruneLocked()
            publishLocked()
        }
    }

    override fun approve(draftId: String, finalText: String): Approval? {
        synchronized(lock) {
            val s = settings
            if (s.emergencyStopped || s.paused) return null
            val found = draftsById[draftId] ?: return null
            if (found.state != DraftState.AWAITING_APPROVAL && found.state != DraftState.APPROVED) return null
            if (finalText.isBlank() || finalText != found.finalText) return null
            // Re-approval of an APPROVED draft (its send was refused, or its approval expired):
            // burn the old token and go back through AWAITING_APPROVAL, so a draft is never stuck
            // and at most one live approval exists per draft.
            val draft = if (found.state == DraftState.APPROVED) {
                found.approval?.let(guard::consume)
                putLocked(found, DraftState.AWAITING_APPROVAL, null) ?: return null
            } else {
                found
            }
            if (!DraftStateMachine.canTransition(draft.state, DraftState.APPROVED)) return null
            val approval = guard.issue(draft, finalText)
            putLocked(draft, DraftState.APPROVED, null) { it.copy(approval = approval) }
            pruneLocked()
            publishLocked()
            return approval
        }
    }

    override suspend fun sendApproved(approval: Approval): DraftState = sendMutex.withLock {
        // Phase 1 (under lock): validate, consume, move to SENDING — atomically.
        val toSend: Draft = synchronized(lock) {
            val draft = draftsById[approval.draftId] ?: return@withLock DraftState.EXPIRED
            val s = settings
            if (!s.sendingEnabled) return@withLock blockedLocked(draft, DETAIL_SENDING_DISABLED)
            if (s.emergencyStopped || s.paused) return@withLock blockedLocked(draft, DETAIL_PAUSED)

            val text = draft.finalText
            val check = if (text == null) ApprovalCheck.Invalid("no text") else guard.validate(approval, draft, text)
            if (check !is ApprovalCheck.Valid) {
                guard.consume(approval) // burn the presented token: it can never be used again
                if (draft.state == DraftState.SENDING || draft.state in DraftStateMachine.terminalStates) {
                    return@withLock draft.state
                }
                val next = if (DraftStateMachine.canTransition(draft.state, DraftState.AWAITING_APPROVAL)) {
                    DraftState.AWAITING_APPROVAL
                } else {
                    draft.state
                }
                val updated = draft.copy(
                    state = next,
                    approval = null,
                    statusDetail = DETAIL_APPROVAL_INVALID,
                    updatedAtMillis = clock.nowMillis(),
                )
                draftsById[draft.id] = updated
                pruneLocked()
                publishLocked()
                return@withLock updated.state
            }

            guard.consume(approval) // consume FIRST: even a crash below can never lead to a second send
            val sending = putLocked(draft, DraftState.SENDING, null) { it.copy(approval = null) }
                ?: return@withLock draft.state
            publishLocked()
            sending
        }

        // Phase 2 (outside the lock, inside the mutex): exactly one send attempt.
        val outcome: SendOutcome = try {
            sender.send(toSend.conversationKey, toSend.finalText!!)
        } catch (e: CancellationException) {
            finishSend(toSend.id, SendOutcome.UNKNOWN)
            throw e
        } catch (e: Throwable) {
            SendOutcome.UNKNOWN
        }
        finishSend(toSend.id, outcome)
    }

    private fun finishSend(draftId: String, outcome: SendOutcome): DraftState = synchronized(lock) {
        val (state, detail) = when (outcome) {
            SendOutcome.ATTEMPTED -> DraftState.SEND_ATTEMPTED to DETAIL_SEND_ATTEMPTED
            SendOutcome.FAILED_NO_ACTION -> DraftState.FAILED to DETAIL_SEND_NO_ACTION
            SendOutcome.FAILED_CANCELED -> DraftState.FAILED to DETAIL_SEND_CANCELED
            SendOutcome.UNKNOWN -> DraftState.UNKNOWN_RESULT to DETAIL_SEND_UNKNOWN
        }
        val draft = draftsById[draftId]
        if (draft != null && draft.state == DraftState.SENDING) {
            putLocked(draft, state, detail)
            pruneLocked()
            publishLocked()
        }
        state
    }

    /** Sending is blocked by settings: do not consume, keep the state, explain why. */
    private fun blockedLocked(draft: Draft, detail: String): DraftState {
        if (draft.state != DraftState.SENDING && draft.state !in DraftStateMachine.terminalStates) {
            draftsById[draft.id] = draft.copy(statusDetail = detail, updatedAtMillis = clock.nowMillis())
            pruneLocked()
            publishLocked()
        }
        return draft.state
    }

    override fun emergencyStop() {
        synchronized(lock) {
            settings = settings.copy(emergencyStopped = true, sendingEnabled = false)
            stopAllLocked(DETAIL_EMERGENCY_STOP)
            pruneLocked()
            publishLocked()
        }
    }

    override fun clearAll() {
        synchronized(lock) {
            debouncer.cancelAll()
            engineJobs.values.forEach { it.cancel() }
            engineJobs.clear()
            draftsById.clear()
            dedup.clear()
            publishLocked()
        }
    }

    // ---------------------------------------------------------------- helpers (call with lock held)

    /** The non-terminal, non-SENDING draft of [key], if any (there is at most one). */
    private fun activeDraftLocked(key: ConversationKey): Draft? =
        draftsById.values.lastOrNull { it.conversationKey == key && isActiveNotSending(it) }

    private fun activeCountLocked(): Int =
        draftsById.values.count { it.state !in DraftStateMachine.terminalStates }

    private fun isActiveNotSending(d: Draft): Boolean =
        d.state != DraftState.SENDING && d.state !in DraftStateMachine.terminalStates

    private fun stopWorkLocked(draft: Draft) {
        debouncer.cancel(draft.conversationKey)
        engineJobs.remove(draft.id)?.cancel()
    }

    private fun expireActiveLocked(key: ConversationKey, detail: String) {
        draftsById.values.filter { it.conversationKey == key && isActiveNotSending(it) }.forEach { d ->
            stopWorkLocked(d)
            putLocked(d, DraftState.EXPIRED, detail)
        }
        pruneLocked()
    }

    /**
     * Cloud consent was withdrawn: nothing more may go to the backend and nothing produced after the
     * withdrawal may become a draft. Cancels pending debounces and in-flight engine requests and
     * fails the drafts that were waiting for them.
     */
    private fun revokeConsentLocked() {
        debouncer.cancelAll()
        draftsById.values
            .filter { it.state == DraftState.DEBOUNCING || it.state == DraftState.PROCESSING }
            .forEach { d ->
                stopWorkLocked(d)
                putLocked(d, DraftState.FAILED, DETAIL_CONSENT_REVOKED)
            }
        engineJobs.values.forEach { it.cancel() }
        engineJobs.clear()
    }

    private fun stopAllLocked(detail: String) {
        debouncer.cancelAll()
        engineJobs.values.forEach { it.cancel() }
        engineJobs.clear()
        draftsById.values.filter(::isActiveNotSending).forEach { putLocked(it, DraftState.EXPIRED, detail) }
    }

    /**
     * Moves [draft] to [to] if the state machine allows it, applying [mutate] first. Every state
     * change clears or sets [Draft.statusDetail] and bumps updatedAt. Returns null (and changes
     * nothing) on an illegal transition.
     */
    private inline fun putLocked(
        draft: Draft,
        to: DraftState,
        detail: String?,
        mutate: (Draft) -> Draft = { it },
    ): Draft? {
        if (!DraftStateMachine.canTransition(draft.state, to)) return null
        val clearApproval = to != DraftState.APPROVED
        val base = mutate(draft)
        val next = base.copy(
            state = to,
            statusDetail = detail,
            approval = if (clearApproval) null else base.approval,
            updatedAtMillis = clock.nowMillis(),
        )
        draftsById[next.id] = next
        return next
    }

    private fun pruneLocked() {
        val now = clock.nowMillis()
        val terminal = draftsById.values.filter { it.state in DraftStateMachine.terminalStates }
        val tooOld = terminal.filter { now - it.updatedAtMillis > TERMINAL_RETENTION_MILLIS }
        tooOld.forEach { draftsById.remove(it.id) }
        val remaining = terminal.filter { draftsById.containsKey(it.id) }
        if (remaining.size > MAX_TERMINAL_DRAFTS) {
            remaining.sortedByDescending { it.updatedAtMillis }
                .drop(MAX_TERMINAL_DRAFTS)
                .forEach { draftsById.remove(it.id) }
        }
    }

    private fun publishLocked() {
        _drafts.value = draftsById.values.sortedWith(
            compareByDescending<Draft> { it.updatedAtMillis }.thenByDescending { it.createdAtMillis },
        )
    }

    internal companion object {
        const val MAX_ACTIVE_DRAFTS = 30
        const val MAX_TERMINAL_DRAFTS = 50
        const val TERMINAL_RETENTION_MILLIS = 60 * 60 * 1000L
        const val MAX_MESSAGES_PER_DRAFT = 20
        const val MAX_TEXT_LENGTH = 4_000
        const val ENGINE_TIMEOUT_MILLIS = 45_000L

        val EDITABLE_STATES = setOf(DraftState.DRAFT_READY, DraftState.AWAITING_APPROVAL, DraftState.APPROVED)

        const val DETAIL_MANUAL_REPLY = "נראה שענית ידנית — הטיוטה בוטלה"
        const val DETAIL_PAUSED = "הגשר מושהה"
        const val DETAIL_EMERGENCY_STOP = "עצירת חירום"
        const val DETAIL_NO_CONSENT = "לא ניתנה הסכמה לשליחת תוכן לנועה"
        const val DETAIL_CONSENT_REVOKED = "ההסכמה לשליחת תוכן בוטלה"
        const val DETAIL_NOTIFICATION_REMOVED = "ההתראה נסגרה ב-WhatsApp"
        const val DETAIL_EXCLUDED = "השיחה הוחרגה מהגשר"
        const val DETAIL_ENGINE_TIMEOUT = "נועה לא ענתה בזמן — אין ניסיון חוזר אוטומטי"
        const val DETAIL_ENGINE_FAILED = "נועה לא הצליחה להכין טיוטה — אין ניסיון חוזר אוטומטי"
        const val DETAIL_ENGINE_EMPTY = "נועה החזירה טיוטה ריקה"
        const val DETAIL_ENGINE_ERROR = "שגיאה בתקשורת עם נועה — אין ניסיון חוזר אוטומטי"
        const val DETAIL_SENDING_DISABLED = "השליחה הניסיונית כבויה בהגדרות"
        const val DETAIL_APPROVAL_INVALID = "האישור כבר לא תקף — יש לאשר מחדש"
        const val DETAIL_SEND_ATTEMPTED = "הועבר ל-WhatsApp. אין אישור מסירה"
        const val DETAIL_SEND_NO_ACTION = "לא נמצאה אפשרות תשובה פעילה ב-WhatsApp — לא נשלח"
        const val DETAIL_SEND_CANCELED = "WhatsApp ביטלה את פעולת התשובה — לא נשלח"
        const val DETAIL_SEND_UNKNOWN = "לא ידוע אם נשלח — לא תתבצע שליחה חוזרת"
    }
}
