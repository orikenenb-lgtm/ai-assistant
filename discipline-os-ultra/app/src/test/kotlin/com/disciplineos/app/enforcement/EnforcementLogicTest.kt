package com.disciplineos.app.enforcement

import com.disciplineos.core.domain.blocker.BlockPolicyInput
import com.disciplineos.core.model.AllowReason
import com.disciplineos.core.model.BlockDecision
import com.disciplineos.core.model.BlockReason
import com.disciplineos.core.model.BlockerConfig
import com.disciplineos.core.model.BypassReason
import com.disciplineos.core.model.BypassSession
import com.disciplineos.core.model.OccurrenceWithTask
import com.disciplineos.core.model.PendingTaskSummary
import com.disciplineos.core.model.Priority
import com.disciplineos.core.model.Task
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.TaskOccurrence
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ForegroundReductionTest {
    private fun fg(t: Long, p: String) = UsageEventSample(t, p, ForegroundEventType.FOREGROUND)
    private fun bg(t: Long, p: String) = UsageEventSample(t, p, ForegroundEventType.BACKGROUND)
    private fun off(t: Long) = UsageEventSample(t, "android", ForegroundEventType.SCREEN_OFF)

    @Test fun `last resumed app wins`() {
        val events = listOf(fg(1, "a"), bg(2, "a"), fg(3, "b"))
        assertEquals("b", reduceForegroundPackage(events, null))
    }

    @Test fun `no events keeps previous foreground`() {
        assertEquals("a", reduceForegroundPackage(emptyList(), "a"))
    }

    @Test fun `unordered input is sorted by timestamp`() {
        val events = listOf(fg(30, "c"), fg(10, "a"), bg(20, "a"))
        assertEquals("c", reduceForegroundPackage(events, null))
    }

    @Test fun `same millisecond pause and resume resolves to resumed app`() {
        val events = listOf(fg(5, "b"), bg(5, "a"))
        assertEquals("b", reduceForegroundPackage(events, "a"))
    }

    @Test fun `late pause of an older app does not clear newer foreground`() {
        val events = listOf(fg(1, "a"), fg(2, "b"), bg(3, "a"))
        assertEquals("b", reduceForegroundPackage(events, null))
    }

    @Test fun `pause of current app without a new resume yields null`() {
        assertNull(reduceForegroundPackage(listOf(bg(4, "a")), "a"))
    }

    @Test fun `screen off clears foreground`() {
        assertNull(reduceForegroundPackage(listOf(fg(1, "a"), off(2)), null))
    }

    @Test fun `other events are ignored`() {
        val events = listOf(fg(1, "a"), UsageEventSample(2, "x", ForegroundEventType.OTHER))
        assertEquals("a", reduceForegroundPackage(events, null))
    }
}

class ForegroundDurationTest {
    private fun fg(t: Long, p: String) = UsageEventSample(t, p, ForegroundEventType.FOREGROUND)
    private fun bg(t: Long, p: String) = UsageEventSample(t, p, ForegroundEventType.BACKGROUND)

    @Test fun `sums sessions per package`() {
        val r = aggregateForegroundDurations(listOf(fg(0, "a"), bg(100, "a"), fg(200, "a"), bg(250, "a")), 0, 1_000)
        assertEquals(Duration.ofMillis(150), r["a"])
    }

    @Test fun `app already open at window start is counted from start`() {
        val r = aggregateForegroundDurations(listOf(bg(300, "a")), 0, 1_000)
        assertEquals(Duration.ofMillis(300), r["a"])
    }

    @Test fun `open session at window end is counted until end`() {
        val r = aggregateForegroundDurations(listOf(fg(900, "a")), 0, 1_000)
        assertEquals(Duration.ofMillis(100), r["a"])
    }

    @Test fun `switching apps closes the previous one`() {
        val r = aggregateForegroundDurations(listOf(fg(0, "a"), fg(400, "b"), bg(410, "a"), bg(600, "b")), 0, 1_000)
        assertEquals(Duration.ofMillis(400), r["a"])
        assertEquals(Duration.ofMillis(200), r["b"])
    }

