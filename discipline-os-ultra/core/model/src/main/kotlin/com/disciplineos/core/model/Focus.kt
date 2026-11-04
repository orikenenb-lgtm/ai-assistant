package com.disciplineos.core.model

import java.time.Instant

data class FocusConfig(
    val workMinutes: Int = 25,
    val shortBreakMinutes: Int = 5,
    val longBreakMinutes: Int = 15,
    val sessionsBeforeLongBreak: Int = 4,
    val autoStartBreaks: Boolean = true,
    val autoStartWork: Boolean = false,
)

enum class FocusPhase { IDLE, WORK, SHORT_BREAK, LONG_BREAK }

/** Persisted record of a completed or abandoned work phase. */
data class FocusSession(
    val id: Long = 0,
    val taskId: Long? = null,
    val startedAt: Instant,
    val endedAt: Instant? = null,
    val plannedSeconds: Long,
    val focusedSeconds: Long = 0,
    val completed: Boolean = false,
    val interruptions: Int = 0,
)

/**
 * Live timer state. Time is derived from timestamps (never from a ticking counter), so it survives
 * process death and Doze: remaining = phaseEndsAt - now (or [pausedRemainingMillis] while paused).
 */
data class FocusState(
    val phase: FocusPhase = FocusPhase.IDLE,
    val paused: Boolean = false,
    val phaseStartedAt: java.time.Instant? = null,
    val phaseEndsAt: java.time.Instant? = null,
    val pausedRemainingMillis: Long? = null,
    val completedWorkSessions: Int = 0,
    val taskId: Long? = null,
    val currentSessionId: Long? = null,
    val interruptions: Int = 0,
)
