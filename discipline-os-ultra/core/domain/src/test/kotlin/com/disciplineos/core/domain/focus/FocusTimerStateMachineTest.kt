package com.disciplineos.core.domain.focus

import com.disciplineos.core.domain.focus.FocusEffect.PhaseStarted
import com.disciplineos.core.domain.focus.FocusEffect.TimerStopped
import com.disciplineos.core.domain.focus.FocusEffect.WorkPhaseFinished
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant

class FocusTimerStateMachineTest {
    private val t0: Instant = Instant.parse("2026-11-04T08:00:00Z")
    private val cfg = FocusConfig() // 25 / 5 / 15, long break every 4, autoStartBreaks, !autoStartWork
    private fun at(min: Long, sec: Long = 0): Instant = t0.plus(Duration.ofMinutes(min)).plusSeconds(sec)
    private fun reduce(s: FocusState, e: FocusEvent, now: Instant, c: FocusConfig = cfg) = FocusTimerStateMachine.reduce(s, e, c, now)

    private fun started(taskId: Long? = 42, c: FocusConfig = cfg) = reduce(FocusState(), FocusEvent.Start(taskId), t0, c).state

    @Test fun start_entersWork() {
        val tr = reduce(FocusState(), FocusEvent.Start(42), t0)
        assertEquals(FocusPhase.WORK, tr.state.phase)
        assertEquals(t0, tr.state.phaseStartedAt)
        assertEquals(at(25), tr.state.phaseEndsAt)
        assertEquals(42L, tr.state.taskId)
        assertEquals(listOf(PhaseStarted(FocusPhase.WORK, at(25))), tr.effects)
    }

    @Test fun phaseElapsed_beforeEnd_isNoOp() {
        val s = started()
        val tr = reduce(s, FocusEvent.PhaseElapsed, at(24, 59))
        assertEquals(s, tr.state)
        assertTrue(tr.effects.isEmpty())
    }

    @Test fun fullPomodoroCycle_withLongBreak() {
        val c = cfg.copy(autoStartWork = true)
        var s = started(c = c)
        var now = t0
        val breaks = mutableListOf<FocusPhase>()
        repeat(8) { i ->
            now = s.phaseEndsAt!!
            val work = reduce(s, FocusEvent.PhaseElapsed, now, c)
            assertEquals(WorkPhaseFinished(1500, completed = true), work.effects.first())
            assertEquals(i + 1, work.state.completedWorkSessions)
            breaks += work.state.phase
            assertEquals(now, work.state.phaseStartedAt) // anchored at previous end
            now = work.state.phaseEndsAt!!
            val brk = reduce(work.state, FocusEvent.PhaseElapsed, now, c)
            assertEquals(FocusPhase.WORK, brk.state.phase)
            assertEquals(listOf(PhaseStarted(FocusPhase.WORK, now.plus(Duration.ofMinutes(25)))), brk.effects)
            s = brk.state
        }
        val S = FocusPhase.SHORT_BREAK
        val L = FocusPhase.LONG_BREAK
        assertEquals(listOf(S, S, S, L, S, S, S, L), breaks)
        // 8 × (25) + 6 × 5 + 2 × 15 minutes
        assertEquals(at(8 * 25 + 6 * 5 + 2 * 15), s.phaseStartedAt)
    }

    @Test fun longBreakHasConfiguredLength() {
        val c = cfg.copy(sessionsBeforeLongBreak = 1)
        val tr = reduce(started(c = c), FocusEvent.PhaseElapsed, at(25), c)
        assertEquals(FocusPhase.LONG_BREAK, tr.state.phase)
        assertEquals(at(40), tr.state.phaseEndsAt)
        assertEquals(listOf(WorkPhaseFinished(1500, true), PhaseStarted(FocusPhase.LONG_BREAK, at(40))), tr.effects)
    }

    @Test fun breakElapsed_withoutAutoStartWork_goesIdle_keepingCycle() {
        val brk = reduce(started(), FocusEvent.PhaseElapsed, at(25)).state
        val idle = reduce(brk, FocusEvent.PhaseElapsed, at(30))
        assertEquals(FocusState(completedWorkSessions = 1, taskId = 42), idle.state)
        assertTrue(idle.effects.isEmpty())
        // next start continues the cycle
        val again = reduce(idle.state, FocusEvent.Start(42), at(31)).state
        assertEquals(1, again.completedWorkSessions)
        assertEquals(FocusPhase.WORK, again.phase)
    }

