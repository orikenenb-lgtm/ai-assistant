package com.disciplineos.app.work

import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.disciplineos.app.di.IoDispatcher
import com.disciplineos.core.domain.repository.ReminderScheduler
import com.disciplineos.core.domain.repository.TaskRepository
import com.disciplineos.core.domain.task.DueInstantResolver
import com.disciplineos.core.domain.time.TimeProvider
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.time.Duration
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reminders as one-time WorkManager jobs (survive reboot/process death; no exact-alarm permission needed).
 * Delivery may be deferred by Doze by a few minutes — acceptable for task reminders and battery-friendly.
 *
 * rescheduleAll():
 * 1. plans reminders for PENDING occurrences in the next 48h ([ReminderPlanner]);
 * 2. cancels any queued reminder whose unique name is no longer planned (stale);
 * 3. enqueues each planned reminder with REPLACE — unless an identical one (same name + same fire time,
 *    tracked with tags) is already queued, which avoids needless churn on every task edit.
 */
@Singleton
class WorkManagerReminderScheduler @Inject constructor(
    private val workManager: WorkManager,
    private val taskRepository: TaskRepository,
    private val time: TimeProvider,
    @IoDispatcher private val io: CoroutineDispatcher,
) : ReminderScheduler {

    private val mutex = Mutex()

    override suspend fun rescheduleAll(): Unit = mutex.withLock {
        val now = time.now()
        val today = time.today()
        // Yesterday is included: a task without time is due at the end of its day, which may be "tomorrow" in UTC terms.
        val items = taskRepository.observeOccurrences(today.minusDays(1), today.plusDays(2)).first()
        val planned = ReminderPlanner.plan(items, now, ReminderPlanner.DEFAULT_HORIZON, DueInstantResolver::endOfDay)
        val plannedByName = planned.associateBy { it.uniqueName }

        val queued: List<WorkInfo> = withContext(io) { workManager.getWorkInfosByTag(WorkNames.TAG_REMINDER).get() }
        val queuedFire = HashMap<String, String>() // unique name -> fire tag
        for (info in queued) {
            if (info.state.isFinished) continue
            // Never cancel a reminder that is running or already due: the planner drops past fire times, but a
            // due reminder may simply be waiting for Doze/the process start that triggered this reschedule.
            // ReminderWorker re-checks the occurrence state itself, so letting it run is always safe.
            if (info.state == WorkInfo.State.RUNNING) continue
            val queuedFireAt = info.tags.firstOrNull { it.startsWith(WorkNames.FIRE_TAG_PREFIX) }
                ?.removePrefix(WorkNames.FIRE_TAG_PREFIX)?.toLongOrNull()
            if (queuedFireAt != null && queuedFireAt <= now.toEpochMilli() + DUE_GRACE_MILLIS) continue
            val name = info.tags.firstOrNull { it.startsWith(WorkNames.NAME_TAG_PREFIX) }?.removePrefix(WorkNames.NAME_TAG_PREFIX)
            if (name == null || name !in plannedByName) {
                workManager.cancelWorkById(info.id)
            } else {
                info.tags.firstOrNull { it.startsWith(WorkNames.FIRE_TAG_PREFIX) }?.let { queuedFire[name] = it }
            }
        }

        for (spec in planned) {
            val fireTag = WorkNames.FIRE_TAG_PREFIX + spec.fireAt.toEpochMilli()
            if (queuedFire[spec.uniqueName] == fireTag) continue
            val delay = Duration.between(now, spec.fireAt).toMillis().coerceAtLeast(0)
            val request = OneTimeWorkRequestBuilder<ReminderWorker>()
                .setInitialDelay(delay, TimeUnit.MILLISECONDS)
                .setInputData(ReminderWorker.input(spec))
                .addTag(WorkNames.TAG_REMINDER)
                .addTag(WorkNames.taskTag(spec.taskId))
                .addTag(WorkNames.NAME_TAG_PREFIX + spec.uniqueName)
                .addTag(fireTag)
                .build()
            workManager.enqueueUniqueWork(spec.uniqueName, ExistingWorkPolicy.REPLACE, request)
        }
    }

    override suspend fun cancelForTask(taskId: Long) {
        workManager.cancelAllWorkByTag(WorkNames.taskTag(taskId))
    }

    private companion object {
        /** Reminders due within this window are left alone (see rescheduleAll). */
        const val DUE_GRACE_MILLIS = 2 * 60_000L
    }
}
