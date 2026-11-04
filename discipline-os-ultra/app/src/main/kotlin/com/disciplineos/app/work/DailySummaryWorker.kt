package com.disciplineos.app.work

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.disciplineos.app.notifications.ReminderNotifier
import com.disciplineos.core.domain.repository.SettingsRepository
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.time.TimeProvider
import com.disciplineos.core.model.OccurrenceStatus
import com.disciplineos.core.model.TaskKind
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/**
 * Evening, supportive summary of today (counts only — no task titles on the lock screen).
 * Skipped when notifications are disabled in app settings or there was nothing planned today.
 */
@HiltWorker
class DailySummaryWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val taskRepository: TaskRepository,
    private val settingsRepository: SettingsRepository,
    private val notifier: ReminderNotifier,
    private val time: TimeProvider,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = try {
        if (settingsRepository.observeSettings().first().notificationsEnabled) {
            val today = time.today()
            val items = taskRepository.observeOccurrences(today, today).first().filterNot { it.task.archived }
            val counted = items.filter { it.occurrence.status != OccurrenceStatus.SKIPPED }
            val completed = counted.count { it.occurrence.status == OccurrenceStatus.COMPLETED }
            val mandatoryOpen = counted.count {
                it.task.kind == TaskKind.MANDATORY && it.occurrence.status == OccurrenceStatus.PENDING
            }
            if (counted.isNotEmpty()) notifier.showDailySummary(completed, counted.size, mandatoryOpen)
        }
        Result.success()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        Result.failure()
    }
}
