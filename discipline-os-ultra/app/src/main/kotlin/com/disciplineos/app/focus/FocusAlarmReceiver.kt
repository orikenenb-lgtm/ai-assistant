package com.disciplineos.app.focus

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.disciplineos.core.domain.focus.FocusSessionManager
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/**
 * Receives the phase-end alarm and the notification actions. Not exported (manifest), and only ever addressed by
 * explicit intents created in [FocusAlarmScheduler] / [FocusNotifier].
 */
@AndroidEntryPoint
class FocusAlarmReceiver : BroadcastReceiver() {

    @Inject lateinit var manager: FocusSessionManager

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try {
                // goAsync gives ~10s; stay well inside it.
                withTimeoutOrNull(TIMEOUT_MILLIS) {
                    // The process may have been killed while the ongoing notification stayed visible; in that case
                    // the in-memory timer is still IDLE. restore() is mutex-guarded and idempotent (it reloads the
                    // last persisted state), so load it before applying the user's action.
                    manager.restore()
                    when (action) {
                        ACTION_PHASE_END -> manager.onPhaseMaybeElapsed()
                        ACTION_PAUSE -> manager.pause()
                        ACTION_RESUME -> manager.resume()
                        ACTION_SKIP -> manager.skip()
                        ACTION_STOP -> manager.stop()
                        else -> Unit
                    }
                }
            } catch (t: Throwable) {
                if (t is kotlinx.coroutines.CancellationException) throw t
                Log.w(TAG, "Focus action failed: $action", t)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        private const val TAG = "FocusAlarmReceiver"
        private const val TIMEOUT_MILLIS = 8_000L
        const val ACTION_PHASE_END = "com.disciplineos.app.focus.PHASE_END"
        const val ACTION_PAUSE = "com.disciplineos.app.focus.PAUSE"
        const val ACTION_RESUME = "com.disciplineos.app.focus.RESUME"
        const val ACTION_SKIP = "com.disciplineos.app.focus.SKIP"
        const val ACTION_STOP = "com.disciplineos.app.focus.STOP"
    }
}
