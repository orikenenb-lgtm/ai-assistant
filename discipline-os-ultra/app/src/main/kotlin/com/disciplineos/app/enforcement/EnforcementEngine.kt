package com.disciplineos.app.enforcement

import android.content.Context
import com.disciplineos.core.domain.blocker.BlockPolicyEngine
import com.disciplineos.core.domain.blocker.BlockPolicyInput
import com.disciplineos.core.domain.blocker.ObserveBlockPolicyInputUseCase
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.AllowReason
import com.disciplineos.core.model.BlockDecision
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.retryWhen
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Shared enforcement brain used by the foreground service, the optional accessibility service and the block screen.
 *
 * - Holds the latest [BlockPolicyInput] as a StateFlow. The upstream (DB observers + ticker) only runs while someone
 *   collects it (service / accessibility / UI), so a disabled blocker costs nothing.
 * - [evaluate] is synchronous and FAILS OPEN: any error, missing data or protected package results in Allow.
 */
@Singleton
class EnforcementEngine @Inject constructor(
    @ApplicationContext private val context: Context,
    private val observeInput: ObserveBlockPolicyInputUseCase,
    private val deviceProtected: DeviceProtectedPackages,
    private val time: TimeProvider,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val ownPackage: String = context.packageName

    val input: StateFlow<BlockPolicyInput?> = flow {
        emitAll(observeInput(ownPackage, deviceProtected.get()))
    }
        .retryWhen { _, attempt ->
            // Never crash the service on a data-layer error; back off and resubscribe.
            delay((attempt + 1).coerceAtMost(6) * 5_000L)
            true
        }
        .stateIn(scope, SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000), null)

    /** Package-agnostic restriction (notification / dashboard / polling cadence). Null until data is loaded. */
    val restriction: StateFlow<BlockDecision?> = input
        .map { it?.let(::currentRestriction) }
        .stateIn(scope, SharingStarted.WhileSubscribed(stopTimeoutMillis = 5_000), null)

    private val _health = MutableStateFlow(EnforcementHealth())
    val health: StateFlow<EnforcementHealth> = _health.asStateFlow()

    private val _accessibilityConnected = MutableStateFlow(false)
    /** True while the optional accessibility service is connected, consented and active. */
    val accessibilityConnected: StateFlow<Boolean> = _accessibilityConnected.asStateFlow()

    fun reportHealth(transform: (EnforcementHealth) -> EnforcementHealth) = _health.update(transform)

    fun setAccessibilityConnected(connected: Boolean) {
        _accessibilityConnected.value = connected
    }

    fun isProtected(packageName: String): Boolean =
        packageName == ownPackage || deviceProtected.contains(packageName)

    /** Decision for the given foreground package using the latest input with a fresh clock. */
    fun evaluate(packageName: String): BlockDecision {
        val latest = input.value ?: return BlockDecision.Allow(AllowReason.BLOCKER_DISABLED)
        return evaluate(latest, packageName)
    }

    fun evaluate(policyInput: BlockPolicyInput, packageName: String): BlockDecision {
        if (isProtected(packageName)) return BlockDecision.Allow(AllowReason.PROTECTED_PACKAGE)
        return runCatching { BlockPolicyEngine.decide(fresh(policyInput), packageName) }
            .getOrElse { BlockDecision.Allow(AllowReason.BLOCKER_DISABLED) }
    }

    fun currentRestriction(policyInput: BlockPolicyInput): BlockDecision =
        runCatching { BlockPolicyEngine.currentRestriction(fresh(policyInput)) }
            .getOrElse { BlockDecision.Allow(AllowReason.BLOCKER_DISABLED) }

    /** The input's `now` is refreshed by a 15s ticker; re-stamp it so bypass/recovery expiry applies immediately. */
    private fun fresh(policyInput: BlockPolicyInput): BlockPolicyInput =
        policyInput.copy(now = time.now(), today = time.today())
}