    @Test fun `screen off ends sessions and events outside window are ignored`() {
        val r = aggregateForegroundDurations(
            listOf(fg(-50, "z"), fg(0, "a"), UsageEventSample(500, "android", ForegroundEventType.SCREEN_OFF), fg(2_000, "q")),
            0, 1_000,
        )
        assertEquals(Duration.ofMillis(500), r["a"])
        assertFalse("z" in r)
        assertFalse("q" in r)
    }

    @Test fun `empty window`() {
        assertTrue(aggregateForegroundDurations(listOf(fg(0, "a")), 10, 10).isEmpty())
    }
}

class PollingPolicyTest {
    private val base = PollingConditions(
        blockerEnabled = true, screenInteractive = true, restrictionPossible = true, restrictionActive = true,
    )

    @Test fun `active restriction polls every second`() =
        assertEquals(1_000L, PollingPolicy.intervalMillis(base))

    @Test fun `possible but inactive restriction polls every five seconds`() =
        assertEquals(5_000L, PollingPolicy.intervalMillis(base.copy(restrictionActive = false)))

    @Test fun `screen off stops polling`() =
        assertNull(PollingPolicy.intervalMillis(base.copy(screenInteractive = false)))

    @Test fun `disabled blocker stops polling`() =
        assertNull(PollingPolicy.intervalMillis(base.copy(blockerEnabled = false)))

    @Test fun `nothing possible stops polling`() =
        assertNull(PollingPolicy.intervalMillis(base.copy(restrictionPossible = false, restrictionActive = false)))

    @Test fun `accessibility detection replaces polling`() =
        assertNull(PollingPolicy.intervalMillis(base.copy(accessibilityDetectionActive = true)))
}

class LaunchDebouncerTest {
    @Test fun `same package within window is suppressed`() {
        val d = LaunchDebouncer(2_000)
        assertTrue(d.shouldLaunch("a", 0))
        assertFalse(d.shouldLaunch("a", 1_999))
        assertTrue(d.shouldLaunch("a", 2_000))
    }

    @Test fun `different package launches immediately`() {
        val d = LaunchDebouncer(2_000)
        assertTrue(d.shouldLaunch("a", 0))
        assertTrue(d.shouldLaunch("b", 100))
        assertTrue(d.shouldLaunch("a", 200))
    }

    @Test fun `reset allows relaunch`() {
        val d = LaunchDebouncer(2_000)
        assertTrue(d.shouldLaunch("a", 0))
        d.reset()
        assertTrue(d.shouldLaunch("a", 10))
    }

    @Test fun `clock going backwards does not suppress forever`() {
        val d = LaunchDebouncer(2_000)
        assertTrue(d.shouldLaunch("a", 10_000))
        assertTrue(d.shouldLaunch("a", 5_000))
    }
}

class RestrictionAndStatusTest {
    private val now = Instant.parse("2026-11-04T10:00:00Z")
    private val today = LocalDate.of(2026, 11, 4)

    private fun occ(kind: TaskKind, id: Long = 1) = OccurrenceWithTask(
        occurrence = TaskOccurrence(id = id, taskId = id, localDate = today, dueAt = null),
        task = Task(id = id, title = "t$id", kind = kind, startDate = today, zoneId = "UTC", createdAt = now, updatedAt = now),
    )

    private fun input(
        config: BlockerConfig = BlockerConfig(enabled = true),
        blocked: Set<String> = setOf("com.social"),
        open: List<OccurrenceWithTask> = listOf(occ(TaskKind.MANDATORY)),
        focus: Boolean = false,
        bypass: BypassSession? = null,
    ) = BlockPolicyInput(
        config = config, blockedPackages = blocked, openOccurrences = open, activeBypass = bypass,
        focusWorkActive = focus, now = now, today = today, ownPackage = "com.disciplineos.app",
    )

    @Test fun `possible with open mandatory and targets`() = assertTrue(isRestrictionPossible(input()))

    @Test fun `not possible when disabled`() =
        assertFalse(isRestrictionPossible(input(config = BlockerConfig(enabled = false))))

    @Test fun `not possible without targets`() = assertFalse(isRestrictionPossible(input(blocked = emptySet())))

