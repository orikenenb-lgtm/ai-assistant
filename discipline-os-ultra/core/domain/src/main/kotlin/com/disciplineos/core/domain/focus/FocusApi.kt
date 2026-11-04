package com.disciplineos.core.domain.focus

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Duration
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton

sealed interface FocusEvent {
    data class Start(val taskId: Long?) : FocusEvent
    data object Pause : FocusEvent
    data object Resume : FocusEvent
    data object Skip : FocusEvent
    data object Stop : FocusEvent
    /** The current phase's end time has passed. */
    data object PhaseElapsed : FocusEvent
}

sealed interface FocusEffect {
    data class WorkPhaseFinished(val focusedSeconds: Long, val completed: Boolean) : FocusEffect
    data class PhaseStarted(val phase: FocusPhase, val endsAt: Instant) : FocusEffect
    data object TimerStopped : FocusEffect
}

data class FocusTransition(val state: FocusState, val effects: List<FocusEffect>)

/**
 * Pure reducer.
 *
 * ## Time accounting (timestamps only, never a ticking counter)
 * While a phase is running, [FocusState.phaseStartedAt] is the *virtual* start: the instant the phase would
 * have started had it never been paused, so `phaseEndsAt - phaseStartedAt` is always the planned length and
 * `now - phaseStartedAt` is the elapsed time excluding pauses.
 *  - Pause: `pausedRemainingMillis = phaseEndsAt - now`, `phaseEndsAt = null` (phaseStartedAt kept as-is).
 *  - Resume: `phaseEndsAt = now + remaining`, `phaseStartedAt = now - (planned - remaining)`, where planned is
 *    [FocusState.phasePlannedMillis] captured when the phase started (falling back to the [FocusConfig] length
 *    only for state persisted before that field existed), so editing the config mid-pause has no effect.
 *  - focusedSeconds = elapsed excluding pauses, clamped to `[0, planned]`.
 *
 * ## Elapsed phases / long gaps (device asleep)
 * One [FocusEvent.PhaseElapsed] advances exactly one phase. A naturally finished WORK phase is credited exactly
 * its planned length (never the wall-clock gap). The next phase is anchored at the previous `phaseEndsAt`
 * (not `now`), so a caller looping PhaseElapsed lands in the phase that is current *now*. A WORK phase that
 * would be auto-started from a break but would already have fully elapsed unobserved is NOT started
 * (state goes IDLE): nobody was there to focus, so no fabricated focus time is ever credited.
 *
 * Invalid events return the same state with no effects.
 */
