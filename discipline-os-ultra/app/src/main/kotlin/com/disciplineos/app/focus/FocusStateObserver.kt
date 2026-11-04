package com.disciplineos.app.focus

import com.disciplineos.core.domain.focus.FocusSessionManager
import com.disciplineos.core.domain.focus.FocusTimerStateMachine
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.FocusPhase
import com.disciplineos.core.model.FocusState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Keeps the phase-end alarm and the ongoing notification in sync with [FocusSessionManager.state].
 *
 * Wiring: `DisciplineApp.onCreate` calls `focusStateObserver.start(appScope)` once (after
 * `FocusSessionManager.restore()` has been launched). Calling [start] again is a no-op while running.
 */
@Singleton
class FocusStateObserver @Inject constructor(
    private val manager: FocusSessionManager,
    private val scheduler: FocusAlarmScheduler,
    private val notifier: FocusNotifier,
    private val time: TimeProvider,
) {
    private var job: Job? = null

    @Synchronized
    fun start(scope: CoroutineScope) {
        if (job?.isActive == true) return
        job = scope.launch {
            // StateFlow is conflated and distinct, so each emission is a real change.
            manager.state.collect { state ->
                // A failing system call (alarm/notification) must never stop the observer.
                runCatching { sync(state) }
            }
        }
    }

    private fun sync(state: FocusState) {
        when {
            state.phase == FocusPhase.IDLE -> {
                scheduler.cancel()
                notifier.cancel()
            }
            state.paused -> {
                scheduler.cancel()
                notifier.show(state, remainingMillis(state))
            }
            else -> {
                val endsAt = state.phaseEndsAt
                if (endsAt != null) scheduler.schedule(endsAt) else scheduler.cancel()
                notifier.show(state, remainingMillis(state))
            }
        }
    }

    private fun remainingMillis(state: FocusState): Long =
        runCatching { FocusTimerStateMachine.remaining(state, time.now()).toMillis() }
            .getOrDefault(state.pausedRemainingMillis ?: 0L)
            .coerceAtLeast(0L)
}
