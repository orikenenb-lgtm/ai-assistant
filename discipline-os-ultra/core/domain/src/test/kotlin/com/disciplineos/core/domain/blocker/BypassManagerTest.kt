package com.disciplineos.core.domain.blocker

import app.cash.turbine.test
import com.disciplineos.core.domain.focus.MutableTimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration

class BypassManagerTest {
    private val start = localInstant(2026, 11, 4, 10, 0)
    private val clock = MutableTimeProvider(start, TEST_ZONE)
    private val repo = FakeBlockerRepository(
        BlockerConfig(enabled = true, bypassDurationMinutes = 10, maxBypassesPerDay = 3, bypassCooldownMinutes = 30),
    )
    private val manager = BypassManager(repo, clock)

    private fun granted(r: BypassResult): BypassSession {
        assertTrue("expected grant but was $r", r is BypassResult.Granted)
        return (r as BypassResult.Granted).session
    }

    private fun denied(r: BypassResult, denial: BypassDenial): BypassResult.Denied {
        assertTrue("expected $denial but was $r", r is BypassResult.Denied && r.denial == denial)
        return r as BypassResult.Denied
    }

    @Test fun grant_isPersisted_withDuration_andTrimmedNote() = runTest {
        val longNote = "  " + "א".repeat(250) + "  "
        val s = granted(manager.request(BypassReason.WORK_OR_STUDY, longNote))
        assertEquals(start, s.startedAt)
        assertEquals(start.plus(Duration.ofMinutes(10)), s.endsAt)
        assertEquals(200, s.note.length)
        assertTrue(s.id > 0)
        assertEquals(listOf(s), repo.bypasses.value)
    }

    @Test fun duration_isClampedTo1to60() = runTest {
        repo.config.value = repo.config.value.copy(bypassDurationMinutes = 0, bypassCooldownMinutes = 0)
        assertEquals(Duration.ofMinutes(1), granted(manager.request(BypassReason.OTHER, "")).let { Duration.between(it.startedAt, it.endsAt) })
        clock.advanceMinutes(2)
        repo.config.value = repo.config.value.copy(bypassDurationMinutes = 500)
        assertEquals(Duration.ofMinutes(60), granted(manager.request(BypassReason.OTHER, "")).let { Duration.between(it.startedAt, it.endsAt) })
    }

    @Test fun alreadyActive_isDenied_evenForEmergency() = runTest {
        val s = granted(manager.request(BypassReason.HEALTH, "x"))
        clock.advanceMinutes(3)
        assertEquals(s.endsAt, denied(manager.request(BypassReason.OTHER, ""), BypassDenial.ALREADY_ACTIVE).retryAt)
        denied(manager.request(BypassReason.EMERGENCY, ""), BypassDenial.ALREADY_ACTIVE)
    }

    @Test fun dailyLimit_enforced_retryAtNextLocalMidnight() = runTest {
        repo.config.value = repo.config.value.copy(maxBypassesPerDay = 2, bypassCooldownMinutes = 0)
        granted(manager.request(BypassReason.OTHER, ""))
        clock.advanceMinutes(11)
        granted(manager.request(BypassReason.OTHER, ""))
        clock.advanceMinutes(11)
        val d = denied(manager.request(BypassReason.OTHER, ""), BypassDenial.DAILY_LIMIT_REACHED)
        assertEquals(localInstant(2026, 11, 5, 0, 0), d.retryAt)
    }

    @Test fun zeroDailyLimit_deniesNonEmergency_butEmergencyGranted() = runTest {
        repo.config.value = repo.config.value.copy(maxBypassesPerDay = 0)
        denied(manager.request(BypassReason.WORK_OR_STUDY, ""), BypassDenial.DAILY_LIMIT_REACHED)
        granted(manager.request(BypassReason.EMERGENCY, "call"))
    }

    @Test fun cooldown_measuredFromEnd_thenGranted() = runTest {
        val s = granted(manager.request(BypassReason.OTHER, ""))
        clock.advanceMinutes(12)
        val d = denied(manager.request(BypassReason.OTHER, ""), BypassDenial.COOLDOWN)
        assertEquals(s.endsAt.plus(Duration.ofMinutes(30)), d.retryAt)
        clock.current = s.endsAt.plus(Duration.ofMinutes(30))
        granted(manager.request(BypassReason.OTHER, ""))
    }

    @Test fun cooldown_startsAtEarlyEnd() = runTest {
        val s = granted(manager.request(BypassReason.OTHER, ""))
        clock.advanceMinutes(2)
        manager.endEarly(s.id)
        val ended = repo.bypasses.value.single()
        assertEquals(clock.now(), ended.endedEarlyAt)
        clock.advanceMinutes(1)
        val d = denied(manager.request(BypassReason.OTHER, ""), BypassDenial.COOLDOWN)
        assertEquals(start.plus(Duration.ofMinutes(32)), d.retryAt)
    }