object FocusTimerStateMachine {
    fun reduce(state: FocusState, event: FocusEvent, config: FocusConfig, now: Instant): FocusTransition {
        val ignore = FocusTransition(state, emptyList())
        return when (event) {
            is FocusEvent.Start -> {
                if (state.phase != FocusPhase.IDLE) ignore
                else startPhase(state.copy(taskId = event.taskId), FocusPhase.WORK, now, config, emptyList())
            }

            FocusEvent.Pause -> {
                val endsAt = state.phaseEndsAt
                if (state.phase == FocusPhase.IDLE || state.paused || endsAt == null) return ignore
                val remaining = Duration.between(now, endsAt).toMillis()
                if (remaining <= 0) return ignore // already elapsed: PhaseElapsed must be processed instead
                FocusTransition(
                    state.copy(
                        paused = true,
                        pausedRemainingMillis = remaining,
                        phaseEndsAt = null,
                        interruptions = state.interruptions + if (state.phase == FocusPhase.WORK) 1 else 0,
                    ),
                    emptyList(),
                )
            }

            FocusEvent.Resume -> {
                if (state.phase == FocusPhase.IDLE || !state.paused) return ignore
                val planned = plannedMillis(state, config)
                val remaining = (state.pausedRemainingMillis ?: 0L).coerceAtLeast(0L)
                val elapsedBefore = (planned - remaining).coerceIn(0L, planned)
                FocusTransition(
                    state.copy(
                        paused = false,
                        pausedRemainingMillis = null,
                        phaseStartedAt = now.minusMillis(elapsedBefore),
                        phaseEndsAt = now.plusMillis(remaining),
                    ),
                    emptyList(),
                )
            }

            FocusEvent.Skip -> when (state.phase) {
                FocusPhase.IDLE -> ignore
                FocusPhase.WORK -> {
                    val finished = FocusEffect.WorkPhaseFinished(focusedSeconds(state, config, now), completed = false)
                    if (config.autoStartBreaks) startPhase(state, FocusPhase.SHORT_BREAK, now, config, listOf(finished))
                    else FocusTransition(idleAfterCycle(state), listOf(finished))
                }
                FocusPhase.SHORT_BREAK, FocusPhase.LONG_BREAK ->
                    if (config.autoStartWork) startPhase(state, FocusPhase.WORK, now, config, emptyList())
                    else FocusTransition(idleAfterCycle(state), emptyList())
            }

            FocusEvent.Stop -> when (state.phase) {
                FocusPhase.IDLE -> ignore
                FocusPhase.WORK -> {
                    val focused = focusedSeconds(state, config, now)
                    val effects = buildList {
                        if (focused > 0) add(FocusEffect.WorkPhaseFinished(focused, completed = false))
                        add(FocusEffect.TimerStopped)
                    }
                    FocusTransition(FocusState(), effects)
                }
                FocusPhase.SHORT_BREAK, FocusPhase.LONG_BREAK -> FocusTransition(FocusState(), listOf(FocusEffect.TimerStopped))
            }

            FocusEvent.PhaseElapsed -> {
                val endsAt = state.phaseEndsAt
                if (state.phase == FocusPhase.IDLE || state.paused || endsAt == null || now.isBefore(endsAt)) return ignore
                when (state.phase) {
                    FocusPhase.WORK -> {
                        val completedCount = state.completedWorkSessions + 1
                        val start = state.phaseStartedAt ?: endsAt.minusMillis(plannedMillis(state, config))
                        // Credit the planned length only — never the (possibly hours-long) unobserved overshoot.
                        val focused = Duration.between(start, endsAt).seconds.coerceAtLeast(0)
                        val finished = FocusEffect.WorkPhaseFinished(focused, completed = true)
                        val counted = state.copy(completedWorkSessions = completedCount)
                        if (config.autoStartBreaks) {
                            val every = config.sessionsBeforeLongBreak.coerceAtLeast(1)
                            val breakPhase = if (completedCount % every == 0) FocusPhase.LONG_BREAK else FocusPhase.SHORT_BREAK
                            startPhase(counted, breakPhase, endsAt, config, listOf(finished))
                        } else {
                            FocusTransition(idleAfterCycle(counted), listOf(finished))
                        }
                    }
                    else -> {
                        val workEnd = endsAt.plus(phaseLength(FocusPhase.WORK, config))
                        if (config.autoStartWork && now.isBefore(workEnd)) {
                            startPhase(state, FocusPhase.WORK, endsAt, config, emptyList())
                        } else {
                            FocusTransition(idleAfterCycle(state), emptyList())
                        }
                    }
                }
            }
        }
    }

    fun remaining(state: FocusState, now: Instant): Duration {
        if (state.phase == FocusPhase.IDLE) return Duration.ZERO
        if (state.paused) return Duration.ofMillis((state.pausedRemainingMillis ?: 0L).coerceAtLeast(0L))
        val endsAt = state.phaseEndsAt ?: return Duration.ZERO
        val d = Duration.between(now, endsAt)
        return if (d.isNegative) Duration.ZERO else d
    }

