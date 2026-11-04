package com.disciplineos.app.enforcement

import com.disciplineos.core.domain.blocker.BlockPolicyInput
import com.disciplineos.core.model.AllowReason
import com.disciplineos.core.model.BlockDecision
import com.disciplineos.core.model.BlockReason
import com.disciplineos.core.model.TaskKind
import java.time.Duration
import java.time.Instant

/*
 * Pure, Android-free enforcement logic. Everything here is deterministic and covered by JVM tests in
 * app/src/test/kotlin/com/disciplineos/app/enforcement/. Android classes only translate platform data
 * (UsageEvents, PowerManager, ...) into these types and act on the results.
 */

/** Platform-independent classification of a UsageEvents.Event. */
enum class ForegroundEventType {
    /** ACTIVITY_RESUMED (API 29+) / MOVE_TO_FOREGROUND (older). */
    FOREGROUND,

    /** ACTIVITY_PAUSED (API 29+) / MOVE_TO_BACKGROUND (older). */
    BACKGROUND,

    /** SCREEN_NON_INTERACTIVE, KEYGUARD_SHOWN, DEVICE_SHUTDOWN: nothing the user can interact with is in front. */
    SCREEN_OFF,

    /** Anything else (configuration change, standby bucket, notifications, ...). Ignored. */
    OTHER,
}

data class UsageEventSample(
    val timestampMillis: Long,
    val packageName: String,
    val type: ForegroundEventType,
)

/**
 * Reduces a window of usage events to the package currently in the foreground.
 *
 * - Events are processed in timestamp order; for equal timestamps BACKGROUND/SCREEN_OFF are applied before
 *   FOREGROUND so an "A paused, B resumed" pair at the same millisecond resolves to B.
 * - [initial] is the previously known foreground package: if the window contains no relevant events the user
 *   simply stayed in the same app, so the previous answer still holds.
 * - A BACKGROUND event only clears the state when it belongs to the current package (multi-activity apps and
 *   late "paused" events of an older app must not wipe the newer foreground app).
 *
 * Returns null when nothing is known to be in the foreground.
 */
fun reduceForegroundPackage(events: List<UsageEventSample>, initial: String?): String? {
    var current = initial
    val ordered = events.sortedWith(compareBy<UsageEventSample> { it.timestampMillis }.thenBy { orderWithinSameMillis(it.type) })
    for (event in ordered) {
        when (event.type) {
            ForegroundEventType.FOREGROUND -> current = event.packageName
            ForegroundEventType.BACKGROUND -> if (event.packageName == current) current = null
            ForegroundEventType.SCREEN_OFF -> current = null
            ForegroundEventType.OTHER -> Unit
        }
    }
    return current
}

private fun orderWithinSameMillis(type: ForegroundEventType): Int = when (type) {
    ForegroundEventType.BACKGROUND, ForegroundEventType.SCREEN_OFF -> 0
    ForegroundEventType.OTHER -> 1
    ForegroundEventType.FOREGROUND -> 2
}

/**
 * Foreground time per package inside [windowStart, windowEnd) built from usage events.
 * A package whose first event in the window is BACKGROUND was already in front at [windowStart].
 * Sessions still open at the end are counted up to [windowEnd]. Never fabricates data outside the window.
 */
fun aggregateForegroundDurations(
    events: List<UsageEventSample>,
    windowStart: Long,
    windowEnd: Long,
): Map<String, Duration> {
    if (windowEnd <= windowStart) return emptyMap()
    val totals = HashMap<String, Long>()
    val openSince = HashMap<String, Long>()
    val seen = HashSet<String>()
    val ordered = events
        .filter { it.timestampMillis in windowStart until windowEnd }
        .sortedWith(compareBy<UsageEventSample> { it.timestampMillis }.thenBy { orderWithinSameMillis(it.type) })

    fun close(pkg: String, at: Long) {
        val start = openSince.remove(pkg) ?: return
        if (at > start) totals[pkg] = (totals[pkg] ?: 0L) + (at - start)
    }

    for (e in ordered) {
        when (e.type) {
            ForegroundEventType.FOREGROUND -> {
                // The previous foreground app implicitly ends when another one comes to the front.
                openSince.keys.filter { it != e.packageName }.toList().forEach { close(it, e.timestampMillis) }
                if (e.packageName !in openSince) openSince[e.packageName] = e.timestampMillis
                seen += e.packageName
            }
            ForegroundEventType.BACKGROUND -> {
                if (e.packageName !in seen && e.packageName !in openSince) {
                    // Already in the foreground when the window started.
                    totals[e.packageName] = (totals[e.packageName] ?: 0L) + (e.timestampMillis - windowStart)
                } else {
                    close(e.packageName, e.timestampMillis)
                }
                seen += e.packageName
            }
            ForegroundEventType.SCREEN_OFF -> openSince.keys.toList().forEach { close(it, e.timestampMillis) }
            ForegroundEventType.OTHER -> Unit
        }
    }
    openSince.keys.toList().forEach { close(it, windowEnd) }
    return totals.filterValues { it > 0 }.mapValues { Duration.ofMillis(it.value) }
}

/** Inputs to the adaptive polling decision. */
data class PollingConditions(
    val blockerEnabled: Boolean,
    val screenInteractive: Boolean,
    /** A restriction could start without user interaction (targets exist + mandatory open or focus running). */
    val restrictionPossible: Boolean,
    /** Targeted apps are blocked right now. */
    val restrictionActive: Boolean,
    /** Event-driven accessibility detection is connected and consented: polling is redundant. */
    val accessibilityDetectionActive: Boolean = false,
)

