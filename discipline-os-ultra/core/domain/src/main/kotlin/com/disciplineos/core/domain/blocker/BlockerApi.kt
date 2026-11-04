package com.disciplineos.core.domain.blocker

import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.map
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import javax.inject.Inject

/** Everything the pure policy needs. Built from flows; the decision is a pure function of this value. */
data class BlockPolicyInput(
    val config: BlockerConfig,
    val blockedPackages: Set<String>,
    /** Open (PENDING) occurrences on or before today. */
    val openOccurrences: List<OccurrenceWithTask>,
    val activeBypass: BypassSession?,
    val focusWorkActive: Boolean,
    val now: Instant,
    val today: LocalDate,
    val ownPackage: String,
    /** Device-specific protected packages (default dialer, launcher, SMS, emergency) resolved on Android. */
    val deviceProtectedPackages: Set<String> = emptySet(),
)

/**
 * Pure, deterministic blocking policy. Evaluation order (first match wins):
 *  1. protected package            -> Allow(PROTECTED_PACKAGE)   (package decisions only; ALWAYS first)
 *  2. blocker disabled             -> Allow(BLOCKER_DISABLED)
 *  3. recovery mode active         -> Allow(RECOVERY_MODE)
 *  4. package not targeted         -> Allow(NOT_TARGETED)        (package decisions only)
 *  5. bypass active                -> Allow(BYPASS_ACTIVE)
 *  6. active mandatory occurrences -> Block(MANDATORY_TASKS_PENDING, summaries)
 *  7. focus WORK + blockDuringFocus-> Block(FOCUS_SESSION_ACTIVE)
 *  8. otherwise                    -> Allow(NO_ACTIVE_MANDATORY)
 */
object BlockPolicyEngine {
    /** Decision for one foreground package. Pure + deterministic. */
    fun decide(input: BlockPolicyInput, packageName: String): BlockDecision {
        if (ProtectedPackages.isProtected(
                packageName,
                input.ownPackage,
                input.deviceProtectedPackages,
                input.config.userExemptPackages,
            )
        ) return BlockDecision.Allow(AllowReason.PROTECTED_PACKAGE)
        return evaluate(input) { packageName.trim() in input.blockedPackages }
    }

    /** Package-agnostic: would targeted apps currently be blocked? (dashboard/status) */
    fun currentRestriction(input: BlockPolicyInput): BlockDecision = evaluate(input, isTargeted = null)

    /** Active mandatory occurrences as sorted summaries (overdue first, then priority desc). Exposed for UI. */
    fun pendingMandatory(input: BlockPolicyInput): List<PendingTaskSummary> =
        input.openOccurrences
            .asSequence()
            .filter { isActiveMandatory(it, input) }
            .distinctBy { Triple(it.occurrence.id, it.occurrence.taskId, it.occurrence.localDate) }
            .map { it to isOverdue(it.occurrence, input) }
            .sortedWith(
                compareByDescending<Pair<OccurrenceWithTask, Boolean>> { it.second }
                    .thenByDescending { it.first.task.priority.weight }
                    .thenBy { it.first.occurrence.localDate }
                    .thenBy(nullsLast()) { it.first.occurrence.dueAt }
                    .thenBy { it.first.task.title }
                    .thenBy { it.first.occurrence.id },
            )
            .map { (owt, overdue) ->
                PendingTaskSummary(
                    taskId = owt.task.id,
                    occurrenceId = owt.occurrence.id,
                    title = owt.task.title,
                    priority = owt.task.priority,
                    overdue = overdue,
                )
            }
            .toList()