    /** Planned length of [phase] from [config] (each at least one minute). */
    fun phaseLength(phase: FocusPhase, config: FocusConfig): Duration = when (phase) {
        FocusPhase.IDLE -> Duration.ZERO
        FocusPhase.WORK -> Duration.ofMinutes(config.workMinutes.coerceAtLeast(1).toLong())
        FocusPhase.SHORT_BREAK -> Duration.ofMinutes(config.shortBreakMinutes.coerceAtLeast(1).toLong())
        FocusPhase.LONG_BREAK -> Duration.ofMinutes(config.longBreakMinutes.coerceAtLeast(1).toLong())
    }

    /** Work time actually focused in the current WORK phase, excluding pauses, clamped to [0, planned]. */
    fun focusedSeconds(state: FocusState, config: FocusConfig, now: Instant): Long {
        if (state.phase != FocusPhase.WORK) return 0
        val millis = if (state.paused) {
            val planned = plannedMillis(state, config)
            (planned - (state.pausedRemainingMillis ?: planned)).coerceIn(0L, planned)
        } else {
            val start = state.phaseStartedAt ?: return 0
            val planned = state.phaseEndsAt?.let { Duration.between(start, it).toMillis() }
                ?: plannedMillis(state, config)
            Duration.between(start, now).toMillis().coerceIn(0L, planned.coerceAtLeast(0L))
        }
        return millis / 1000
    }

    /**
     * Planned length of the state's current phase: the length captured at phase start, or (for state persisted
     * before [FocusState.phasePlannedMillis] existed) the current [config] length.
     */
    fun plannedMillis(state: FocusState, config: FocusConfig): Long =
        state.phasePlannedMillis?.takeIf { it > 0 } ?: phaseLength(state.phase, config).toMillis()

    private fun startPhase(
        base: FocusState,
        phase: FocusPhase,
        at: Instant,
        config: FocusConfig,
        preceding: List<FocusEffect>,
    ): FocusTransition {
        val length = phaseLength(phase, config)
        val endsAt = at.plus(length)
        val isWork = phase == FocusPhase.WORK
        val next = base.copy(
            phase = phase,
            paused = false,
            phaseStartedAt = at,
            phaseEndsAt = endsAt,
            pausedRemainingMillis = null,
            phasePlannedMillis = length.toMillis(),
            // The previous work row (if any) is closed by the caller; a new WORK row id is assigned by the manager.
            currentSessionId = null,
            interruptions = if (isWork) 0 else base.interruptions,
        )
        return FocusTransition(next, preceding + FocusEffect.PhaseStarted(phase, endsAt))
    }

    /** IDLE after a natural cycle end: keeps the cycle count and task so the next Start continues the cycle. */
    private fun idleAfterCycle(state: FocusState): FocusState =
        FocusState(completedWorkSessions = state.completedWorkSessions, taskId = state.taskId)
}

/**
 * App-wide owner of the live timer; persists state through FocusRepository.
 *
 * Every event is serialized by a [Mutex], reduced by [FocusTimerStateMachine], its effects applied
 * (session rows inserted at WORK start / updated at WORK end), and the new state persisted with
 * [FocusRepository.saveRunningState]. Completed work phases are reported to gamification *after* the state
 * is persisted; a failing award never breaks the timer.
 */
