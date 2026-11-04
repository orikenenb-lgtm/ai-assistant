package com.disciplineos.app.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.disciplineos.app.notifications.ReminderNotifier
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.TaskKind
import com.disciplineos.core.model.VerificationMethod
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/**
 * Posts one task reminder. State is re-checked at fire time (the task may have been completed, deleted,
 * re-snoozed or notifications disabled since scheduling); in all those cases it silently succeeds.
 */
@HiltWorker
class ReminderWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val taskRepository: TaskRepository,
    private val settingsRepository: SettingsRepository,
    private val notifier: ReminderNotifier,
    private val time: TimeProvider,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = try {
        val occurrenceId = inputData.getLong(KEY_OCCURRENCE_ID, -1L)
        if (occurrenceId > 0 && settingsRepository.observeSettings().first().notificationsEnabled) {
            val occ = taskRepository.getOccurrence(occurrenceId)
            val task = occ?.let { taskRepository.getTask(it.taskId) }
            val stillSnoozed = occ?.snoozedUntil?.isAfter(time.now().plusSeconds(SNOOZE_TOLERANCE_SECONDS)) == true
            if (occ != null && task != null && !task.archived && occ.status == OccurrenceStatus.PENDING && !stillSnoozed) {
                notifier.showTaskReminder(
                    occurrenceId = occ.id,
                    title = task.title,
                    mandatory = task.kind == TaskKind.MANDATORY,
                    // Tasks that need proof (checklist/timer/note) can only be completed in the app.
                    quickCompleteAllowed = task.verification == VerificationMethod.NONE,
                )
            }
        }
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure()
    }

    companion object {
        const val KEY_OCCURRENCE_ID = "occurrence_id"
        const val KEY_OFFSET = "offset"
        private const val SNOOZE_TOLERANCE_SECONDS = 60L

        fun input(spec: ReminderSpec) = workDataOf(KEY_OCCURRENCE_ID to spec.occurrenceId, KEY_OFFSET to spec.offsetKey)
    }
}
