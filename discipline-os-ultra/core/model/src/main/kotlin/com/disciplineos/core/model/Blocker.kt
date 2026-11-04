package com.disciplineos.core.model

import java.time.Instant

/** An app the user selected to be restricted while mandatory work is pending. */
data class BlockedApp(
    val packageName: String,
    val label: String,
    val enabled: Boolean = true,
    val suggestedByDefault: Boolean = false,
)

data class BlockerConfig(
    val enabled: Boolean = false,
    /** Overdue mandatory occurrences from previous days keep blocking until resolved. */
    val carryOverOverdue: Boolean = true,
    /** During a focus WORK phase, blocked apps are restricted even with zero pending mandatory tasks. */
    val blockDuringFocus: Boolean = true,
    val bypassDurationMinutes: Int = 10,
    val maxBypassesPerDay: Int = 3,
    val bypassCooldownMinutes: Int = 30,
    /** Recovery mode: all enforcement paused until this instant (escape hatch, always available). */
    val recoveryUntil: Instant? = null,
    /** Extra user-defined packages that may never be blocked (e.g. a banking or medical app). */
    val userExemptPackages: Set<String> = emptySet(),
)

enum class BypassReason { EMERGENCY, WORK_OR_STUDY, HEALTH, OTHER }

/** A transparent, time-limited, logged unblock. */
data class BypassSession(
    val id: Long = 0,
    val startedAt: Instant,
    val endsAt: Instant,
    val reason: BypassReason,
    val note: String = "",
    val endedEarlyAt: Instant? = null,
)

enum class AllowReason {
    BLOCKER_DISABLED,
    NOT_TARGETED,
    PROTECTED_PACKAGE,
    NO_ACTIVE_MANDATORY,
    BYPASS_ACTIVE,
    RECOVERY_MODE,
}

enum class BlockReason { MANDATORY_TASKS_PENDING, FOCUS_SESSION_ACTIVE }

data class PendingTaskSummary(
    val taskId: Long,
    val occurrenceId: Long,
    val title: String,
    val priority: Priority,
    val overdue: Boolean,
)

sealed interface BlockDecision {
    data class Allow(val reason: AllowReason) : BlockDecision
    data class Block(
        val reason: BlockReason,
        val pending: List<PendingTaskSummary>,
    ) : BlockDecision
}
