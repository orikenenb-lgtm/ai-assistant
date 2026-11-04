package com.disciplineos.app.ui.focus

import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import java.util.Locale

/** Pure, Android-free helpers for the focus screen (unit-tested in FocusFormatTest). */
object FocusFormat {

    /** "MM:SS", or "H:MM:SS" when an hour or more remains. Negative input is clamped to 0. Rounds up to whole seconds. */
    fun clock(millis: Long): String {
        val totalSeconds = (millis.coerceAtLeast(0L) + 999L) / 1000L
        val hours = totalSeconds / 3600
        val minutes = (totalSeconds % 3600) / 60
        val seconds = totalSeconds % 60
        return if (hours > 0) {
            String.format(Locale.ROOT, "%d:%02d:%02d", hours, minutes, seconds)
        } else {
            String.format(Locale.ROOT, "%02d:%02d", minutes, seconds)
        }
    }

    /** Planned length of [phase] under [config], in millis (0 for IDLE). */
    fun phaseTotalMillis(phase: FocusPhase, config: FocusConfig): Long {
        val minutes = when (phase) {
            FocusPhase.IDLE -> 0
            FocusPhase.WORK -> config.workMinutes
            FocusPhase.SHORT_BREAK -> config.shortBreakMinutes
            FocusPhase.LONG_BREAK -> config.longBreakMinutes
        }
        return minutes.coerceAtLeast(0) * 60_000L
    }

    /**
     * Fraction of the phase that has ELAPSED (0..1). If the config changed mid-phase so that the remaining time is
     * larger than the planned total, the total is widened to the remaining time so progress never goes negative.
     */
    fun elapsedFraction(remainingMillis: Long, totalMillis: Long): Float {
        val remaining = remainingMillis.coerceAtLeast(0L)
        val total = maxOf(totalMillis, remaining)
        if (total <= 0L) return 0f
        return (1f - remaining.toFloat() / total.toFloat()).coerceIn(0f, 1f)
    }

    /**
     * How many of the [perCycle] session dots are filled. During a long break the full cycle is shown as complete;
     * once the next work phase begins the dots reset.
     */
    fun filledDots(completedWorkSessions: Int, perCycle: Int, phase: FocusPhase): Int {
        val n = perCycle.coerceAtLeast(1)
        val completed = completedWorkSessions.coerceAtLeast(0)
        if (completed == 0) return 0
        val mod = completed % n
        return if (mod == 0 && phase == FocusPhase.LONG_BREAK) n else mod
    }

    /** Whole minutes rounded up — used for the accessibility description of the countdown. */
    fun minutesLeftRoundedUp(millis: Long): Int = ((millis.coerceAtLeast(0L) + 59_999L) / 60_000L).toInt()

    /** Bounds for the settings sliders (shared by Focus settings sheet and Settings > Focus defaults). */
    val WORK_RANGE = 5..120
    val SHORT_BREAK_RANGE = 1..30
    val LONG_BREAK_RANGE = 5..60
    val CYCLE_RANGE = 2..8

    /** Clamps every field into its slider range. */
    fun sanitize(config: FocusConfig): FocusConfig = config.copy(
        workMinutes = config.workMinutes.coerceIn(WORK_RANGE),
        shortBreakMinutes = config.shortBreakMinutes.coerceIn(SHORT_BREAK_RANGE),
        longBreakMinutes = config.longBreakMinutes.coerceIn(LONG_BREAK_RANGE),
        sessionsBeforeLongBreak = config.sessionsBeforeLongBreak.coerceIn(CYCLE_RANGE),
    )
}