    @Test fun emergency_overridesLimitAndCooldown_andDoesNotConsumeQuota() = runTest {
        repo.config.value = repo.config.value.copy(maxBypassesPerDay = 1)
        granted(manager.request(BypassReason.OTHER, ""))
        clock.advanceMinutes(11) // ended; in cooldown and at limit
        denied(manager.request(BypassReason.OTHER, ""), BypassDenial.DAILY_LIMIT_REACHED)
        val e = granted(manager.request(BypassReason.EMERGENCY, "חירום"))
        assertEquals(Duration.ofMinutes(10), Duration.between(e.startedAt, e.endsAt))
        clock.advanceMinutes(11)
        val e2 = granted(manager.request(BypassReason.EMERGENCY, ""))
        assertEquals(3, repo.bypasses.value.size)
        assertEquals(clock.now(), e2.startedAt)

        // Emergencies alone neither consume quota nor start a cooldown.
        val fresh = FakeBlockerRepository(repo.config.value.copy(maxBypassesPerDay = 1))
        val m2 = BypassManager(fresh, clock)
        granted(m2.request(BypassReason.EMERGENCY, ""))
        clock.advanceMinutes(11)
        granted(m2.request(BypassReason.OTHER, ""))
    }

    @Test fun limitResetsAtLocalMidnight_notUtcMidnight() = runTest {
        // Asia/Jerusalem is UTC+2 in November: 23:00 local = 21:00Z and 00:05 local next day = 22:05Z, the SAME UTC date.
        clock.current = localInstant(2026, 11, 4, 23, 0)
        repo.config.value = repo.config.value.copy(maxBypassesPerDay = 1, bypassCooldownMinutes = 30)
        granted(manager.request(BypassReason.OTHER, ""))
        clock.advanceMinutes(15)
        denied(manager.request(BypassReason.OTHER, ""), BypassDenial.DAILY_LIMIT_REACHED)
        clock.current = localInstant(2026, 11, 5, 0, 5) // new local day; cooldown ended at 23:40
        granted(manager.request(BypassReason.OTHER, ""))
    }

    @Test fun cooldownSpansMidnight() = runTest {
        clock.current = localInstant(2026, 11, 4, 23, 50)
        granted(manager.request(BypassReason.OTHER, "")) // ends 00:00
        clock.current = localInstant(2026, 11, 5, 0, 10)
        val d = denied(manager.request(BypassReason.OTHER, ""), BypassDenial.COOLDOWN)
        assertEquals(localInstant(2026, 11, 5, 0, 30), d.retryAt)
    }

    @Test fun notRestricting_whenDisabledOrInRecovery() = runTest {
        repo.config.value = repo.config.value.copy(enabled = false)
        denied(manager.request(BypassReason.OTHER, ""), BypassDenial.BLOCKER_NOT_RESTRICTING)
        repo.config.value = repo.config.value.copy(enabled = true, recoveryUntil = start.plus(Duration.ofHours(1)))
        denied(manager.request(BypassReason.EMERGENCY, ""), BypassDenial.BLOCKER_NOT_RESTRICTING)
        assertTrue(repo.bypasses.value.isEmpty())
    }

    @Test fun observeAvailability_tracksGrantsCooldownAndActive() = runTest {
        manager.observeAvailability().test {
            assertEquals(BypassAvailability(remainingToday = 3, nextAllowedAt = null, active = null), awaitItem())
            val s = granted(manager.request(BypassReason.OTHER, ""))
            val a = awaitItemMatching { it.active != null }
            assertEquals(2, a.remainingToday)
            assertEquals(s.copy(), a.active)
            assertEquals(s.endsAt.plus(Duration.ofMinutes(30)), a.nextAllowedAt)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun recoveryMode_clampsAndClears() = runTest {
        val recovery = RecoveryModeUseCase(repo, clock)
        recovery.enable(5)
        assertEquals(start.plus(Duration.ofHours(5)), repo.config.value.recoveryUntil)
        recovery.enable(0)
        assertEquals(start.plus(Duration.ofHours(1)), repo.config.value.recoveryUntil)
        recovery.enable(500)
        assertEquals(start.plus(Duration.ofHours(72)), repo.config.value.recoveryUntil)
        recovery.disable()
        assertNull(repo.config.value.recoveryUntil)
    }

    @Test fun recoveryMode_makesPolicyAllow_untilExpiry() = runTest {
        RecoveryModeUseCase(repo, clock).enable(2)
        val t = task(1)
        val i = BlockPolicyInput(
            config = repo.config.value,
            blockedPackages = setOf("com.instagram.android"),
            openOccurrences = listOf(occ(1, t, clock.today())),
            activeBypass = null,
            focusWorkActive = false,
            now = clock.now(),
            today = clock.today(),
            ownPackage = "own",
        )
        assertEquals(BlockDecision.Allow(AllowReason.RECOVERY_MODE), BlockPolicyEngine.decide(i, "com.instagram.android"))
        val later = i.copy(now = clock.now().plus(Duration.ofHours(2)))
        assertTrue(BlockPolicyEngine.decide(later, "com.instagram.android") is BlockDecision.Block)
    }
}

/** Awaits items until one matches [predicate] (flows here may re-emit identical values on ticks). */
suspend fun <T> app.cash.turbine.ReceiveTurbine<T>.awaitItemMatching(predicate: (T) -> Boolean): T {
    while (true) {
        val item = awaitItem()
        if (predicate(item)) return item
    }
}