    @Test fun `optional tasks alone never make a restriction possible`() =
        assertFalse(isRestrictionPossible(input(open = listOf(occ(TaskKind.OPTIONAL)))))

    @Test fun `focus makes restriction possible only when block during focus`() {
        assertTrue(isRestrictionPossible(input(open = emptyList(), focus = true)))
        assertFalse(
            isRestrictionPossible(
                input(config = BlockerConfig(enabled = true, blockDuringFocus = false), open = emptyList(), focus = true),
            ),
        )
    }

    @Test fun `recovery mode in the future pauses, in the past does not`() {
        assertFalse(isRestrictionPossible(input(config = BlockerConfig(enabled = true, recoveryUntil = now.plusSeconds(60)))))
        assertTrue(isRestrictionPossible(input(config = BlockerConfig(enabled = true, recoveryUntil = now.minusSeconds(60)))))
    }

    private val pending = listOf(
        PendingTaskSummary(1, 1, "a", Priority.HIGH, false),
        PendingTaskSummary(2, 2, "b", Priority.LOW, true),
    )

    @Test fun `status counts pending mandatory tasks`() = assertEquals(
        EnforcementStatus.MandatoryPending(2),
        enforcementStatusOf(BlockDecision.Block(BlockReason.MANDATORY_TASKS_PENDING, pending), input(), EnforcementHealth()),
    )

    @Test fun `status shows focus`() = assertEquals(
        EnforcementStatus.FocusActive,
        enforcementStatusOf(BlockDecision.Block(BlockReason.FOCUS_SESSION_ACTIVE, emptyList()), input(), EnforcementHealth()),
    )

    @Test fun `status all open`() = assertEquals(
        EnforcementStatus.AllOpen,
        enforcementStatusOf(BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY), input(), EnforcementHealth()),
    )

    @Test fun `status bypass carries end time`() {
        val bypass = BypassSession(1, now, now.plusSeconds(600), BypassReason.WORK_OR_STUDY)
        assertEquals(
            EnforcementStatus.BypassActive(now.plusSeconds(600)),
            enforcementStatusOf(BlockDecision.Allow(AllowReason.BYPASS_ACTIVE), input(bypass = bypass), EnforcementHealth()),
        )
    }

    @Test fun `missing usage access is surfaced first`() = assertEquals(
        EnforcementStatus.MissingUsageAccess,
        enforcementStatusOf(
            BlockDecision.Block(BlockReason.MANDATORY_TASKS_PENDING, pending), input(),
            EnforcementHealth(usageAccessMissing = true),
        ),
    )

    @Test fun `missing overlay only matters while blocking`() {
        val health = EnforcementHealth(overlayMissing = true)
        assertEquals(
            EnforcementStatus.MissingOverlay,
            enforcementStatusOf(BlockDecision.Block(BlockReason.MANDATORY_TASKS_PENDING, pending), input(), health),
        )
        assertEquals(
            EnforcementStatus.AllOpen,
            enforcementStatusOf(BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY), input(), health),
        )
    }

    @Test fun `starting until data arrives`() =
        assertEquals(EnforcementStatus.Starting, enforcementStatusOf(null, null, EnforcementHealth()))
}

class BoundsAndMotivationTest {
    @Test fun `bypass bounds clamp`() {
        assertEquals(5, BypassBounds.clampDuration(0))
        assertEquals(30, BypassBounds.clampDuration(90))
        assertEquals(1, BypassBounds.clampMaxPerDay(-3))
        assertEquals(10, BypassBounds.clampMaxPerDay(50))
        assertEquals(0, BypassBounds.clampCooldown(-15))
        assertEquals(180, BypassBounds.clampCooldown(1_000))
        assertEquals(72, BypassBounds.clampRecoveryHours(100))
    }

    @Test fun `motivation index is stable within a period and in range`() {
        val a = motivationalIndex(0, 7)
        val b = motivationalIndex(9 * 60_000L, 7)
        val c = motivationalIndex(10 * 60_000L, 7)
        assertEquals(a, b)
        assertEquals((a + 1) % 7, c)
        assertEquals(0, motivationalIndex(123, 0))
    }
}
