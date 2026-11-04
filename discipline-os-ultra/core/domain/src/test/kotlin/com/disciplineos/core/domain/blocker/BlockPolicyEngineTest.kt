package com.disciplineos.core.domain.blocker

import com.disciplineos.core.model.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Duration
import java.time.LocalDate

class BlockPolicyEngineTest {
    private val today = LocalDate.of(2026, 11, 4)
    private val now = localInstant(2026, 11, 4, 14, 0)
    private val own = "com.disciplineos.app"
    private val insta = "com.instagram.android"
    private val tiktok = "com.zhiliaoapp.musically"

    private fun input(
        occurrences: List<OccurrenceWithTask> = emptyList(),
        config: BlockerConfig = BlockerConfig(enabled = true),
        blocked: Set<String> = setOf(insta, tiktok, "com.google.android.dialer", "com.android.settings", own, "com.bank"),
        bypass: BypassSession? = null,
        focus: Boolean = false,
        deviceProtected: Set<String> = emptySet(),
    ) = BlockPolicyInput(
        config = config,
        blockedPackages = blocked,
        openOccurrences = occurrences,
        activeBypass = bypass,
        focusWorkActive = focus,
        now = now,
        today = today,
        ownPackage = own,
        deviceProtectedPackages = deviceProtected,
    )

    private val mandatory = task(1, TaskKind.MANDATORY, Priority.HIGH)
    private val optional = task(2, TaskKind.OPTIONAL, Priority.CRITICAL)
    private val pendingToday = occ(10, mandatory, today)

    private fun allow(reason: AllowReason) = BlockDecision.Allow(reason)

    private fun assertBlockedMandatory(d: BlockDecision): BlockDecision.Block {
        assertTrue("expected block but was $d", d is BlockDecision.Block)
        d as BlockDecision.Block
        assertEquals(BlockReason.MANDATORY_TASKS_PENDING, d.reason)
        return d
    }

    // ---- core mandatory rules ----