    @Test fun noAutoStartBreaks_goesIdleAfterCountingSession() {
        val c = cfg.copy(autoStartBreaks = false)
        val tr = reduce(started(c = c), FocusEvent.PhaseElapsed, at(25), c)
        assertEquals(FocusState(completedWorkSessions = 1, taskId = 42), tr.state)
        assertEquals(listOf(WorkPhaseFinished(1500, true)), tr.effects)
    }

    @Test fun pauseResume_excludesPausedTime() {
        val paused = reduce(started(), FocusEvent.Pause, at(10)).state
        assertTrue(paused.paused)
        assertNull(paused.phaseEndsAt)
        assertEquals(15 * 60_000L, paused.pausedRemainingMillis)
        assertEquals(1, paused.interruptions)
        assertEquals(Duration.ofMinutes(15), FocusTimerStateMachine.remaining(paused, at(100)))
        // remaining does not tick while paused; PhaseElapsed is ignored while paused
        assertEquals(paused, reduce(paused, FocusEvent.PhaseElapsed, at(100)).state)

        val resumed = reduce(paused, FocusEvent.Resume, at(40)).state
        assertFalse(resumed.paused)
        assertNull(resumed.pausedRemainingMillis)
        assertEquals(at(55), resumed.phaseEndsAt)
        assertEquals(at(30), resumed.phaseStartedAt) // virtual start: 10 min already focused
        assertEquals(Duration.ofMinutes(10), FocusTimerStateMachine.remaining(resumed, at(45)))
        assertEquals(900, FocusTimerStateMachine.focusedSeconds(resumed, cfg, at(45)))

        val done = reduce(resumed, FocusEvent.PhaseElapsed, at(55))
        assertEquals(WorkPhaseFinished(1500, completed = true), done.effects.first())
        assertEquals(1, done.state.interruptions) // carried into the break so the session row can record it
    }

    @Test fun pauseInBreak_doesNotCountInterruption() {
        val brk = reduce(started(), FocusEvent.PhaseElapsed, at(25)).state
        val p = reduce(brk, FocusEvent.Pause, at(27)).state
        assertTrue(p.paused)
        assertEquals(0, p.interruptions)
        assertEquals(3 * 60_000L, p.pausedRemainingMillis)
        val r = reduce(p, FocusEvent.Resume, at(50)).state
        assertEquals(at(53), r.phaseEndsAt)
    }

    @Test fun skipInWork_reportsActualFocus_thenShortBreakNow() {
        val tr = reduce(started(), FocusEvent.Skip, at(7))
        assertEquals(listOf(WorkPhaseFinished(420, completed = false), PhaseStarted(FocusPhase.SHORT_BREAK, at(12))), tr.effects)
        assertEquals(FocusPhase.SHORT_BREAK, tr.state.phase)
        assertEquals(0, tr.state.completedWorkSessions)
    }

    @Test fun skipInWorkWhilePaused_usesPausedRemaining() {
        val p = reduce(started(), FocusEvent.Pause, at(5)).state
        val tr = reduce(p, FocusEvent.Skip, at(90))
        assertEquals(WorkPhaseFinished(300, completed = false), tr.effects.first())
    }

    @Test fun skipInWork_noAutoBreaks_goesIdle() {
        val c = cfg.copy(autoStartBreaks = false)
        val tr = reduce(started(c = c), FocusEvent.Skip, at(3), c)
        assertEquals(FocusPhase.IDLE, tr.state.phase)
        assertEquals(listOf(WorkPhaseFinished(180, false)), tr.effects)
    }

    @Test fun skipInBreak_followsAutoStartWork() {
        val brk = reduce(started(), FocusEvent.PhaseElapsed, at(25)).state
        assertEquals(FocusPhase.IDLE, reduce(brk, FocusEvent.Skip, at(26)).state.phase)
        val c = cfg.copy(autoStartWork = true)
        val tr = reduce(brk, FocusEvent.Skip, at(26), c)
        assertEquals(FocusPhase.WORK, tr.state.phase)
        assertEquals(at(51), tr.state.phaseEndsAt)
        assertEquals(listOf(PhaseStarted(FocusPhase.WORK, at(51))), tr.effects)
    }

