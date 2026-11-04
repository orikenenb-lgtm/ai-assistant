package com.disciplineos.core.domain.focus

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.domain.repository.FocusRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.StateFlow
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

/** Pure reducer. */
object FocusTimerStateMachine {
    fun reduce(state: FocusState, event: FocusEvent, config: FocusConfig, now: Instant): FocusTransition = TODO("Blocker/Focus agent")
    fun remaining(state: FocusState, now: Instant): Duration = TODO()
}

/** App-wide owner of the live timer; persists state through FocusRepository. */
@Singleton
class FocusSessionManager @Inject constructor(
    private val repo: FocusRepository,
    private val time: TimeProvider,
    private val gamification: GamificationService,
) {
    val state: StateFlow<FocusState> get() = TODO()
    /** Load persisted state (call once at app start). Elapsed phases are resolved immediately. */
    suspend fun restore(): Unit = TODO()
    suspend fun start(taskId: Long?): Unit = TODO()
    suspend fun pause(): Unit = TODO()
    suspend fun resume(): Unit = TODO()
    suspend fun skip(): Unit = TODO()
    suspend fun stop(): Unit = TODO()
    /** Called by the Android timer service / alarm when phaseEndsAt passes. Idempotent. */
    suspend fun onPhaseMaybeElapsed(): Unit = TODO()
    fun isWorkActive(): Boolean = TODO()
}