    @Test fun noMandatoryTasks_allows() {
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(input(), insta))
    }

    @Test fun optionalTasksOnly_neverBlock() {
        val i = input(listOf(occ(20, optional, today), occ(21, optional, today.minusDays(3))))
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(i, insta))
    }

    @Test fun pendingMandatory_blocksTargetedApp_withSummary() {
        val d = assertBlockedMandatory(BlockPolicyEngine.decide(input(listOf(pendingToday)), insta))
        assertEquals(
            listOf(PendingTaskSummary(taskId = 1, occurrenceId = 10, title = "task-1", priority = Priority.HIGH, overdue = false)),
            d.pending,
        )
    }

    @Test fun completingAllMandatory_allows() {
        val done = listOf(
            occ(10, mandatory, today, OccurrenceStatus.COMPLETED),
            occ(11, task(3), today, OccurrenceStatus.SKIPPED),
        )
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(input(done), insta))
    }

    @Test fun missedArchivedAndFutureOccurrences_doNotBlock() {
        val list = listOf(
            occ(10, mandatory, today.minusDays(1), OccurrenceStatus.MISSED),
            occ(11, task(3, archived = true), today),
            occ(12, task(4), today.plusDays(1)),
        )
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(input(list), insta))
    }

    @Test fun snoozedMandatory_stillBlocks() {
        val snoozed = occ(10, mandatory, today, snoozedUntil = now.plus(Duration.ofHours(2)))
        assertBlockedMandatory(BlockPolicyEngine.decide(input(listOf(snoozed)), insta))
    }

    @Test fun overdueMandatory_blocksOnlyWithCarryOver() {
        val overdue = occ(10, mandatory, today.minusDays(2))
        val on = assertBlockedMandatory(BlockPolicyEngine.decide(input(listOf(overdue)), insta))
        assertTrue(on.pending.single().overdue)

        val off = input(listOf(overdue), config = BlockerConfig(enabled = true, carryOverOverdue = false))
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(off, insta))
        // today's occurrence still blocks with carry-over off
        val offToday = off.copy(openOccurrences = listOf(overdue, pendingToday))
        val d = assertBlockedMandatory(BlockPolicyEngine.decide(offToday, insta))
        assertEquals(listOf(10L), d.pending.map { it.occurrenceId })
        assertEquals(today, offToday.today)
    }

    // ---- protected packages ----

    @Test fun protectedPackages_alwaysAllowed_evenIfSelected() {
        val i = input(listOf(pendingToday), deviceProtected = setOf("com.oem.launcher"))
            .let { it.copy(config = it.config.copy(userExemptPackages = setOf("com.bank")), blockedPackages = it.blockedPackages + "com.oem.launcher") }
        for (pkg in listOf("com.google.android.dialer", "com.android.settings", own, "com.oem.launcher", "com.bank", "com.android.phone")) {
            assertEquals(pkg, allow(AllowReason.PROTECTED_PACKAGE), BlockPolicyEngine.decide(i, pkg))
        }
        // and a non-protected selected app is blocked in the same state
        assertBlockedMandatory(BlockPolicyEngine.decide(i, insta))
    }

    @Test fun protectedCheck_comesBeforeEverythingElse() {
        val disabled = input(config = BlockerConfig(enabled = false))
        assertEquals(allow(AllowReason.PROTECTED_PACKAGE), BlockPolicyEngine.decide(disabled, "com.android.dialer"))
        assertEquals(allow(AllowReason.PROTECTED_PACKAGE), BlockPolicyEngine.decide(input(), ""))
        assertEquals(allow(AllowReason.PROTECTED_PACKAGE), BlockPolicyEngine.decide(input(listOf(pendingToday)), "   "))
    }

    @Test fun protectedPackages_containsCriticalSystemApps_butNotPlayStore() {
        val required = listOf(
            "com.android.phone", "com.android.dialer", "com.google.android.dialer", "com.samsung.android.dialer",
            "com.samsung.android.incallui", "com.android.server.telecom", "com.android.emergency",
            "com.google.android.apps.safetyhub", "com.samsung.android.emergency", "com.android.settings",
            "com.android.systemui", "com.android.permissioncontroller", "com.google.android.permissioncontroller",
            "com.google.android.packageinstaller", "com.android.packageinstaller", "com.samsung.android.app.telephonyui",
            "com.android.mms", "com.google.android.apps.messaging", "com.samsung.android.messaging",
            "com.android.contacts", "com.samsung.android.app.contacts", "com.google.android.apps.maps",
        )
        for (p in required) assertTrue(p, p in ProtectedPackages.ALWAYS)
        assertFalse("com.android.vending" in ProtectedPackages.ALWAYS)
        assertFalse(ProtectedPackages.isProtected("com.android.vending", own, emptySet(), emptySet()))
    }

    @Test fun defaultTargets_includeSuggestions_andNoneAreProtected() {
        val s = DefaultBlockTargets.SUGGESTED
        for (p in listOf("com.instagram.android", "com.zhiliaoapp.musically", "com.ss.android.ugc.trill", "com.google.android.youtube", "com.roblox.client")) {
            assertTrue(p, p in s)
        }
        assertTrue(s.values.all { it.isNotBlank() })
        assertTrue(s.keys.none { it in ProtectedPackages.ALWAYS })
    }

    // ---- config switches ----

    @Test fun blockerDisabled_allows() {
        val i = input(listOf(pendingToday), config = BlockerConfig(enabled = false))
        assertEquals(allow(AllowReason.BLOCKER_DISABLED), BlockPolicyEngine.decide(i, insta))
        assertEquals(allow(AllowReason.BLOCKER_DISABLED), BlockPolicyEngine.decide(i, "com.untargeted"))
    }

    @Test fun recoveryMode_activeAllows_expiredBlocks() {
        val active = input(listOf(pendingToday), config = BlockerConfig(enabled = true, recoveryUntil = now.plusSeconds(60)))
        assertEquals(allow(AllowReason.RECOVERY_MODE), BlockPolicyEngine.decide(active, insta))
        val expired = active.copy(config = active.config.copy(recoveryUntil = now.minusSeconds(1)))
        assertBlockedMandatory(BlockPolicyEngine.decide(expired, insta))
        val boundary = active.copy(config = active.config.copy(recoveryUntil = now))
        assertBlockedMandatory(BlockPolicyEngine.decide(boundary, insta))
    }

    @Test fun untargetedPackage_allows() {
        assertEquals(allow(AllowReason.NOT_TARGETED), BlockPolicyEngine.decide(input(listOf(pendingToday)), "com.whatever"))
    }

    // ---- bypass ----

    private fun bypass(start: Long, end: Long, endedEarlyMin: Long? = null) = BypassSession(
        id = 1,
        startedAt = now.plus(Duration.ofMinutes(start)),
        endsAt = now.plus(Duration.ofMinutes(end)),
        reason = BypassReason.WORK_OR_STUDY,
        endedEarlyAt = endedEarlyMin?.let { now.plus(Duration.ofMinutes(it)) },
    )

    @Test fun activeBypass_allows() {
        val i = input(listOf(pendingToday), bypass = bypass(-5, 5))
        assertEquals(allow(AllowReason.BYPASS_ACTIVE), BlockPolicyEngine.decide(i, insta))
        // starting exactly now counts
        assertEquals(allow(AllowReason.BYPASS_ACTIVE), BlockPolicyEngine.decide(i.copy(activeBypass = bypass(0, 5)), insta))
    }

    @Test fun expiredEndedEarlyOrFutureBypass_doesNotAllow() {
        val base = input(listOf(pendingToday))
        assertBlockedMandatory(BlockPolicyEngine.decide(base.copy(activeBypass = bypass(-10, 0)), insta)) // endsAt == now
        assertBlockedMandatory(BlockPolicyEngine.decide(base.copy(activeBypass = bypass(-10, -1)), insta))
        assertBlockedMandatory(BlockPolicyEngine.decide(base.copy(activeBypass = bypass(-5, 5, endedEarlyMin = -1)), insta))
        assertBlockedMandatory(BlockPolicyEngine.decide(base.copy(activeBypass = bypass(1, 10)), insta))
    }

    // ---- focus ----

    @Test fun focusWork_blocksWhenConfigured() {
        val i = input(focus = true)
        assertEquals(BlockDecision.Block(BlockReason.FOCUS_SESSION_ACTIVE, emptyList()), BlockPolicyEngine.decide(i, insta))
        val off = i.copy(config = i.config.copy(blockDuringFocus = false))
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.decide(off, insta))
        // mandatory reason takes precedence over focus
        assertBlockedMandatory(BlockPolicyEngine.decide(i.copy(openOccurrences = listOf(pendingToday)), insta))
        // bypass beats focus too
        assertEquals(allow(AllowReason.BYPASS_ACTIVE), BlockPolicyEngine.decide(i.copy(activeBypass = bypass(-1, 5)), insta))
    }

    // ---- ordering & determinism ----

    @Test fun pendingSummaries_overdueFirst_thenPriorityDesc() {
        val low = task(1, priority = Priority.LOW)
        val crit = task(2, priority = Priority.CRITICAL)
        val med = task(3, priority = Priority.MEDIUM)
        val high = task(4, priority = Priority.HIGH)
        val list = listOf(
            occ(100, crit, today),
            occ(101, low, today.minusDays(1)), // overdue (previous day)
            occ(102, med, today),
            occ(103, high, today.minusDays(3)), // overdue
            occ(104, low, today, dueAt = now.minusSeconds(60)), // overdue (due time passed today)
            occ(105, task(5, kind = TaskKind.OPTIONAL, priority = Priority.CRITICAL), today),
        )
        val d = assertBlockedMandatory(BlockPolicyEngine.decide(input(list), insta))
        assertEquals(listOf(103L, 101L, 104L, 100L, 102L), d.pending.map { it.occurrenceId })
        assertEquals(listOf(true, true, true, false, false), d.pending.map { it.overdue })
    }

    @Test fun determinism_sameInputSameOutput_independentOfListOrder() {
        val list = (1..12).map { n ->
            occ(n.toLong(), task(n.toLong(), priority = Priority.entries[n % 4]), today.minusDays((n % 3).toLong()))
        }
        val i = input(list)
        val first = BlockPolicyEngine.decide(i, insta)
        repeat(5) { assertEquals(first, BlockPolicyEngine.decide(i, insta)) }
        assertEquals(first, BlockPolicyEngine.decide(i.copy(openOccurrences = list.reversed()), insta))
        assertEquals(first, BlockPolicyEngine.decide(i.copy(openOccurrences = list.shuffled(kotlin.random.Random(7))), insta))
    }

    @Test fun currentRestriction_ignoresPackageSteps() {
        assertBlockedMandatory(BlockPolicyEngine.currentRestriction(input(listOf(pendingToday), blocked = emptySet())))
        assertEquals(allow(AllowReason.NO_ACTIVE_MANDATORY), BlockPolicyEngine.currentRestriction(input()))
        assertEquals(allow(AllowReason.BLOCKER_DISABLED), BlockPolicyEngine.currentRestriction(input(config = BlockerConfig())))
        assertEquals(
            BlockDecision.Block(BlockReason.FOCUS_SESSION_ACTIVE, emptyList()),
            BlockPolicyEngine.currentRestriction(input(focus = true)),
        )
    }
}