object PollingPolicy {
    const val ACTIVE_INTERVAL_MS = 1_000L
    const val IDLE_INTERVAL_MS = 5_000L

    /**
     * Polling interval in ms, or null to stop polling entirely.
     * Battery rules: never poll with the screen off; never poll when nothing could be blocked;
     * 1s only while a restriction is actually active; 5s while one is merely possible (e.g. bypass running).
     */
    fun intervalMillis(c: PollingConditions): Long? = when {
        !c.blockerEnabled -> null
        !c.screenInteractive -> null
        c.accessibilityDetectionActive -> null
        !c.restrictionPossible -> null
        c.restrictionActive -> ACTIVE_INTERVAL_MS
        else -> IDLE_INTERVAL_MS
    }
}

/**
 * Conservative "could anything be blocked without a data change?" check, used only to decide whether to poll.
 * It errs towards true (e.g. ignores carry-over and snooze), which costs a little battery but never misses a block.
 */
fun isRestrictionPossible(input: BlockPolicyInput): Boolean {
    val config = input.config
    if (!config.enabled) return false
    val recovery = config.recoveryUntil
    if (recovery != null && recovery.isAfter(input.now)) return false
    if (input.blockedPackages.isEmpty()) return false
    val mandatoryOpen = input.openOccurrences.any { it.task.kind == TaskKind.MANDATORY }
    val focus = config.blockDuringFocus && input.focusWorkActive
    return mandatoryOpen || focus
}

/** Prevents relaunching the block screen for the same package more than once per [windowMillis]. Not thread-safe by itself. */
class LaunchDebouncer(private val windowMillis: Long = 2_000L) {
    private var lastPackage: String? = null
    private var lastAt: Long = Long.MIN_VALUE

    fun shouldLaunch(packageName: String, nowMillis: Long): Boolean {
        val samePackage = packageName == lastPackage
        val tooSoon = lastAt != Long.MIN_VALUE && nowMillis - lastAt in 0 until windowMillis
        if (samePackage && tooSoon) return false
        lastPackage = packageName
        lastAt = nowMillis
        return true
    }

    fun reset() {
        lastPackage = null
        lastAt = Long.MIN_VALUE
    }
}

/** What the persistent notification says. Text is resolved from resources by [EnforcementNotifier]. */
sealed interface EnforcementStatus {
    data class MandatoryPending(val count: Int) : EnforcementStatus
    data object FocusActive : EnforcementStatus
    data class BypassActive(val until: Instant?) : EnforcementStatus
    data class RecoveryActive(val until: Instant?) : EnforcementStatus
    data object AllOpen : EnforcementStatus
    data object MissingUsageAccess : EnforcementStatus
    data object MissingOverlay : EnforcementStatus
    data object Starting : EnforcementStatus
}

/** Degradations the service detected at runtime (permission revoked, overlay missing...). */
data class EnforcementHealth(
    val usageAccessMissing: Boolean = false,
    val overlayMissing: Boolean = false,
) {
    val degraded: Boolean get() = usageAccessMissing || overlayMissing
}

fun enforcementStatusOf(
    restriction: BlockDecision?,
    input: BlockPolicyInput?,
    health: EnforcementHealth,
): EnforcementStatus {
    if (input == null || restriction == null) return EnforcementStatus.Starting
    // Permission problems are surfaced first: the user must know when the blocker cannot work.
    if (health.usageAccessMissing) return EnforcementStatus.MissingUsageAccess
    return when (restriction) {
        is BlockDecision.Block -> when {
            health.overlayMissing -> EnforcementStatus.MissingOverlay
            restriction.reason == BlockReason.FOCUS_SESSION_ACTIVE -> EnforcementStatus.FocusActive
            else -> EnforcementStatus.MandatoryPending(restriction.pending.size)
        }
        is BlockDecision.Allow -> when (restriction.reason) {
            AllowReason.BYPASS_ACTIVE -> EnforcementStatus.BypassActive(input.activeBypass?.endsAt)
            AllowReason.RECOVERY_MODE -> EnforcementStatus.RecoveryActive(input.config.recoveryUntil)
            else -> EnforcementStatus.AllOpen
        }
    }
}

/** Sane, user-protective bounds for bypass settings (UI clamps every edit through here). */
object BypassBounds {
    val DURATION_MINUTES = 5..30
    const val DURATION_STEP = 5
    val MAX_PER_DAY = 1..10
    val COOLDOWN_MINUTES = 0..180
    const val COOLDOWN_STEP = 15
    val RECOVERY_HOURS = 1..72

    fun clampDuration(v: Int) = v.coerceIn(DURATION_MINUTES)
    fun clampMaxPerDay(v: Int) = v.coerceIn(MAX_PER_DAY)
    fun clampCooldown(v: Int) = v.coerceIn(COOLDOWN_MINUTES)
    fun clampRecoveryHours(v: Int) = v.coerceIn(RECOVERY_HOURS)
}

/** Deterministic rotation of supportive lines: changes every [periodMinutes], stable within a period. */
fun motivationalIndex(nowMillis: Long, size: Int, periodMinutes: Long = 10): Int {
    if (size <= 0) return 0
    val period = (nowMillis / (periodMinutes * 60_000L))
    return Math.floorMod(period, size.toLong()).toInt()
}
