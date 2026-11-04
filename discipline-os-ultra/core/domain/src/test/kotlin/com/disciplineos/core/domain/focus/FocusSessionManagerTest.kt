package com.disciplineos.core.domain.focus

import com.disciplineos.core.domain.gamification.GamificationService
import com.disciplineos.core.model.FocusConfig
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusSession
import com.disciplineos.core.model.FocusState
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.Instant
import javax.inject.Inject

class FocusSessionManagerTest {
    private val t0: Instant = Instant.parse("2026-11-04T08:00:00Z")
    private val clock = MutableTimeProvider(t0)
    private val repo = FakeFocusRepository()
    private val reported = mutableListOf<FocusSession>()
    private val manager = FocusSessionManager(repo, clock) { reported += it }

    private fun at(min: Long): Instant = t0.plus(Duration.ofMinutes(min))

    @Test fun start_insertsSession_andPersistsState() = runTest {
        manager.start(7)
        val s = manager.state.value
        assertEquals(FocusPhase.WORK, s.phase)
        assertTrue(manager.isWorkActive())
        val row = repo.sessions.value.single()
        assertEquals(row.id, s.currentSessionId)
        assertEquals(FocusSession(id = row.id, taskId = 7, startedAt = t0, plannedSeconds = 1500), row)
        assertEquals(s, repo.savedState)
    }

    @Test fun phaseElapsed_completesSession_reportsOnce_idempotent() = runTest {
        manager.start(7)
        clock.current = at(24)
        manager.onPhaseMaybeElapsed()
        assertEquals(FocusPhase.WORK, manager.state.value.phase)
        assertTrue(reported.isEmpty())

        clock.current = at(26)
        manager.onPhaseMaybeElapsed()
        manager.onPhaseMaybeElapsed()
        val row = repo.sessions.value.single()
        assertTrue(row.completed)
        assertEquals(1500, row.focusedSeconds)
        assertEquals(at(25), row.endedAt)
        assertEquals(listOf(row), reported)
        val s = manager.state.value
        assertEquals(FocusPhase.SHORT_BREAK, s.phase)
        assertEquals(1, s.completedWorkSessions)
        assertNull(s.currentSessionId)
        assertFalse(manager.isWorkActive())
        assertEquals(s, repo.savedState)
    }

    @Test fun pauseCountsInterruption_inSessionRow() = runTest {
        manager.start(null)
        clock.current = at(5); manager.pause()
        assertFalse(manager.isWorkActive())
        clock.current = at(15); manager.resume()
        clock.current = at(35)
        manager.onPhaseMaybeElapsed()
        val row = repo.sessions.value.single()
        assertEquals(1, row.interruptions)
        assertEquals(1500, row.focusedSeconds)
        assertEquals(at(35), row.endedAt)
    }

    @Test fun stopAndSkip_recordPartialSessions_withoutRewards() = runTest {
        manager.start(1)
        clock.current = at(10)
        manager.skip()
        assertEquals(FocusPhase.SHORT_BREAK, manager.state.value.phase)
        clock.current = at(11)
        manager.skip() // break -> IDLE (autoStartWork = false)
        manager.start(1)
        clock.current = at(20)
        manager.stop()

        val rows = repo.sessions.value
        assertEquals(2, rows.size)
        assertEquals(listOf(600L, 540L), rows.map { it.focusedSeconds })
        assertTrue(rows.none { it.completed })
        assertTrue(reported.isEmpty())
        assertEquals(FocusState(), manager.state.value)
        assertNull(repo.savedState)
    }

    @Test fun restore_afterLongSleep_catchesUp_creditingOnlyPlanned() = runTest {
        // Previous process: WORK started at t0, session row 1 inserted, then the process died.
        repo.insertSession(FocusSession(taskId = 3, startedAt = t0, plannedSeconds = 1500))
        repo.savedState = FocusState(
            phase = FocusPhase.WORK, phaseStartedAt = t0, phaseEndsAt = at(25), taskId = 3, currentSessionId = 1,
        )
        clock.current = at(6 * 60)
        val fresh = FocusSessionManager(repo, clock) { reported += it }
        fresh.restore()

        assertEquals(FocusState(completedWorkSessions = 1, taskId = 3), fresh.state.value)
        val row = repo.sessions.value.single()
        assertTrue(row.completed)
        assertEquals(1500, row.focusedSeconds)
        assertEquals(at(25), row.endedAt)
        assertEquals(1, reported.size)
        assertEquals(fresh.state.value, repo.savedState)
    }

    @Test fun restore_runningPhase_isResumedUnchanged() = runTest {
        val saved = FocusState(phase = FocusPhase.WORK, phaseStartedAt = t0, phaseEndsAt = at(25), currentSessionId = 9)
        repo.savedState = saved
        clock.current = at(10)
        manager.restore()
        assertEquals(saved, manager.state.value)
        assertTrue(manager.isWorkActive())
        assertTrue(reported.isEmpty())
    }

    @Test fun restore_nothingSaved_staysIdle() = runTest {
        manager.restore()
        assertEquals(FocusState(), manager.state.value)
        assertEquals(0, repo.saveCount)
    }

    @Test fun restore_withoutSessionRow_insertsCompletedRecord() = runTest {
        repo.savedState = FocusState(phase = FocusPhase.WORK, phaseStartedAt = t0, phaseEndsAt = at(25))
        clock.current = at(26)
        manager.restore()
        val row = repo.sessions.value.single()
        assertTrue(row.completed)
        assertEquals(1500, row.focusedSeconds)
        assertEquals(row, reported.single())
    }

    @Test fun eventsAfterUnobservedEnd_resolveElapsedPhaseFirst() = runTest {
        manager.start(null)
        clock.current = at(27) // work ended at 25 but no alarm processed yet
        manager.pause()      // must not freeze the finished work phase
        assertEquals(1, reported.size)
        val s = manager.state.value
        assertEquals(FocusPhase.SHORT_BREAK, s.phase)
        assertTrue(s.paused)
        assertEquals(3 * 60_000L, s.pausedRemainingMillis)
    }

    @Test fun failingReward_doesNotBreakTimer() = runTest {
        val m = FocusSessionManager(repo, clock) { error("gamification down") }
        m.start(null)
        clock.current = at(25)
        m.onPhaseMaybeElapsed()
        assertEquals(FocusPhase.SHORT_BREAK, m.state.value.phase)
        assertEquals(m.state.value, repo.savedState)
        assertTrue(repo.sessions.value.single().completed)
    }

    @Test fun concurrentEvents_areSerialized() = runTest {
        (1..20).map { async { manager.start(it.toLong()) } }.awaitAll()
        assertEquals(1, repo.sessions.value.size)
        assertEquals(FocusPhase.WORK, manager.state.value.phase)
    }

    @Test fun configIsReadPerEvent() = runTest {
        repo.config.value = FocusConfig(workMinutes = 50)
        manager.start(null)
        assertEquals(at(50), manager.state.value.phaseEndsAt)
        assertEquals(3000, repo.sessions.value.single().plannedSeconds)
    }

    @Test fun publicInjectConstructor_keepsGamificationSignature() {
        val ctor = FocusSessionManager::class.java.constructors.single { it.isAnnotationPresent(Inject::class.java) }
        assertEquals(
            listOf(
                com.disciplineos.core.domain.repository.FocusRepository::class.java,
                com.disciplineos.core.domain.time.TimeProvider::class.java,
                GamificationService::class.java,
            ),
            ctor.parameterTypes.toList(),
        )
    }
}
