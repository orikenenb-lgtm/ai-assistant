package com.disciplineos.app.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.disciplineos.app.di.ApplicationScope
import com.disciplineos.core.domain.task.TaskCommands
import com.disciplineos.core.domain.task.TaskError
import com.disciplineos.core.domain.task.TaskResult
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import javax.inject.Inject

/**
 * Handles "Complete" / "Snooze 30m" from reminder notifications. Not exported; reached only through our own
 * explicit, immutable PendingIntents. Work runs in the application scope under goAsync() with a timeout well
 * below the 10s broadcast limit. TaskCommands applies validation, history, XP and reminder rescheduling.
 */
@AndroidEntryPoint
class TaskActionReceiver : BroadcastReceiver() {

    @Inject lateinit var taskCommands: TaskCommands
    @Inject lateinit var notifier: ReminderNotifier
    @Inject @ApplicationScope lateinit var appScope: CoroutineScope

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        val occurrenceId = intent.getLongExtra(EXTRA_OCCURRENCE_ID, -1L)
        if (occurrenceId <= 0 || (action != ACTION_COMPLETE && action != ACTION_SNOOZE)) return

        val pending = goAsync()
        appScope.launch {
            try {
                val result = withTimeoutOrNull(TIMEOUT_MS) {
                    if (action == ACTION_COMPLETE) {
                        taskCommands.completeOccurrence(occurrenceId)
                    } else {
                        taskCommands.snoozeOccurrence(occurrenceId, SNOOZE_MINUTES)
                    }
                }
                when (result) {
                    is TaskResult.Success -> notifier.cancelReminder(occurrenceId)
                    is TaskResult.Failure ->
                        if (result.error == TaskError.ALREADY_RESOLVED || result.error == TaskError.NOT_FOUND) {
                            notifier.cancelReminder(occurrenceId)
                        } else {
                            notifier.showActionNeedsApp(occurrenceId)
                        }
                    null -> notifier.showActionNeedsApp(occurrenceId) // timed out
                }
            } catch (e: Exception) {
                notifier.showActionNeedsApp(occurrenceId)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val ACTION_COMPLETE = "com.disciplineos.app.action.COMPLETE_OCCURRENCE"
        const val ACTION_SNOOZE = "com.disciplineos.app.action.SNOOZE_OCCURRENCE"
        const val EXTRA_OCCURRENCE_ID = "occurrence_id"
        const val SNOOZE_MINUTES = 30
        private const val TIMEOUT_MS = 8_000L
    }
}