    @Test fun stopInWork_reportsPartial_andResets() {
        val tr = reduce(started(), FocusEvent.Stop, at(12, 30))
        assertEquals(FocusState(), tr.state)
        assertEquals(listOf(WorkPhaseFinished(750, completed = false), TimerStopped), tr.effects)
    }

    @Test fun stopImmediately_hasNoWorkEffect() {
        val tr = reduce(started(), FocusEvent.Stop, t0)
        assertEquals(listOf(TimerStopped), tr.effects)
    }

    @Test fun stopInBreak_onlyStops() {
        val brk = reduce(started(), FocusEvent.PhaseElapsed, at(25)).state
        val tr = reduce(brk, FocusEvent.Stop, at(26))
        assertEquals(FocusState(), tr.state)
        assertEquals(listOf(TimerStopped), tr.effects)
    }

    @Test fun invalidEvents_areIgnored() {
        val idle = FocusState()
        for (e in listOf(FocusEvent.Pause, FocusEvent.Resume, FocusEvent.Skip, FocusEvent.Stop, FocusEvent.PhaseElapsed)) {
            assertEquals(e.toString(), FocusTransition(idle, emptyList()), reduce(idle, e, t0))
        }
        val work = started()
        assertEquals(FocusTransition(work, emptyList()), reduce(work, FocusEvent.Start(1), at(1)))
        assertEquals(FocusTransition(work, emptyList()), reduce(work, FocusEvent.Resume, at(1)))
        val paused = reduce(work, FocusEvent.Pause, at(1)).state
        assertEquals(FocusTransition(paused, emptyList()), reduce(paused, FocusEvent.Pause, at(2)))
        assertEquals(FocusTransition(paused, emptyList()), reduce(paused, FocusEvent.Start(1), at(2)))
        // pausing after the end passed must not freeze an elapsed phase
        assertEquals(FocusTransition(work, emptyList()), reduce(work, FocusEvent.Pause, at(30)))
    }

    @Test fun sleepGap_oneEventAdvancesOnePhase_creditsOnlyPlannedLength() {
        val s = started()
        val later = at(5 * 60) // device slept for 5 hours
        val first = reduce(s, FocusEvent.PhaseElapsed, later)
        assertEquals(WorkPhaseFinished(1500, completed = true), first.effects.first())
        assertEquals(FocusPhase.SHORT_BREAK, first.state.phase)
        assertEquals(at(25), first.state.phaseStartedAt)
        assertEquals(at(30), first.state.phaseEndsAt)
        val second = reduce(first.state, FocusEvent.PhaseElapsed, later)
        assertEquals(FocusPhase.IDLE, second.state.phase)
        assertTrue(second.effects.isEmpty())
        assertEquals(FocusTransition(second.state, emptyList()), reduce(second.state, FocusEvent.PhaseElapsed, later))
    }

    @Test fun sleepGap_withAutoStartWork_neverFabricatesUnobservedWorkPhases() {
        val c = cfg.copy(autoStartWork = true)
        val later = at(5 * 60)
        var s = started(c = c)
        var credited = 0L
        var steps = 0
        while (true) {
            val tr = reduce(s, FocusEvent.PhaseElapsed, later, c)
            if (tr.state == s && tr.effects.isEmpty()) break
            credited += tr.effects.filterIsInstance<WorkPhaseFinished>().sumOf { it.focusedSeconds }
            s = tr.state
            steps++
        }
        assertEquals(1500L, credited) // only the phase the user actually started
        assertEquals(2, steps)
        assertEquals(FocusPhase.IDLE, s.phase)
    }

    @Test fun shortGap_withAutoStartWork_landsInCurrentWorkPhase() {
        val c = cfg.copy(autoStartWork = true)
        val now = at(40) // work ended 25, break ended 30, next work 30..55 is current
        val brk = reduce(started(c = c), FocusEvent.PhaseElapsed, now, c).state
        val work = reduce(brk, FocusEvent.PhaseElapsed, now, c)
        assertEquals(FocusPhase.WORK, work.state.phase)
        assertEquals(at(30), work.state.phaseStartedAt)
        assertEquals(at(55), work.state.phaseEndsAt)
        assertEquals(Duration.ofMinutes(15), FocusTimerStateMachine.remaining(work.state, now))
    }