@Singleton
class FocusSessionManager internal constructor(
    private val repo: FocusRepository,
    private val time: TimeProvider,
    private val onWorkFinished: suspend (FocusSession) -> Unit,
) {
    @Inject
    constructor(
        repo: FocusRepository,
        time: TimeProvider,
        gamification: GamificationService,
    ) : this(repo, time, { session -> gamification.onFocusSessionFinished(session) })

    private val mutex = Mutex()
    private val _state = MutableStateFlow(FocusState())
    /** In-memory copy of the open session row (lost on process death; reconstructed from state if needed). */
    private var openSession: FocusSession? = null

    val state: StateFlow<FocusState> get() = _state.asStateFlow()

    /** Load persisted state (call once at app start). Elapsed phases are resolved immediately. */
    suspend fun restore() {
        mutex.withLock {
            val saved = repo.loadRunningState()
            if (saved != null) _state.value = saved
            catchUpLocked()
        }
    }

    suspend fun start(taskId: Long?) = dispatch(FocusEvent.Start(taskId))
    suspend fun pause() = dispatch(FocusEvent.Pause)
    suspend fun resume() = dispatch(FocusEvent.Resume)
    suspend fun skip() = dispatch(FocusEvent.Skip)
    suspend fun stop() = dispatch(FocusEvent.Stop)

    /** Called by the Android timer service / alarm when phaseEndsAt passes. Idempotent. */
    suspend fun onPhaseMaybeElapsed() {
        mutex.withLock { catchUpLocked() }
    }

    fun isWorkActive(): Boolean = _state.value.let { it.phase == FocusPhase.WORK && !it.paused }

    private suspend fun dispatch(event: FocusEvent) {
        mutex.withLock {
            // Resolve any phase that already ended first, so e.g. Pause never applies to a stale phase.
            catchUpLocked()
            applyLocked(event)
        }
    }

    /** Advances one phase at a time until the current phase has not yet ended (bounded for safety). */
    private suspend fun catchUpLocked() {
        repeat(MAX_CATCH_UP_STEPS) {
            if (!applyLocked(FocusEvent.PhaseElapsed)) return
        }
    }

    /** @return true if the event changed anything. */
    private suspend fun applyLocked(event: FocusEvent): Boolean {
        val config = repo.observeConfig().first()
        val now = time.now()
        val prev = _state.value
        val transition = FocusTimerStateMachine.reduce(prev, event, config, now)
        if (transition.state == prev && transition.effects.isEmpty()) return false

        var next = transition.state
        val toReport = mutableListOf<FocusSession>()
        for (effect in transition.effects) {
            when (effect) {
                is FocusEffect.WorkPhaseFinished -> {
                    val finished = finishSession(prev, effect, config, now)
                    if (effect.completed) toReport += finished
                }
                is FocusEffect.PhaseStarted -> if (effect.phase == FocusPhase.WORK) {
                    val start = next.phaseStartedAt ?: now
                    val row = FocusSession(
                        taskId = next.taskId,
                        startedAt = start,
                        plannedSeconds = Duration.between(start, effect.endsAt).seconds,
                    )
                    val id = repo.insertSession(row)
                    openSession = row.copy(id = id)
                    next = next.copy(currentSessionId = id)
                }
                FocusEffect.TimerStopped -> Unit
            }
        }
        _state.value = next
        repo.saveRunningState(if (next == FocusState()) null else next)
        for (session in toReport) {
            try {
                onWorkFinished(session)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Throwable) {
                // Awards are best-effort (and idempotent on their side); the timer must keep working.
            }
        }
        return true
    }

    private suspend fun finishSession(
        prev: FocusState,
        effect: FocusEffect.WorkPhaseFinished,
        config: FocusConfig,
        now: Instant,
    ): FocusSession {
        val id = prev.currentSessionId
        val base = openSession?.takeIf { id != null && it.id == id } ?: FocusSession(
            id = id ?: 0,
            taskId = prev.taskId,
            startedAt = prev.phaseStartedAt ?: now,
            plannedSeconds = FocusTimerStateMachine.plannedMillis(prev, config) / 1000,
        )
        val endedAt = if (effect.completed) prev.phaseEndsAt ?: now else now
        var finished = base.copy(
            endedAt = endedAt,
            focusedSeconds = effect.focusedSeconds,
            completed = effect.completed,
            interruptions = prev.interruptions,
        )
        if (id != null) {
            repo.updateSession(finished)
        } else {
            finished = finished.copy(id = repo.insertSession(finished.copy(id = 0)))
        }
        openSession = null
        return finished
    }

    private companion object {
        /**
         * The reducer never auto-starts a WORK phase that already fully elapsed, so catch-up settles in at most
         * three steps (WORK -> break -> WORK/IDLE). The bound only guards against a pathological clock.
         */
        const val MAX_CATCH_UP_STEPS = 16
    }
}