    private fun evaluate(input: BlockPolicyInput, isTargeted: (() -> Boolean)?): BlockDecision {
        val config = input.config
        if (!config.enabled) return BlockDecision.Allow(AllowReason.BLOCKER_DISABLED)
        val recovery = config.recoveryUntil
        if (recovery != null && recovery.isAfter(input.now)) return BlockDecision.Allow(AllowReason.RECOVERY_MODE)
        if (isTargeted != null && !isTargeted()) return BlockDecision.Allow(AllowReason.NOT_TARGETED)
        if (isBypassActive(input.activeBypass, input.now)) return BlockDecision.Allow(AllowReason.BYPASS_ACTIVE)
        val pending = pendingMandatory(input)
        if (pending.isNotEmpty()) return BlockDecision.Block(BlockReason.MANDATORY_TASKS_PENDING, pending)
        if (input.focusWorkActive && config.blockDuringFocus) {
            return BlockDecision.Block(BlockReason.FOCUS_SESSION_ACTIVE, emptyList())
        }
        return BlockDecision.Allow(AllowReason.NO_ACTIVE_MANDATORY)
    }

    /** Covers now: startedAt <= now < endsAt and not ended early. */
    fun isBypassActive(bypass: BypassSession?, now: Instant): Boolean =
        bypass != null &&
            bypass.endedEarlyAt == null &&
            !bypass.startedAt.isAfter(now) &&
            now.isBefore(bypass.endsAt)

    /**
     * Snoozed occurrences still count: a snooze delays reminders, not the obligation.
     * MISSED/COMPLETED/SKIPPED never count; future dates never count.
     */
    private fun isActiveMandatory(owt: OccurrenceWithTask, input: BlockPolicyInput): Boolean {
        val task = owt.task
        val occ = owt.occurrence
        if (task.kind != TaskKind.MANDATORY || task.archived) return false
        if (occ.status != OccurrenceStatus.PENDING) return false
        return when {
            occ.localDate == input.today -> true
            occ.localDate.isBefore(input.today) -> input.config.carryOverOverdue
            else -> false
        }
    }

    /** Overdue = from a previous local day, or today's occurrence whose due instant has passed. */
    private fun isOverdue(occ: TaskOccurrence, input: BlockPolicyInput): Boolean =
        occ.localDate.isBefore(input.today) || (occ.dueAt?.let { !it.isAfter(input.now) } ?: false)
}

/** Packages that may never be blocked, regardless of configuration. */
object ProtectedPackages {
    /**
     * Fail-safe list. Blocking any of these could cut off emergency calls/alerts/SMS, lock the user out of
     * the phone UI, or prevent them from turning the blocker off. Entries marked (unverified) are plausible
     * OEM names whose presence could not be confirmed offline; listing a non-existent package is harmless.
     *
     * Deliberately NOT protected: Play Store (com.android.vending) — browsing/installing games is a common
     * distraction path and it is blocked only if the user explicitly selects it; our own app, Settings and
     * the package installer stay reachable, so the user can never be locked out of uninstalling/updating.
     */
    val ALWAYS: Set<String> = setOf(
        // Telephony / calls (incl. emergency calls)
        "com.android.phone",
        "com.android.dialer",
        "com.google.android.dialer",
        "com.samsung.android.dialer",
        "com.samsung.android.incallui",
        "com.android.incallui",
        "com.android.server.telecom",
        "com.samsung.android.app.telephonyui",
        // Emergency / safety / public alerts (Pikud HaOref cell broadcasts)
        "com.android.emergency",
        "com.google.android.apps.safetyhub",
        "com.samsung.android.emergency", // (unverified)
        "com.sec.android.emergencymode.service", // Samsung emergency mode (unverified)
        "com.sec.android.emergencylauncher", // Samsung emergency mode launcher (unverified)
        "com.android.cellbroadcastreceiver",
        "com.google.android.cellbroadcastreceiver",
        "com.android.cellbroadcastreceiver.module", // mainline module name (unverified)
        // SMS — needed to reach / be reached in emergencies, receive OTPs
        "com.android.mms",
        "com.google.android.apps.messaging",
        "com.samsung.android.messaging",
        // Contacts
        "com.android.contacts",
        "com.google.android.contacts",
        "com.samsung.android.app.contacts",
        // System UI, settings, permissions, installer — the user must always be able to disable the blocker
        "com.android.systemui",
        "com.android.settings", // also Samsung One UI's Settings package
        "com.samsung.android.settings", // (unverified)
        "com.android.permissioncontroller",
        "com.google.android.permissioncontroller",
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        // Google Play services: account/location/emergency-location dialogs; never a distraction surface
        "com.google.android.gms",
        // Home screens — blocking the launcher would be a lockout (device-specific default is also resolved on Android)
        "com.sec.android.app.launcher",
        "com.google.android.apps.nexuslauncher",
        "com.android.launcher3",
        // Keyboards — accessibility events can report the IME window's package
        "com.samsung.android.honeyboard",
        "com.google.android.inputmethod.latin",
        // Navigation — being blocked mid-drive is a safety hazard; Waze is the dominant navigation app in Israel
        "com.google.android.apps.maps",
        "com.waze",
    )