    @Test fun remaining_handlesAllStates() {
        assertEquals(Duration.ZERO, FocusTimerStateMachine.remaining(FocusState(), t0))
        val s = started()
        assertEquals(Duration.ofMinutes(20), FocusTimerStateMachine.remaining(s, at(5)))
        assertEquals(Duration.ZERO, FocusTimerStateMachine.remaining(s, at(90)))
    }

    @Test fun focusedSeconds_isClampedToPlanned() {
        val s = started()
        assertEquals(1500, FocusTimerStateMachine.focusedSeconds(s, cfg, at(600)))
        assertEquals(0, FocusTimerStateMachine.focusedSeconds(s, cfg, t0.minusSeconds(30)))
        // skip long after the end (unobserved) never credits more than planned
        assertEquals(WorkPhaseFinished(1500, false), reduce(s, FocusEvent.Skip, at(600)).effects.first())
    }

    // ---- planned length captured at phase start (config edits mid-phase must not change it) ----

    @Test fun startPhase_capturesPlannedLength() {
        assertEquals(25 * 60_000L, started().phasePlannedMillis)
        val brk = reduce(started(), FocusEvent.PhaseElapsed, at(25)).state
        assertEquals(FocusPhase.SHORT_BREAK, brk.phase)
        assertEquals(5 * 60_000L, brk.phasePlannedMillis)
    }

    @Test fun workLengthEditedDuringPause_resumeAndCreditUseOriginalPlannedLength() {
        val s = started() // 25 min planned
        val paused = reduce(s, FocusEvent.Pause, at(10)).state // 10 min focused, 15 remaining
        val edited = cfg.copy(workMinutes = 50)
        // While paused, the credited time is still 10 minutes (would be 35 with the new 50-minute config).
        assertEquals(600L, FocusTimerStateMachine.focusedSeconds(paused, edited, at(20)))
        val resumed = reduce(paused, FocusEvent.Resume, at(20), edited).state
        assertEquals(at(35), resumed.phaseEndsAt)
        assertEquals(at(10), resumed.phaseStartedAt) // virtual start: 25-min phase with 15 remaining
        assertEquals(25 * 60_000L, resumed.phasePlannedMillis)
        // Stop 5 minutes after resume: 15 minutes focused in total.
        val stop = reduce(resumed, FocusEvent.Stop, at(25), edited)
        assertEquals(WorkPhaseFinished(900, completed = false), stop.effects.first())
        // Natural finish credits exactly the original 25 minutes.
        val done = reduce(resumed, FocusEvent.PhaseElapsed, at(35), edited)
        assertEquals(WorkPhaseFinished(1500, completed = true), done.effects.first())
    }

    @Test fun workLengthShortenedDuringPause_creditNotClampedToNewLength() {
        val paused = reduce(started(), FocusEvent.Pause, at(20)).state // 20 min focused
        val edited = cfg.copy(workMinutes = 10)
        assertEquals(1200L, FocusTimerStateMachine.focusedSeconds(paused, edited, at(30)))
        val resumed = reduce(paused, FocusEvent.Resume, at(30), edited).state
        assertEquals(at(35), resumed.phaseEndsAt)
        assertEquals(at(10), resumed.phaseStartedAt)
    }

    @Test fun legacyStateWithoutPlannedLength_fallsBackToConfig() {
        // State persisted before phasePlannedMillis existed.
        val legacy = reduce(started(), FocusEvent.Pause, at(10)).state.copy(phasePlannedMillis = null)
        assertEquals(600L, FocusTimerStateMachine.focusedSeconds(legacy, cfg, at(12)))
        val resumed = reduce(legacy, FocusEvent.Resume, at(12)).state
        assertEquals(at(27), resumed.phaseEndsAt)
        assertEquals(at(2), resumed.phaseStartedAt)
        assertEquals(WorkPhaseFinished(1500, completed = true), reduce(resumed, FocusEvent.PhaseElapsed, at(27)).effects.first())
    }
}
