package com.disciplineos.core.domain.blocker

import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.repository.BlockerRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.*
import kotlinx.coroutines.flow.Flow
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

object BlockPolicyEngine {
    /** Decision for one foreground package. Pure + deterministic. */
    fun decide(input: BlockPolicyInput, packageName: String): BlockDecision = TODO("Blocker agent")
    /** Package-agnostic: would targeted apps currently be blocked? (dashboard/status) */
    fun currentRestriction(input: BlockPolicyInput): BlockDecision = TODO("Blocker agent")
}

/** Packages that may never be blocked, regardless of configuration. */
object ProtectedPackages {
    val ALWAYS: Set<String> = emptySet() // Blocker agent fills (dialer, emergency, settings, SystemUI, Play services permission controller, ...)
    fun isProtected(packageName: String, ownPackage: String, deviceProtected: Set<String>, userExempt: Set<String>): Boolean = TODO()
}

/** Default suggestions shown in the app picker (only suggested if installed; user must confirm). */
object DefaultBlockTargets {
    val SUGGESTED: Map<String, String> = emptyMap() // package -> display label; Blocker agent fills
}

class ObserveBlockPolicyInputUseCase @Inject constructor(
    private val taskRepo: TaskRepository,
    private val blockerRepo: BlockerRepository,
    private val focus: FocusSessionManager,
    private val time: TimeProvider,
) {
    /** Re-emits on any task/config/bypass/focus change, and at least every [tickMillis] so bypass expiry is observed. */
    operator fun invoke(ownPackage: String, deviceProtected: Set<String>, tickMillis: Long = 15_000): Flow<BlockPolicyInput> = TODO()
}

enum class BypassDenial { DAILY_LIMIT_REACHED, COOLDOWN, ALREADY_ACTIVE, BLOCKER_NOT_RESTRICTING }

sealed interface BypassResult {
    data class Granted(val session: BypassSession) : BypassResult
    data class Denied(val denial: BypassDenial, val retryAt: Instant?) : BypassResult
}

data class BypassAvailability(val remainingToday: Int, val nextAllowedAt: Instant?, val active: BypassSession?)

class BypassManager @Inject constructor(
    private val blockerRepo: BlockerRepository,
    private val time: TimeProvider,
) {
    fun observeAvailability(): Flow<BypassAvailability> = TODO()
    /** EMERGENCY reason is always granted (bounded duration), even past the daily limit — safety first. */
    suspend fun request(reason: BypassReason, note: String): BypassResult = TODO()
    suspend fun endEarly(sessionId: Long): Unit = TODO()
}

class RecoveryModeUseCase @Inject constructor(
    private val blockerRepo: BlockerRepository,
    private val time: TimeProvider,
) {
    /** Pause all enforcement for [hours] (1..72). Always available — the user is never locked out. */
    suspend fun enable(hours: Int): Unit = TODO()
    suspend fun disable(): Unit = TODO()
}