    fun isProtected(packageName: String, ownPackage: String, deviceProtected: Set<String>, userExempt: Set<String>): Boolean {
        val pkg = packageName.trim()
        if (pkg.isEmpty()) return true // fail-safe: unknown foreground -> never block
        return pkg in ALWAYS ||
            (ownPackage.isNotBlank() && pkg == ownPackage.trim()) ||
            pkg in deviceProtected ||
            pkg in userExempt
    }
}

/** Default suggestions shown in the app picker (only suggested if installed; user must confirm). */
object DefaultBlockTargets {
    val SUGGESTED: Map<String, String> = linkedMapOf(
        "com.instagram.android" to "אינסטגרם",
        "com.zhiliaoapp.musically" to "טיקטוק",
        "com.ss.android.ugc.trill" to "טיקטוק (גרסה אזורית)",
        "com.google.android.youtube" to "יוטיוב",
        "com.facebook.katana" to "פייסבוק",
        "com.snapchat.android" to "סנאפצ'ט",
        "com.supercell.clashroyale" to "קלאש רויאל",
        "com.supercell.brawlstars" to "בראול סטארס",
        "com.roblox.client" to "רובלוקס",
        "com.mojang.minecraftpe" to "מיינקראפט",
        "com.king.candycrushsaga" to "קנדי קראש",
    )
}

/** Longest a bypass can last; used to look back past midnight for a bypass still running. */
internal const val MAX_BYPASS_MINUTES = 60L

internal fun startOfLocalDay(date: LocalDate, time: TimeProvider): Instant = date.atStartOfDay(time.zone()).toInstant()

internal fun tickerFlow(periodMillis: Long): Flow<Unit> = kotlinx.coroutines.flow.flow {
    val period = periodMillis.coerceAtLeast(1)
    while (true) {
        emit(Unit)
        kotlinx.coroutines.delay(period)
    }
}

class ObserveBlockPolicyInputUseCase @Inject constructor(
    private val taskRepo: TaskRepository,
    private val blockerRepo: BlockerRepository,
    private val focus: FocusSessionManager,
    private val time: TimeProvider,
) {
    /** Re-emits on any task/config/bypass/focus change, and at least every [tickMillis] so bypass expiry is observed. */
    @OptIn(ExperimentalCoroutinesApi::class)
    operator fun invoke(ownPackage: String, deviceProtected: Set<String>, tickMillis: Long = 15_000): Flow<BlockPolicyInput> {
        val ticks = tickerFlow(tickMillis).map { time.now() }
        // Date flow: changes only at local-day rollover (or time-zone change) -> re-subscribes date-bound queries.
        val today = ticks.map { time.today() }.distinctUntilChanged()
        val occurrences = today.flatMapLatest { taskRepo.observeOpenOccurrences(it) }
        // Look back MAX_BYPASS_MINUTES before midnight so a bypass started late yesterday is still seen.
        val bypasses = today.flatMapLatest { d ->
            blockerRepo.observeBypasses(startOfLocalDay(d, time).minus(Duration.ofMinutes(MAX_BYPASS_MINUTES)))
        }
        val config = blockerRepo.observeConfig().distinctUntilChanged()
        val blocked = blockerRepo.observeBlockedApps()
            .map { apps -> apps.asSequence().filter { it.enabled }.map { it.packageName }.toSet() }
            .distinctUntilChanged()
        val focusActive = focus.state
            .map { it.phase == FocusPhase.WORK && !it.paused }
            .distinctUntilChanged()

        val base = combine(config, blocked, occurrences, bypasses, focusActive) { c, b, o, by, f ->
            Snapshot(c, b, o, by, f)
        }
        return combine(base, ticks) { s, _ ->
            val now = time.now()
            BlockPolicyInput(
                config = s.config,
                blockedPackages = s.blocked,
                openOccurrences = s.occurrences,
                activeBypass = s.bypasses.filter { BlockPolicyEngine.isBypassActive(it, now) }.maxByOrNull { it.endsAt },
                focusWorkActive = s.focusActive,
                now = now,
                today = time.today(),
                ownPackage = ownPackage,
                deviceProtectedPackages = deviceProtected,
            )
        }
    }

    private data class Snapshot(
        val config: BlockerConfig,
        val blocked: Set<String>,
        val occurrences: List<OccurrenceWithTask>,
        val bypasses: List<BypassSession>,
        val focusActive: Boolean,
    )
}

