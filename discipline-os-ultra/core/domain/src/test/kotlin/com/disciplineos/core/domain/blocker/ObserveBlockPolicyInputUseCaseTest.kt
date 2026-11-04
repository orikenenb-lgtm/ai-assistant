package com.disciplineos.core.domain.blocker

import app.cash.turbine.test
import com.disciplineos.core.domain.focus.FakeFocusRepository
import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.focus.MutableTimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.LocalDate

@OptIn(ExperimentalCoroutinesApi::class)
class ObserveBlockPolicyInputUseCaseTest {
    private val tick = 15_000L
    private val clock = MutableTimeProvider(localInstant(2026, 11, 4, 23, 50), TEST_ZONE)
    private val tasks = FakeTaskRepository()
    private val blocker = FakeBlockerRepository()
    private val focusRepo = FakeFocusRepository()
    private val focus = FocusSessionManager(focusRepo, clock) { }
    private val useCase = ObserveBlockPolicyInputUseCase(tasks, blocker, focus, clock)

    @Test fun combinesSources_enabledAppsOnly_andProtectedInputs() = runTest {
        blocker.apps.value = listOf(
            BlockedApp("com.instagram.android", "אינסטגרם"),
            BlockedApp("com.roblox.client", "רובלוקס", enabled = false),
        )
        val t = task(1)
        tasks.occurrences.value = listOf(occ(1, t, LocalDate.of(2026, 11, 4)))
        useCase("com.disciplineos.app", setOf("com.oem.launcher"), tick).test {
            val i = awaitItem()
            assertEquals(setOf("com.instagram.android"), i.blockedPackages)
            assertEquals(LocalDate.of(2026, 11, 4), i.today)
            assertEquals(clock.now(), i.now)
            assertEquals("com.disciplineos.app", i.ownPackage)
            assertEquals(setOf("com.oem.launcher"), i.deviceProtectedPackages)
            assertEquals(1, i.openOccurrences.size)
            assertFalse(i.focusWorkActive)
            assertTrue(BlockPolicyEngine.decide(i, "com.instagram.android") is BlockDecision.Block)

            // completing the task (repo re-emits) -> allow
            tasks.occurrences.value = emptyList()
            val after = awaitItemMatching { it.openOccurrences.isEmpty() }
            assertEquals(BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(after, "com.instagram.android"))
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun focusWorkState_isObserved() = runTest {
        useCase("own", emptySet(), tick).test {
            assertFalse(awaitItem().focusWorkActive)
            focus.start(taskId = null)
            assertTrue(awaitItemMatching { it.focusWorkActive }.focusWorkActive)
            focus.pause()
            assertFalse(awaitItemMatching { !it.focusWorkActive }.focusWorkActive)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun bypassExpiry_isObservedByTicker() = runTest {
        val start = clock.now()
        blocker.bypasses.value = listOf(
            BypassSession(id = 1, startedAt = start, endsAt = start.plus(Duration.ofMinutes(1)), reason = BypassReason.OTHER),
        )
        useCase("own", emptySet(), tick).test {
            assertEquals(1L, awaitItem().activeBypass?.id)
            clock.advance(Duration.ofSeconds(61))
            advanceTimeBy(tick + 1)
            runCurrent()
            assertNull(expectMostRecentItem().activeBypass)
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun dayRollover_resubscribesOccurrences_andKeepsLateBypassVisible() = runTest {
        // Bypass started at 23:55 yesterday, still active at 00:02.
        val late = localInstant(2026, 11, 4, 23, 55)
        blocker.bypasses.value = listOf(
            BypassSession(id = 7, startedAt = late, endsAt = late.plus(Duration.ofMinutes(10)), reason = BypassReason.HEALTH),
        )
        useCase("own", emptySet(), tick).test {
            val first = awaitItem()
            assertEquals(LocalDate.of(2026, 11, 4), first.today)
            assertEquals(listOf(LocalDate.of(2026, 11, 4)), tasks.subscribedDates)

            clock.current = localInstant(2026, 11, 5, 0, 2)
            advanceTimeBy(tick + 1)
            runCurrent()
            val next = expectMostRecentItem()
            assertEquals(LocalDate.of(2026, 11, 5), next.today)
            assertEquals(LocalDate.of(2026, 11, 5), tasks.subscribedDates.last())
            assertEquals(7L, next.activeBypass?.id)
            // the bypass query looks back before local midnight
            assertTrue(blocker.observedSince.last().isBefore(localInstant(2026, 11, 5, 0, 0)))
            cancelAndIgnoreRemainingEvents()
        }
    }

    @Test fun overdueFromYesterday_blocksAfterRollover_withCarryOver() = runTest {
        val t = task(1, priority = Priority.HIGH)
        tasks.occurrences.value = listOf(occ(1, t, LocalDate.of(2026, 11, 4)))
        blocker.apps.value = listOf(BlockedApp("com.instagram.android", "אינסטגרם"))
        useCase("own", emptySet(), tick).test {
            awaitItem()
            clock.current = localInstant(2026, 11, 5, 8, 0)
            advanceTimeBy(tick + 1)
            runCurrent()
            val i = expectMostRecentItem()
            val d = BlockPolicyEngine.decide(i, "com.instagram.android") as BlockDecision.Block
            assertTrue(d.pending.single().overdue)
            cancelAndIgnoreRemainingEvents()
        }
    }
}