enum class BypassDenial { DAILY_LIMIT_REACHED, COOLDOWN, ALREADY_ACTIVE, BLOCKER_NOT_RESTRICTING }

sealed interface BypassResult {
    data class Granted(val session: BypassSession) : BypassResult
    data class Denied(val denial: BypassDenial, val retryAt: Instant?) : BypassResult
}

data class BypassAvailability(val remainingToday: Int, val nextAllowedAt: Instant?, val active: BypassSession?)

/**
 * Transparent, rate-limited bypasses. Rules:
 *  - Every grant is persisted (log). Note trimmed to [MAX_NOTE_CHARS].
 *  - Duration = config.bypassDurationMinutes clamped to 1..60.
 *  - Non-emergency: at most config.maxBypassesPerDay per *local* day (by startedAt), and a cooldown of
 *    config.bypassCooldownMinutes measured from the end (or early end) of the previous non-emergency bypass.
 *  - EMERGENCY: always granted (bounded duration) past limits and cooldown, and does not consume the daily
 *    quota or trigger the cooldown — safety must never cost the user anything.
 *  - Denied when a bypass is already active, or when the blocker is not restricting (disabled / recovery mode).
 */
class BypassManager @Inject constructor(
    private val blockerRepo: BlockerRepository,
    private val time: TimeProvider,
) {
    @OptIn(ExperimentalCoroutinesApi::class)
    fun observeAvailability(): Flow<BypassAvailability> {
        val ticks = tickerFlow(AVAILABILITY_TICK_MILLIS).map { time.now() }
        val today = ticks.map { time.today() }.distinctUntilChanged()
        val configFlow = blockerRepo.observeConfig().distinctUntilChanged()
        val window = combine(today, configFlow.map { it.bypassCooldownMinutes }.distinctUntilChanged()) { d, c ->
            lookbackStart(d, c)
        }.distinctUntilChanged()
        val bypasses = window.flatMapLatest { blockerRepo.observeBypasses(it) }
        return combine(configFlow, bypasses, ticks) { config, list, _ ->
            availability(config, list, time.now())
        }.distinctUntilChanged()
    }

    /** EMERGENCY reason is always granted (bounded duration), even past the daily limit — safety first. */
    suspend fun request(reason: BypassReason, note: String): BypassResult {
        val now = time.now()
        val config = blockerRepo.observeConfig().first()
        if (!config.enabled || config.recoveryUntil?.isAfter(now) == true) {
            return BypassResult.Denied(BypassDenial.BLOCKER_NOT_RESTRICTING, null)
        }
        val recent = blockerRepo.observeBypasses(lookbackStart(time.today(), config.bypassCooldownMinutes)).first()
        recent.filter { BlockPolicyEngine.isBypassActive(it, now) }.maxByOrNull { it.endsAt }?.let {
            return BypassResult.Denied(BypassDenial.ALREADY_ACTIVE, it.endsAt)
        }
        if (reason != BypassReason.EMERGENCY) {
            val availability = availability(config, recent, now)
            if (availability.remainingToday <= 0) {
                return BypassResult.Denied(BypassDenial.DAILY_LIMIT_REACHED, startOfLocalDay(time.today().plusDays(1), time))
            }
            val cooldownEnd = cooldownEnd(config, recent)
            if (cooldownEnd != null && now.isBefore(cooldownEnd)) {
                return BypassResult.Denied(BypassDenial.COOLDOWN, cooldownEnd)
            }
        }
        val minutes = config.bypassDurationMinutes.coerceIn(1, MAX_BYPASS_MINUTES.toInt())
        val session = BypassSession(
            startedAt = now,
            endsAt = now.plus(Duration.ofMinutes(minutes.toLong())),
            reason = reason,
            note = note.trim().take(MAX_NOTE_CHARS),
        )
        val id = blockerRepo.insertBypass(session)
        return BypassResult.Granted(session.copy(id = id))
    }

    suspend fun endEarly(sessionId: Long) {
        blockerRepo.endBypassEarly(sessionId, time.now())
    }

    /**
     * Start of the window of bypasses we must see: today's local midnight, minus the longest possible bypass
     * (one started late yesterday may still run) and the cooldown (which can span midnight).
     */
    private fun lookbackStart(today: LocalDate, cooldownMinutes: Int): Instant =
        startOfLocalDay(today, time).minus(Duration.ofMinutes(MAX_BYPASS_MINUTES + cooldownMinutes.coerceAtLeast(0)))

    private fun countedToday(list: List<BypassSession>): Int {
        val today = time.today()
        return list.count { it.reason != BypassReason.EMERGENCY && it.startedAt.atZone(time.zone()).toLocalDate() == today }
    }

    private fun cooldownEnd(config: BlockerConfig, list: List<BypassSession>): Instant? {
        val minutes = config.bypassCooldownMinutes
        if (minutes <= 0) return null
        val lastEnd = list.asSequence()
            .filter { it.reason != BypassReason.EMERGENCY }
            .map { s -> s.endedEarlyAt?.let { if (it.isBefore(s.endsAt)) it else s.endsAt } ?: s.endsAt }
            .maxOrNull() ?: return null
        return lastEnd.plus(Duration.ofMinutes(minutes.toLong()))
    }

    private fun availability(config: BlockerConfig, list: List<BypassSession>, now: Instant): BypassAvailability {
        val remaining = (config.maxBypassesPerDay - countedToday(list)).coerceAtLeast(0)
        val active = list.filter { BlockPolicyEngine.isBypassActive(it, now) }.maxByOrNull { it.endsAt }
        val cooldown = cooldownEnd(config, list)?.takeIf { now.isBefore(it) }
        val next = when {
            remaining <= 0 -> startOfLocalDay(time.today().plusDays(1), time).let { if (cooldown != null && cooldown.isAfter(it)) cooldown else it }
            active != null -> listOfNotNull(active.endsAt, cooldown).max()
            else -> cooldown
        }
        return BypassAvailability(remainingToday = remaining, nextAllowedAt = next, active = active)
    }

    companion object {
        const val MAX_NOTE_CHARS = 200
        internal const val AVAILABILITY_TICK_MILLIS = 15_000L
    }
}

class RecoveryModeUseCase @Inject constructor(
    private val blockerRepo: BlockerRepository,
    private val time: TimeProvider,
) {
    /** Pause all enforcement for [hours] (1..72). Always available — the user is never locked out. */
    suspend fun enable(hours: Int) {
        val until = time.now().plus(Duration.ofHours(hours.coerceIn(1, 72).toLong()))
        blockerRepo.updateConfig { it.copy(recoveryUntil = until) }
    }

    suspend fun disable() {
        blockerRepo.updateConfig { it.copy(recoveryUntil = null) }
    }
}
